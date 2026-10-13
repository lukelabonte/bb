// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { MagicPromptsSettingsSection } from "./MagicPromptsSettingsSection";

const TITLE_TEMPLATE_ID = "generateThreadMetadata";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SUMMARY = {
  defaultChanged: false,
  editingNotes: "Keep it short.",
  id: TITLE_TEMPLATE_ID,
  intent: "Title threads.",
  kind: "prompt",
  modified: false,
  overrideBody: null,
  summary: "Thread titles.",
  title: "Thread Metadata Generator",
  updatedAt: null,
  variables: [
    {
      description: "User task text.",
      name: "cleanedPrompt",
      optional: false,
    },
  ],
};

const GUIDE_SUMMARY = {
  defaultChanged: false,
  editingNotes: "Keep flags accurate.",
  id: "bbGuideThreads",
  intent: "Document threads.",
  kind: "instruction",
  modified: false,
  overrideBody: null,
  summary: "Thread commands.",
  title: "bb Guide — Threads",
  updatedAt: null,
  variables: [],
};

interface StubState {
  overrideBody: string | null;
  updatedAt: number | null;
  orphanCleared: boolean;
}

function installStub(): {
  requests: { body: string; method: string; url: string }[];
  state: StubState;
} {
  const state: StubState = {
    overrideBody: null,
    updatedAt: null,
    orphanCleared: false,
  };
  const requests: { body: string; method: string; url: string }[] = [];

  const detail = () => ({
    ...SUMMARY,
    body: state.overrideBody ?? "Default title prompt: {{cleanedPrompt}}",
    defaultBody: "Default title prompt: {{cleanedPrompt}}",
    defaultChanged: false,
    modified: state.overrideBody !== null,
    overrideBody: state.overrideBody,
    updatedAt: state.updatedAt,
  });

  const list = () => ({
    templates: [
      {
        ...SUMMARY,
        modified: state.overrideBody !== null,
        overrideBody: state.overrideBody,
        updatedAt: state.updatedAt,
      },
      GUIDE_SUMMARY,
    ],
    orphaned: state.orphanCleared
      ? []
      : [
          {
            basedOnDefaultHash: "hash",
            body: "Orphaned body",
            templateId: "removedTemplate",
            updatedAt: 456,
          },
        ],
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), "http://bb.test"), init);
      const url = new URL(request.url).pathname;
      const body = await request.text();
      requests.push({ body, method: request.method, url });
      if (url === "/api/v1/settings/prompts") {
        return jsonResponse(list());
      }
      if (url === `/api/v1/settings/prompts/${TITLE_TEMPLATE_ID}`) {
        if (request.method === "PUT") {
          state.overrideBody = JSON.parse(body).body as string;
          state.updatedAt = 1000;
          return jsonResponse({ template: detail(), warnings: [] });
        }
        if (request.method === "DELETE") {
          state.overrideBody = null;
          state.updatedAt = null;
          return jsonResponse({ template: detail() });
        }
        return jsonResponse({ template: detail() });
      }
      if (url === "/api/v1/settings/prompts/removedTemplate") {
        state.orphanCleared = true;
        return jsonResponse({ template: null });
      }
      return jsonResponse({ code: "not_found", message: "not found" }, 404);
    }),
  );

  return { requests, state };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MagicPromptsSettingsSection", () => {
  it("lists templates grouped by kind with orphaned overrides", async () => {
    installStub();
    const { wrapper } = createQueryClientTestHarness();
    render(<MagicPromptsSettingsSection />, { wrapper });

    expect(await screen.findByText("Magic Prompts")).toBeTruthy();
    expect(
      (await screen.findAllByText("Thread Metadata Generator")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Prompts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Instructions").length).toBeGreaterThan(0);
    expect(screen.getByText("bb Guide — Threads")).toBeTruthy();
    expect(screen.getByText("Orphaned overrides")).toBeTruthy();
    expect(screen.getByText("removedTemplate")).toBeTruthy();
  });

  it("edits, saves, and resets a template body", async () => {
    const { requests } = installStub();
    const { wrapper } = createQueryClientTestHarness();
    render(<MagicPromptsSettingsSection />, { wrapper });

    const editor = (await screen.findByLabelText(
      "Template body for Thread Metadata Generator",
    )) as HTMLTextAreaElement;
    await vi.waitFor(() =>
      expect(editor.value).toBe("Default title prompt: {{cleanedPrompt}}"),
    );

    fireEvent.change(editor, {
      target: { value: "Custom title prompt: {{cleanedPrompt}}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      const put = requests.find((request) => request.method === "PUT");
      expect(JSON.parse(put?.body ?? "null")).toEqual({
        body: "Custom title prompt: {{cleanedPrompt}}",
      });
    });
    await vi.waitFor(() =>
      expect(editor.value).toBe("Custom title prompt: {{cleanedPrompt}}"),
    );
    expect(screen.getAllByText("Modified").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    await vi.waitFor(() => {
      const deletes = requests.filter((request) => request.method === "DELETE");
      expect(deletes.length).toBeGreaterThan(0);
    });
    await vi.waitFor(() =>
      expect(editor.value).toBe("Default title prompt: {{cleanedPrompt}}"),
    );
  });

  it("blocks saving undeclared references and warns about dropped variables", async () => {
    installStub();
    const { wrapper } = createQueryClientTestHarness();
    render(<MagicPromptsSettingsSection />, { wrapper });

    const editor = (await screen.findByLabelText(
      "Template body for Thread Metadata Generator",
    )) as HTMLTextAreaElement;
    await vi.waitFor(() =>
      expect(editor.value).toBe("Default title prompt: {{cleanedPrompt}}"),
    );

    fireEvent.change(editor, { target: { value: "{{undeclared}}" } });
    expect(await screen.findByText(/not declared/u)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.change(editor, {
      target: { value: "A body without variables." },
    });
    await vi.waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.getByText(/not referenced/u)).toBeTruthy();
  });

  it("shows the shipped default body", async () => {
    installStub();
    const { wrapper } = createQueryClientTestHarness();
    render(<MagicPromptsSettingsSection />, { wrapper });

    fireEvent.click(
      await screen.findByRole("button", { name: "View shipped default" }),
    );
    expect(
      (await screen.findAllByText("Default title prompt: {{cleanedPrompt}}"))
        .length,
    ).toBeGreaterThan(1);
  });

  it("clears an orphaned override", async () => {
    const { requests } = installStub();
    const { wrapper } = createQueryClientTestHarness();
    render(<MagicPromptsSettingsSection />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    await vi.waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "DELETE" &&
            request.url.endsWith("/removedTemplate"),
        ),
      ).toBe(true);
    });
    await vi.waitFor(() =>
      expect(screen.queryByText("Orphaned overrides")).toBeNull(),
    );
  });
});
