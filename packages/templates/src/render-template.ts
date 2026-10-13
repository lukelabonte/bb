import Handlebars from "handlebars";
import {
  templateDefinitions,
  type TemplateId,
  type TemplateVariables,
} from "./generated/templates.generated.js";

const templateBodyById = Object.fromEntries(
  templateDefinitions.map((definition) => [definition.id, definition.body]),
) as Record<TemplateId, string>;

const compiledTemplateCache = new Map<
  string,
  HandlebarsTemplateDelegate<unknown>
>();

function compileTemplateBody(
  body: string,
): HandlebarsTemplateDelegate<unknown> {
  const cached = compiledTemplateCache.get(body);
  if (cached !== undefined) {
    return cached;
  }

  const compiled = Handlebars.compile<unknown>(body, { noEscape: true });
  compiledTemplateCache.set(body, compiled);
  return compiled;
}

export function templateBody(templateId: TemplateId): string {
  return templateBodyById[templateId];
}

export function renderTemplateBody<TTemplateId extends TemplateId>(
  templateId: TTemplateId,
  body: string,
  variables: TemplateVariables[TTemplateId],
): string {
  return compileTemplateBody(body)(variables).trim();
}

export function renderTemplate<TTemplateId extends TemplateId>(
  templateId: TTemplateId,
  variables: TemplateVariables[TTemplateId],
): string {
  return renderTemplateBody(
    templateId,
    templateBodyById[templateId],
    variables,
  );
}

export function validateTemplateBodyRenders(
  body: string,
  variables: Record<string, string>,
): string | null {
  try {
    compileTemplateBody(body)(variables);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
