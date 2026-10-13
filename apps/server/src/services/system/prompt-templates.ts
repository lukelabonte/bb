import { createHash } from "node:crypto";
import {
  deleteStoredPromptTemplateOverride,
  getStoredPromptTemplateOverride,
  listStoredPromptTemplateOverrides,
  upsertStoredPromptTemplateOverride,
} from "@bb/db";
import {
  templateBody,
  templateDefinitions,
  validateTemplateBodyRenders,
  type TemplateDefinition,
  type TemplateId,
} from "@bb/templates";
import {
  validateTemplateBody,
  type TemplateVariableDeclaration,
} from "@bb/templates/validation";
import type {
  OrphanedPromptTemplateOverride,
  PromptTemplateDetail,
  PromptTemplatesResponse,
  PromptTemplateSummary,
  SavePromptTemplateResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";

type PromptTemplateDeps = Pick<AppDeps, "db" | "hub" | "logger">;

const templateDefinitionById = new Map<string, TemplateDefinition>(
  templateDefinitions.map((definition) => [definition.id, definition]),
);

export function promptTemplateExists(
  templateId: string,
): templateId is TemplateId {
  return templateDefinitionById.has(templateId);
}

export function hashPromptTemplateBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function sampleVariables(
  variables: readonly TemplateVariableDeclaration[],
): Record<string, string> {
  return Object.fromEntries(
    variables.map((variable) => [
      variable.name,
      `__bb_sample_${variable.name}__`,
    ]),
  );
}

function isDefaultChanged(
  definition: TemplateDefinition,
  override: { basedOnDefaultHash: string } | undefined,
): boolean {
  return (
    override !== undefined &&
    override.basedOnDefaultHash !== hashPromptTemplateBody(definition.body)
  );
}

function templateSummary(
  definition: TemplateDefinition,
  override:
    | { basedOnDefaultHash: string; body: string; updatedAt: number }
    | undefined,
): PromptTemplateSummary {
  return {
    defaultChanged: isDefaultChanged(definition, override),
    editingNotes: definition.editingNotes,
    id: definition.id,
    intent: definition.intent,
    kind: definition.kind,
    modified: override !== undefined,
    overrideBody: override?.body ?? null,
    summary: definition.summary,
    title: definition.title,
    updatedAt: override?.updatedAt ?? null,
    variables: definition.variables.map((variable) => ({ ...variable })),
  };
}

function requireTemplateDefinition(templateId: string): TemplateDefinition {
  const definition = templateDefinitionById.get(templateId);
  if (definition === undefined) {
    throw new ApiError(
      404,
      "prompt_template_not_found",
      `Unknown prompt template '${templateId}'.`,
    );
  }
  return definition;
}

export function listPromptTemplates(
  deps: Pick<AppDeps, "db">,
): PromptTemplatesResponse {
  const stored = listStoredPromptTemplateOverrides(deps.db);
  const storedById = new Map(stored.map((row) => [row.templateId, row]));
  return {
    templates: templateDefinitions.map((definition) =>
      templateSummary(definition, storedById.get(definition.id)),
    ),
    orphaned: stored
      .filter((row) => !templateDefinitionById.has(row.templateId))
      .map((row): OrphanedPromptTemplateOverride => ({
        basedOnDefaultHash: row.basedOnDefaultHash,
        body: row.body,
        templateId: row.templateId,
        updatedAt: row.updatedAt,
      })),
  };
}

export function readPromptTemplate(
  deps: Pick<AppDeps, "db">,
  templateId: string,
): PromptTemplateDetail {
  const definition = requireTemplateDefinition(templateId);
  const override = getStoredPromptTemplateOverride(deps.db, templateId);
  return {
    ...templateSummary(definition, override),
    body: override?.body ?? definition.body,
    defaultBody: definition.body,
  };
}

export function resolvePromptTemplateBody(
  deps: Pick<AppDeps, "db" | "logger">,
  templateId: TemplateId,
): string {
  const override = getStoredPromptTemplateOverride(deps.db, templateId);
  if (override === undefined) {
    return templateBody(templateId);
  }
  const definition = templateDefinitionById.get(templateId);
  const renderError = validateTemplateBodyRenders(
    override.body,
    sampleVariables(definition?.variables ?? []),
  );
  if (renderError === null) {
    return override.body;
  }
  deps.logger.error(
    { err: renderError, templateId },
    "Stored prompt template override failed to render; using the shipped default",
  );
  return templateBody(templateId);
}

export function savePromptTemplate(
  deps: PromptTemplateDeps,
  templateId: string,
  body: string,
): SavePromptTemplateResponse {
  const definition = requireTemplateDefinition(templateId);
  const validation = validateTemplateBody({
    body,
    declaredVariables: definition.variables,
    templateId,
  });
  if (validation.errors.length > 0) {
    throw new ApiError(400, "invalid_request", validation.errors.join(" "));
  }
  const renderError = validateTemplateBodyRenders(
    body,
    sampleVariables(definition.variables),
  );
  if (renderError !== null) {
    throw new ApiError(
      400,
      "invalid_request",
      `Template "${templateId}" failed to render: ${renderError}`,
    );
  }
  upsertStoredPromptTemplateOverride(deps.db, {
    basedOnDefaultHash: hashPromptTemplateBody(definition.body),
    body,
    templateId,
    updatedAt: Date.now(),
  });
  deps.hub.notifySystem(["prompt-templates-changed"]);
  return {
    template: readPromptTemplate(deps, templateId),
    warnings: validation.warnings,
  };
}

export function resetPromptTemplate(
  deps: PromptTemplateDeps,
  templateId: string,
): PromptTemplateDetail | null {
  const deleted = deleteStoredPromptTemplateOverride(deps.db, templateId);
  if (!deleted && !promptTemplateExists(templateId)) {
    throw new ApiError(
      404,
      "prompt_template_not_found",
      `Unknown prompt template '${templateId}'.`,
    );
  }
  if (deleted) {
    deps.hub.notifySystem(["prompt-templates-changed"]);
  }
  return promptTemplateExists(templateId)
    ? readPromptTemplate(deps, templateId)
    : null;
}
