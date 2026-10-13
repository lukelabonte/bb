import { describe, expect, it } from "vitest";
import {
  extractTemplateReferences,
  parseTemplateVariableDeclarations,
  validateTemplateBody,
  validateTemplateMetadata,
  TEMPLATE_KINDS,
} from "../src/template-validation.js";

const DECLARED = [
  { name: "name", description: "A name.", optional: false },
  { name: "note", description: "An optional note.", optional: true },
];

describe("extractTemplateReferences", () => {
  it("finds plain, triple-stash, and #if references", () => {
    expect([
      ...extractTemplateReferences("{{name}} {{{name}}} {{#if note}}"),
    ]).toEqual(["name", "note"]);
  });

  it("ignores helpers, partials, closing tags, comments, and else", () => {
    expect([
      ...extractTemplateReferences(
        "{{else}}{{/if}}{{> partial}}{{! comment}}{{!-- long --}}",
      ),
    ]).toEqual([]);
  });

  it("finds spaced and this-prefixed references", () => {
    expect([...extractTemplateReferences("{{ name }} {{this.note}}")]).toEqual([
      "name",
      "note",
    ]);
  });

  it("finds references inside supported block helpers", () => {
    expect([
      ...extractTemplateReferences("{{#unless name}}x{{/unless}}"),
    ]).toEqual(["name"]);
  });
});

describe("validateTemplateBody", () => {
  it("accepts a body whose references are declared", () => {
    expect(
      validateTemplateBody({
        body: "Hello {{name}}{{#if note}} ({{note}}){{/if}}",
        declaredVariables: DECLARED,
        templateId: "example",
      }),
    ).toEqual({ errors: [], warnings: [] });
  });

  it("blocks undeclared references in every supported form", () => {
    for (const body of [
      "{{missing}}",
      "{{ missing }}",
      "{{this.missing}}",
      "{{#if missing}}x{{/if}}",
      "{{#unless missing}}x{{/unless}}",
    ]) {
      const result = validateTemplateBody({
        body,
        declaredVariables: DECLARED,
        templateId: "example",
      });
      expect(result.errors.join("\n")).toContain("missing");
    }
  });

  it("warns about declared variables the body does not reference", () => {
    const result = validateTemplateBody({
      body: "Hello {{name}}",
      declaredVariables: DECLARED,
      templateId: "example",
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).toContain("note");
  });

  it("blocks an empty or whitespace-only body", () => {
    const result = validateTemplateBody({
      body: "   \n",
      declaredVariables: DECLARED,
      templateId: "example",
    });
    expect(result.errors.join("\n")).toContain("must not be empty");
  });
});

describe("parseTemplateVariableDeclarations", () => {
  it("parses descriptions and optionality", () => {
    const { declarations, errors } = parseTemplateVariableDeclarations({
      name: "A name.",
      "note?": "An optional note.",
    });
    expect(errors).toEqual([]);
    expect(declarations).toEqual([
      { name: "name", description: "A name.", optional: false },
      { name: "note", description: "An optional note.", optional: true },
    ]);
  });

  it("rejects duplicate normalized names", () => {
    const { errors } = parseTemplateVariableDeclarations({
      name: "A name.",
      "name?": "Also a name.",
    });
    expect(errors.join("\n")).toContain("declared more than once");
  });

  it("rejects malformed names and missing descriptions", () => {
    const { errors } = parseTemplateVariableDeclarations({
      "bad name": "Spaces are invalid.",
      empty: "   ",
      missing: undefined,
    });
    expect(errors.join("\n")).toContain('invalid variable name "bad name"');
    expect(errors.join("\n")).toContain('variable "empty" is missing');
    expect(errors.join("\n")).toContain('variable "missing" is missing');
  });

  it("treats an absent variables block as no declarations", () => {
    expect(parseTemplateVariableDeclarations(undefined)).toEqual({
      declarations: [],
      errors: [],
    });
  });
});

describe("validateTemplateMetadata", () => {
  const COMPLETE = {
    editingNotes: "Keep it short.",
    intent: "Explain the thing.",
    kind: "prompt",
    summary: "A summary.",
    title: "A title",
  };

  it("accepts every known kind", () => {
    for (const kind of TEMPLATE_KINDS) {
      expect(
        validateTemplateMetadata("example", { ...COMPLETE, kind }),
      ).toEqual([]);
    }
  });

  it("requires every metadata field", () => {
    const errors = validateTemplateMetadata("example", {
      editingNotes: undefined,
      intent: undefined,
      kind: undefined,
      summary: undefined,
      title: undefined,
    });
    expect(errors).toHaveLength(5);
    expect(errors.join("\n")).toContain(
      'missing required frontmatter field "kind"',
    );
  });

  it("rejects an unknown kind", () => {
    expect(
      validateTemplateMetadata("example", { ...COMPLETE, kind: "prose" }).join(
        "\n",
      ),
    ).toContain('unknown kind "prose"');
  });
});
