export const TEMPLATE_KINDS = [
  "instruction",
  "prompt",
  "system-message",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface TemplateVariableDeclaration {
  description: string;
  name: string;
  optional: boolean;
}

export interface TemplateBodyValidation {
  errors: string[];
  warnings: string[];
}

export interface TemplateMetadataFields {
  editingNotes: string | undefined;
  intent: string | undefined;
  kind: string | undefined;
  summary: string | undefined;
  title: string | undefined;
}

const VARIABLE_REFERENCE_PATTERN =
  /\{\{\{?\s*(?:#(?:if|unless|each|with)\s+)?([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*)\s*\}?\}\}/gu;

const RESERVED_REFERENCES = new Set(["else"]);

const VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;

function normalizeReference(name: string): string {
  return name.startsWith("this.") ? name.slice("this.".length) : name;
}

export function extractTemplateReferences(body: string): Set<string> {
  const references = new Set<string>();
  for (const match of body.matchAll(VARIABLE_REFERENCE_PATTERN)) {
    const name = match[1];
    if (name === undefined) continue;
    const normalized = normalizeReference(name);
    if (!RESERVED_REFERENCES.has(normalized)) {
      references.add(normalized);
    }
  }
  return references;
}

export function validateTemplateBody(args: {
  body: string;
  declaredVariables: readonly TemplateVariableDeclaration[];
  templateId: string;
}): TemplateBodyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (args.body.trim().length === 0) {
    errors.push(`Template "${args.templateId}": body must not be empty`);
  }

  const declaredNames = new Set(
    args.declaredVariables.map((variable) => variable.name),
  );
  const references = extractTemplateReferences(args.body);
  for (const reference of references) {
    if (!declaredNames.has(reference)) {
      errors.push(
        `Template "${args.templateId}": body references "{{${reference}}}" but it is not declared in frontmatter variables`,
      );
    }
  }
  for (const name of declaredNames) {
    if (!references.has(name)) {
      warnings.push(
        `Template "${args.templateId}": variable "${name}" is declared in frontmatter but not referenced in template body`,
      );
    }
  }
  return { errors, warnings };
}

export function validateTemplateMetadata(
  templateId: string,
  fields: TemplateMetadataFields,
): string[] {
  const errors: string[] = [];
  if (fields.kind === undefined) {
    errors.push(
      `Template "${templateId}": missing required frontmatter field "kind"`,
    );
  } else if (!(TEMPLATE_KINDS as readonly string[]).includes(fields.kind)) {
    errors.push(`Template "${templateId}": unknown kind "${fields.kind}"`);
  }
  const requiredFields = [
    "title",
    "summary",
    "intent",
    "editingNotes",
  ] as const;
  for (const field of requiredFields) {
    if (fields[field] === undefined) {
      errors.push(
        `Template "${templateId}": missing required frontmatter field "${field}"`,
      );
    }
  }
  return errors;
}

export function parseTemplateVariableDeclarations(value: unknown): {
  declarations: TemplateVariableDeclaration[];
  errors: string[];
} {
  if (value === undefined) {
    return { declarations: [], errors: [] };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      declarations: [],
      errors: ["frontmatter variables must map names to descriptions"],
    };
  }

  const declarations: TemplateVariableDeclaration[] = [];
  const declaredNames = new Set<string>();
  const errors: string[] = [];
  for (const [rawName, rawDescription] of Object.entries(value)) {
    const optional = rawName.endsWith("?");
    const name = optional ? rawName.slice(0, -1) : rawName;
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      errors.push(`invalid variable name "${rawName}"`);
      continue;
    }
    if (declaredNames.has(name)) {
      errors.push(`variable "${name}" is declared more than once`);
      continue;
    }
    if (
      typeof rawDescription !== "string" ||
      rawDescription.trim().length === 0
    ) {
      errors.push(`variable "${name}" is missing a description`);
      continue;
    }
    declaredNames.add(name);
    declarations.push({
      name,
      description: rawDescription.trim(),
      optional,
    });
  }
  return { declarations, errors };
}
