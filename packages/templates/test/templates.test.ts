import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  renderTemplateBody,
  templateBody,
  type TemplateId,
  type TemplateVariables,
} from "../src/index.js";
import { templateDefinitions } from "../src/generated/templates.generated.js";
import {
  validateTemplateBody,
  validateTemplateMetadata,
  TEMPLATE_KINDS,
} from "../src/template-validation.js";

describe("@bb/templates", () => {
  it("documents project creation machine routing", () => {
    const guide = renderTemplate("bbGuideProjects", {});

    expect(guide).toContain("bb project create --name");
    expect(guide).toContain("--machine <id-or-name>");
    expect(guide).toContain("--host <id-or-name>");
    expect(guide).toContain("local CLI machine fallback");
  });

  it("documents complete and partial automation execution updates", () => {
    const guide = renderTemplate("bbGuideAutomations", {});

    expect(guide).toContain("bb automation update <automationId>");
    expect(guide).toContain("Partial updates to an existing");
    expect(guide).toContain("--env-json");
    expect(guide).toContain("--reasoning <level>");
    expect(guide).toContain("--service-tier <tier>");
    expect(guide).toContain("--clear-service-tier");
    expect(guide).toContain("--permission-mode <accept-edits|auto|full>");
    expect(guide).not.toContain("workspace-write|readonly");
  });

  it("documents project-aware thread references", () => {
    const guide = renderTemplate("bbGuideThreads", {});

    expect(guide).toContain("@thread:thr_abc123");
    expect(guide).toContain("do not construct thread URLs manually");
  });

  it("renders agent thread messages without inline reply guidance", () => {
    const rendered = renderTemplate("agentThreadMessage", {
      senderThreadId: "thr_sender",
      messageText: "Please check the failing test.",
    });

    expect(rendered).toBe(
      [
        "[bb message from thread:thr_sender]",
        "",
        "Please check the failing test.",
      ].join("\n"),
    );
  });

  it("renders child thread needs-attention messages with blocker summaries", () => {
    const rendered = renderTemplate("systemMessageChildThreadNeedsAttention", {
      blockerSummary: [
        "Blocked on command approval:",
        "Command: git push",
      ].join("\n"),
      threadMention: "@thread:thr_child",
    });

    expect(rendered).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child needs help.",
        "Blocked on command approval:",
        "Command: git push",
        "",
        "Review the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, ask the user for the missing decision.",
      ].join("\n"),
    );
  });

  it("renders child thread ownership messages", () => {
    expect(
      renderTemplate("systemMessageThreadOwnershipAssigned", {
        threadMention: "@thread:thr_child",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child is now a child of this thread.",
      ].join("\n"),
    );
    expect(
      renderTemplate("systemMessageThreadOwnershipRemoved", {
        threadMention: "@thread:thr_child",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child is no longer a child of this thread.",
      ].join("\n"),
    );
  });

  it("ships complete metadata and passing validation for every template", () => {
    expect(templateDefinitions.length).toBeGreaterThan(0);
    for (const template of templateDefinitions) {
      expect(
        validateTemplateMetadata(template.id, {
          editingNotes: template.editingNotes,
          intent: template.intent,
          kind: template.kind,
          summary: template.summary,
          title: template.title,
        }),
      ).toEqual([]);
      expect(TEMPLATE_KINDS).toContain(template.kind);
      expect(template.body.length).toBeGreaterThan(0);
      expect(
        validateTemplateBody({
          body: template.body,
          declaredVariables: template.variables,
          templateId: template.id,
        }).errors,
      ).toEqual([]);
      for (const variable of template.variables) {
        expect(variable.description.length).toBeGreaterThan(0);
        expect(typeof variable.optional).toBe("boolean");
      }
    }
  });

  it("renders the shipped default body through the explicit body path", () => {
    const rendered = renderTemplate("agentThreadMessage", {
      senderThreadId: "thr_sender",
      messageText: "Please check the failing test.",
    });
    expect(
      renderTemplateBody(
        "agentThreadMessage",
        templateBody("agentThreadMessage"),
        {
          senderThreadId: "thr_sender",
          messageText: "Please check the failing test.",
        },
      ),
    ).toBe(rendered);
  });

  it("renders all templates without error", () => {
    const templates = templateDefinitions;

    const placeholderVariables: Record<string, Record<string, string>> = {};
    for (const template of templates) {
      const vars: Record<string, string> = {};
      for (const variable of template.variables) {
        vars[variable.name] = `__placeholder_${variable.name}__`;
      }
      placeholderVariables[template.id] = vars;
    }

    for (const template of templates) {
      const vars = placeholderVariables[
        template.id
      ] as TemplateVariables[TemplateId];
      expect(() =>
        renderTemplate(template.id as TemplateId, vars),
      ).not.toThrow();
    }
  });
});
