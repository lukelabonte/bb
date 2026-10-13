import { describe, expect, it } from "vitest";
import { upsertStoredPromptTemplateOverride, type DbConnection } from "@bb/db";
import { templateBody, templateDefinitions } from "@bb/templates";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";
import {
  hashPromptTemplateBody,
  resolvePromptTemplateBody,
} from "../../src/services/system/prompt-templates.js";

const TITLE_TEMPLATE_ID = "generateThreadMetadata";
const MACHINE_HEADERS = { "x-bb-gate-auth": "machine" };

interface PromptTemplateSummaryBody {
  defaultChanged: boolean;
  id: string;
  modified: boolean;
  overrideBody: string | null;
}

interface PromptTemplatesBody {
  orphaned: { templateId: string }[];
  templates: PromptTemplateSummaryBody[];
}

function saveOverride(
  db: DbConnection,
  templateId: string,
  body: string,
  basedOnDefaultHash: string,
): void {
  upsertStoredPromptTemplateOverride(db, {
    basedOnDefaultHash,
    body,
    templateId,
    updatedAt: Date.now(),
  });
}

function titleDefaultHash(): string {
  return hashPromptTemplateBody(templateBody(TITLE_TEMPLATE_ID));
}

describe("prompt template routes", () => {
  it("lists every shipped template unmodified", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/prompts");
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as PromptTemplatesBody;
      expect(body.orphaned).toEqual([]);
      expect(body.templates).toHaveLength(templateDefinitions.length);
      for (const template of body.templates) {
        expect(template.modified).toBe(false);
        expect(template.defaultChanged).toBe(false);
        expect(template.overrideBody).toBeNull();
      }
    });
  });

  it("resolves every template to its shipped default with no overrides", async () => {
    await withTestHarness(async (harness) => {
      for (const definition of templateDefinitions) {
        expect(resolvePromptTemplateBody(harness.deps, definition.id)).toBe(
          definition.body,
        );
      }
    });
  });

  it("saves an override, reports it, and resolves it at render time", async () => {
    await withTestHarness(async (harness) => {
      const edited = [
        "Write a very short title for this task:",
        "{{cleanedPrompt}}",
        "{{#if invokedCommands}}Commands: {{invokedCommands}}{{/if}}",
      ].join("\n");
      const put = await harness.app.request(
        `/api/v1/settings/prompts/${TITLE_TEMPLATE_ID}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: edited }),
        },
      );
      expect(put.status).toBe(200);
      const saved = (await readJson(put)) as {
        template: {
          body: string;
          defaultBody: string;
          defaultChanged: boolean;
          modified: boolean;
        };
        warnings: string[];
      };
      expect(saved.template.modified).toBe(true);
      expect(saved.template.body).toBe(edited);
      expect(saved.template.defaultBody).toBe(templateBody(TITLE_TEMPLATE_ID));
      expect(saved.template.defaultChanged).toBe(false);
      expect(saved.warnings).toEqual([]);

      const list = (await readJson(
        await harness.app.request("/api/v1/settings/prompts"),
      )) as PromptTemplatesBody;
      const summary = list.templates.find(
        (template) => template.id === TITLE_TEMPLATE_ID,
      );
      expect(summary?.modified).toBe(true);
      expect(summary?.overrideBody).toBe(edited);

      expect(resolvePromptTemplateBody(harness.deps, TITLE_TEMPLATE_ID)).toBe(
        edited,
      );
    });
  });

  it("blocks undeclared references and empty bodies", async () => {
    await withTestHarness(async (harness) => {
      for (const body of ["Rewrite {{undeclaredVariable}}", "   "]) {
        const put = await harness.app.request(
          `/api/v1/settings/prompts/${TITLE_TEMPLATE_ID}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body }),
          },
        );
        expect(put.status).toBe(400);
      }
      expect(resolvePromptTemplateBody(harness.deps, TITLE_TEMPLATE_ID)).toBe(
        templateBody(TITLE_TEMPLATE_ID),
      );
    });
  });

  it("warns when the body drops a declared variable", async () => {
    await withTestHarness(async (harness) => {
      const put = await harness.app.request(
        `/api/v1/settings/prompts/${TITLE_TEMPLATE_ID}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: "Name this thread: {{cleanedPrompt}}" }),
        },
      );
      expect(put.status).toBe(200);
      const saved = (await readJson(put)) as { warnings: string[] };
      expect(saved.warnings.join("\n")).toContain("invokedCommands");
    });
  });

  it("404s unknown template ids", async () => {
    await withTestHarness(async (harness) => {
      const get = await harness.app.request(
        "/api/v1/settings/prompts/notATemplate",
      );
      expect(get.status).toBe(404);
      const put = await harness.app.request(
        "/api/v1/settings/prompts/notATemplate",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: "Anything" }),
        },
      );
      expect(put.status).toBe(404);
      const del = await harness.app.request(
        "/api/v1/settings/prompts/notATemplate",
        { method: "DELETE" },
      );
      expect(del.status).toBe(404);
    });
  });

  it("resets an override to the shipped default", async () => {
    await withTestHarness(async (harness) => {
      saveOverride(
        harness.deps.db,
        TITLE_TEMPLATE_ID,
        "Custom title prompt: {{cleanedPrompt}}",
        titleDefaultHash(),
      );
      const del = await harness.app.request(
        `/api/v1/settings/prompts/${TITLE_TEMPLATE_ID}`,
        { method: "DELETE" },
      );
      expect(del.status).toBe(200);
      const body = (await readJson(del)) as {
        template: { body: string; modified: boolean };
      };
      expect(body.template.modified).toBe(false);
      expect(body.template.body).toBe(templateBody(TITLE_TEMPLATE_ID));
      expect(resolvePromptTemplateBody(harness.deps, TITLE_TEMPLATE_ID)).toBe(
        templateBody(TITLE_TEMPLATE_ID),
      );
    });
  });

  it("lists orphaned overrides, ignores them when resolving, and clears them", async () => {
    await withTestHarness(async (harness) => {
      saveOverride(
        harness.deps.db,
        "removedTemplate",
        "Orphaned body",
        hashPromptTemplateBody("Orphaned body"),
      );
      const list = (await readJson(
        await harness.app.request("/api/v1/settings/prompts"),
      )) as PromptTemplatesBody;
      expect(list.orphaned.map((entry) => entry.templateId)).toEqual([
        "removedTemplate",
      ]);
      expect(
        list.templates.some((template) => template.id === "removedTemplate"),
      ).toBe(false);

      const del = await harness.app.request(
        "/api/v1/settings/prompts/removedTemplate",
        { method: "DELETE" },
      );
      expect(del.status).toBe(200);
      const body = (await readJson(del)) as { template: null };
      expect(body.template).toBeNull();
      const after = (await readJson(
        await harness.app.request("/api/v1/settings/prompts"),
      )) as PromptTemplatesBody;
      expect(after.orphaned).toEqual([]);
    });
  });

  it("flags a shipped default that changed since the override was saved", async () => {
    await withTestHarness(async (harness) => {
      saveOverride(
        harness.deps.db,
        TITLE_TEMPLATE_ID,
        "Custom title prompt: {{cleanedPrompt}}",
        "0000000000000000000000000000000000000000000000000000000000000000",
      );
      const body = (await readJson(
        await harness.app.request(
          `/api/v1/settings/prompts/${TITLE_TEMPLATE_ID}`,
        ),
      )) as { template: { defaultChanged: boolean; modified: boolean } };
      expect(body.template.modified).toBe(true);
      expect(body.template.defaultChanged).toBe(true);
    });
  });

  it("falls back to the shipped default when a stored override cannot render", async () => {
    await withTestHarness(async (harness) => {
      saveOverride(
        harness.deps.db,
        TITLE_TEMPLATE_ID,
        "{{#if cleanedPrompt}}",
        titleDefaultHash(),
      );
      expect(resolvePromptTemplateBody(harness.deps, TITLE_TEMPLATE_ID)).toBe(
        templateBody(TITLE_TEMPLATE_ID),
      );
    });
  });

  it("rejects machine credentials on writes", async () => {
    await withTestHarness(async (harness) => {
      const put = await harness.app.request(
        `/api/v1/settings/prompts/${TITLE_TEMPLATE_ID}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", ...MACHINE_HEADERS },
          body: JSON.stringify({ body: "Custom title prompt" }),
        },
      );
      expect(put.status).toBe(403);
      const del = await harness.app.request(
        `/api/v1/settings/prompts/${TITLE_TEMPLATE_ID}`,
        { method: "DELETE", headers: MACHINE_HEADERS },
      );
      expect(del.status).toBe(403);
    });
  });
});
