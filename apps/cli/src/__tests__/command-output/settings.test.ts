import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultExperiments } from "@bb/domain";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerSettingsCommands } from "../../commands/settings.js";

describe("bb settings commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerSettingsCommands(program, () => "http://server");

  it("clears the setup guide completion time and keeps every other setting", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          onboardingCompletedAt: "2026-10-01T00:00:00.000Z",
          streamerMode: true,
        },
      })),
      "v1.settings.general.$put": put,
    });

    await runCommand(["settings", "replay-onboarding"], register);

    expect(put).toHaveBeenCalledWith({
      json: {
        ...defaultAppSettings,
        onboardingCompletedAt: null,
        streamerMode: true,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "The setup guide is showing again",
    ]);
  });

  it("sets and resets a plugin shortcut while preserving other overrides", async () => {
    const other = { command: "plugin:other/open", shortcut: null };
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        keybindingOverrides: [other],
      })),
      "v1.settings.keyboard.$put": put,
    });
    await runCommand(
      ["settings", "keyboard", "set", "plugin:example/open", "Mod+Shift+I"],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({
      json: [
        other,
        {
          command: "plugin:example/open",
          shortcut: {
            key: "I",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
        },
      ],
    });
    await runCommand(
      ["settings", "keyboard", "reset", "plugin:example/open"],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({ json: [other] });
  });

  it("keeps command scopes separate when setting and resetting platform bindings", async () => {
    const general = { command: "thread.new", shortcut: null };
    const mac = { command: "thread.new", platform: "mac", shortcut: null };
    const linux = { command: "thread.new", platform: "linux", shortcut: null };
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        keybindingOverrides: [general, mac, linux],
      })),
      "v1.settings.keyboard.$put": put,
    });
    await runCommand(
      [
        "settings",
        "keyboard",
        "set",
        "thread.new",
        "disabled",
        "--platform",
        "windows",
      ],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({
      json: [
        general,
        mac,
        linux,
        { command: "thread.new", platform: "windows", shortcut: null },
      ],
    });
    await runCommand(
      ["settings", "keyboard", "reset", "thread.new", "--platform", "mac"],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({ json: [general, linux] });
    await runCommand(
      ["settings", "keyboard", "reset", "--platform", "linux"],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({ json: [general, mac] });
  });

  const completedTurnProviders = [
    {
      id: "claude-code",
      displayName: "Claude Code",
      completedTurnDisplay: "flat",
    },
    { id: "codex", displayName: "Codex", completedTurnDisplay: "collapse" },
  ];

  it("lists each provider's finished turn display and where it comes from", async () => {
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          providerCompletedTurnDisplay: { codex: "flat" },
        },
        experiments: defaultExperiments,
      })),
      "v1.system.providers.$get": vi.fn(async () => completedTurnProviders),
    });

    await runCommand(["settings", "completed-turns", "--json"], register);

    expect(
      collectLogPayloads(vi.mocked(console.log)).map((payload) =>
        JSON.parse(payload),
      ),
    ).toEqual([
      [
        {
          providerId: "claude-code",
          displayName: "Claude Code",
          completedTurnDisplay: "flat",
          providerDefault: "flat",
          source: "provider-default",
        },
        {
          providerId: "codex",
          displayName: "Codex",
          completedTurnDisplay: "flat",
          providerDefault: "collapse",
          source: "setting",
        },
      ],
    ]);
  });

  it("stores a per-provider override and keeps the other overrides", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          providerCompletedTurnDisplay: { codex: "flat" },
        },
        experiments: defaultExperiments,
      })),
      "v1.system.providers.$get": vi.fn(async () => completedTurnProviders),
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "completed-turns", "claude-code", "collapse"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: {
        ...defaultAppSettings,
        providerCompletedTurnDisplay: {
          codex: "flat",
          "claude-code": "collapse",
        },
      },
    });
    expect(console.log).toHaveBeenCalledWith(
      "claude-code finished turns: collapse (setting)",
    );
  });

  it("removes the override when set back to default", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          providerCompletedTurnDisplay: {
            codex: "flat",
            "claude-code": "collapse",
          },
        },
        experiments: defaultExperiments,
      })),
      "v1.system.providers.$get": vi.fn(async () => completedTurnProviders),
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "completed-turns", "claude-code", "default"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: {
        ...defaultAppSettings,
        providerCompletedTurnDisplay: { codex: "flat" },
      },
    });
    expect(console.log).toHaveBeenCalledWith(
      "claude-code finished turns: flat (provider default)",
    );
  });

  it("rejects an unknown provider or display without writing settings", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.system.providers.$get": vi.fn(async () => completedTurnProviders),
      "v1.settings.general.$put": put,
    });

    await expect(
      runCommand(["settings", "completed-turns", "cursor", "flat"], register),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Unknown provider 'cursor'. Known providers: claude-code, codex.",
      ),
    );

    await expect(
      runCommand(["settings", "completed-turns", "codex", "open"], register),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Invalid finished turn display 'open'. Use collapse, flat, or default.",
      ),
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("updates one general setting while preserving the full contract", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "general", "showDiagnosticEvents", "true"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, showDiagnosticEvents: true },
    });
  });

  it("disables automatic machine Git credentials despite the legacy response alias", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          showUnhandledProviderEvents: false,
        },
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });
    await runCommand(
      ["settings", "general", "machineGitCredentialsEnabled", "false"],
      register,
    );
    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, machineGitCredentialsEnabled: false },
    });
  });

  it("rejects an unknown general setting key", async () => {
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": vi.fn(async ({ json }) => json),
    });

    await expect(
      runCommand(["settings", "general", "notASetting", "true"], register),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Unknown general setting 'notASetting'"),
    );
  });

  it("updates keyboard hint visibility while preserving the full contract", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });

    await runCommand(["settings", "keyboard", "hints", "false"], register);

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, showKeyboardHints: false },
    });
  });

  it("disables thread archive confirmation through general settings", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });
    await runCommand(
      ["settings", "general", "confirmThreadArchive", "off"],
      register,
    );
    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, confirmThreadArchive: false },
    });
  });

  it("enables the changelog preview experiment", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({ "v1.settings.experiments.$put": put });

    await runCommand(
      ["settings", "experiment", "changelogPreview", "true"],
      register,
    );

    expect(put).toHaveBeenCalledWith({ json: { changelogPreview: true } });
  });

  it("reads usage from a selected machine", async () => {
    const getUsage = vi.fn(async () => ({
      codex: { status: "unauthenticated" },
      "claude-code": { status: "unauthenticated" },
      "acp-cursor": { status: "unauthenticated" },
    }));
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          status: "connected",
          lastSeenAt: 1,
          lastRejectedProtocolVersion: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.system.usage-limits.$get": getUsage,
    });

    await runCommand(
      ["settings", "usage", "--machine", "builder", "--refresh", "--json"],
      register,
    );

    expect(getUsage).toHaveBeenCalledWith({
      query: { hostId: "host-remote", refresh: "true" },
    });
  });

  describe("ai-services", () => {
    const aiView = {
      selections: {
        "thread-title": { mode: "automatic" },
        "commit-message": {
          mode: "service",
          pluginId: "my-openrouter",
          serviceId: "helper",
        },
        voice: { mode: "off" },
      },
      services: [
        {
          id: "codex",
          displayName: "Codex",
          pluginId: "provider-codex",
          tasks: ["thread-title", "commit-message", "voice"],
          automaticRank: 0,
          status: { ready: false, message: "Run `codex login`" },
        },
        {
          id: "helper",
          displayName: "OpenRouter",
          pluginId: "my-openrouter",
          tasks: ["thread-title", "commit-message"],
          automaticRank: null,
          status: { ready: true },
        },
        {
          id: "helper",
          displayName: "Other helper",
          pluginId: "other-plugin",
          tasks: ["thread-title", "commit-message"],
          automaticRank: null,
          status: { ready: true },
        },
      ],
    };

    function stubAiServices() {
      const put = vi.fn(async ({ json }) => ({
        ...aiView,
        selections: { ...aiView.selections, [json.task]: json.selection },
      }));
      const test = vi.fn(async () => ({
        ok: true,
        pluginId: "my-openrouter",
        serviceId: "helper",
        displayName: "OpenRouter",
        text: "Add a dark mode toggle",
        durationMs: 250,
      }));
      stubServerApi({
        "v1.system.ai-services.$get": vi.fn(async () => aiView),
        "v1.system.ai-services.selection.$put": put,
        "v1.system.ai-services.test.$post": test,
      });
      return { put, test };
    }

    afterEach(() => {
      process.exitCode = undefined;
    });

    it("shows each task's choice and every service", async () => {
      stubAiServices();

      await runCommand(["settings", "ai-services"], register);

      const lines = collectLogLines(vi.mocked(console.log));
      expect(lines[0]).toBe("thread-title    Automatic (nothing ready)");
      expect(lines[1]).toBe("commit-message  OpenRouter");
      expect(lines[2]).toBe("voice           Off");
      expect(lines).toContain(
        "  codex  Codex  plugin provider-codex  [thread-title, commit-message, voice]  Automatic #1  not ready: Run `codex login`",
      );
      expect(lines).toContain(
        "  helper  Other helper  plugin other-plugin  [thread-title, commit-message]  ready",
      );
    });

    it("sets automatic, off, and a service picked by id and plugin", async () => {
      const { put } = stubAiServices();

      await runCommand(
        ["settings", "ai-services", "set", "voice", "automatic"],
        register,
      );
      await runCommand(
        ["settings", "ai-services", "set", "thread-title", "off"],
        register,
      );
      await runCommand(
        [
          "settings",
          "ai-services",
          "set",
          "commit-message",
          "helper",
          "--plugin",
          "other-plugin",
        ],
        register,
      );

      expect(put.mock.calls.map(([request]) => request.json)).toEqual([
        { task: "voice", selection: { mode: "automatic" } },
        { task: "thread-title", selection: { mode: "off" } },
        {
          task: "commit-message",
          selection: {
            mode: "service",
            pluginId: "other-plugin",
            serviceId: "helper",
          },
        },
      ]);
      expect(console.log).toHaveBeenLastCalledWith(
        "commit-message: Other helper",
      );
    });

    it("refuses an ambiguous, unknown, or ineligible service without saving", async () => {
      const { put } = stubAiServices();

      await expect(
        runCommand(
          ["settings", "ai-services", "set", "thread-title", "helper"],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Several plugins register AI service 'helper': my-openrouter, other-plugin. Pass --plugin <plugin-id>.",
        ),
      );

      await expect(
        runCommand(
          ["settings", "ai-services", "set", "voice", "helper"],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "No AI service 'helper' handles voice. Choose automatic, off, or one of: codex.",
        ),
      );

      await expect(
        runCommand(
          ["settings", "ai-services", "set", "subtitles", "codex"],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Unknown task 'subtitles'. Tasks: thread-title, commit-message, voice",
        ),
      );
      expect(put).not.toHaveBeenCalled();
    });

    it("runs a test and reports a failure with a non-zero exit code", async () => {
      const { test } = stubAiServices();

      await runCommand(
        ["settings", "ai-services", "test", "commit-message"],
        register,
      );
      expect(test).toHaveBeenCalledWith({ json: { task: "commit-message" } });
      expect(console.log).toHaveBeenLastCalledWith(
        "OpenRouter (250ms): Add a dark mode toggle",
      );
      expect(process.exitCode).toBeUndefined();

      test.mockResolvedValueOnce({
        ok: false,
        message: "OpenRouter: bad key",
        durationMs: 40,
      } as never);
      await runCommand(
        ["settings", "ai-services", "test", "thread-title"],
        register,
      );
      expect(console.log).toHaveBeenLastCalledWith(
        "Failed after 40ms: OpenRouter: bad key",
      );
      expect(process.exitCode).toBe(1);

      await expect(
        runCommand(["settings", "ai-services", "test", "voice"], register),
      ).rejects.toThrow("process.exit:1");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Unknown task 'voice'. Testable tasks: thread-title, commit-message",
        ),
      );
    });
  });

  describe("prompts", () => {
    const LIST = {
      templates: [
        {
          defaultChanged: true,
          editingNotes: "Keep it short.",
          id: "generateThreadMetadata",
          intent: "Title threads.",
          kind: "prompt",
          modified: true,
          overrideBody: "Custom {{cleanedPrompt}}",
          summary: "Thread titles.",
          title: "Thread Metadata Generator",
          updatedAt: 123,
          variables: [],
        },
        {
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
        },
      ],
      orphaned: [
        {
          basedOnDefaultHash: "hash",
          body: "Orphaned body",
          templateId: "removedTemplate",
          updatedAt: 456,
        },
      ],
    };

    it("lists templates with modified and drift state, plus orphans", async () => {
      stubServerApi({
        "v1.settings.prompts.$get": vi.fn(async () => LIST),
      });

      await runCommand(["settings", "prompts", "list"], register);

      expect(collectLogLines(vi.mocked(console.log))).toEqual([
        "prompt        generateThreadMetadata  Thread Metadata Generator  [modified, default changed]",
        "instruction   bbGuideThreads  bb Guide — Threads",
        "orphaned      removedTemplate  [saved override; reset to remove]",
      ]);
    });

    it("prints the list as JSON", async () => {
      stubServerApi({
        "v1.settings.prompts.$get": vi.fn(async () => LIST),
      });

      await runCommand(["settings", "prompts", "list", "--json"], register);

      expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
        JSON.stringify(LIST, null, 2),
      ]);
    });

    it("gets a template body", async () => {
      const get = vi.fn(async () => ({
        template: {
          ...LIST.templates[0],
          body: "Custom {{cleanedPrompt}}",
          defaultBody: "Default {{cleanedPrompt}}",
        },
      }));
      stubServerApi({ "v1.settings.prompts.:id.$get": get });

      await runCommand(
        ["settings", "prompts", "get", "generateThreadMetadata"],
        register,
      );

      expect(get).toHaveBeenCalledWith({
        param: { id: "generateThreadMetadata" },
      });
      expect(collectLogLines(vi.mocked(console.log))).toEqual([
        "Custom {{cleanedPrompt}}",
      ]);
    });

    it("sets a template body inline and reports warnings", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const put = vi.fn(async ({ json }) => ({
        template: { ...LIST.templates[0], body: json.body },
        warnings: ["invokedCommands is no longer referenced"],
      }));
      stubServerApi({ "v1.settings.prompts.:id.$put": put });

      await runCommand(
        [
          "settings",
          "prompts",
          "set",
          "generateThreadMetadata",
          "--body",
          "Name this: {{cleanedPrompt}}",
        ],
        register,
      );

      expect(put).toHaveBeenCalledWith({
        json: { body: "Name this: {{cleanedPrompt}}" },
        param: { id: "generateThreadMetadata" },
      });
      expect(collectLogLines(vi.mocked(console.log))).toEqual([
        "generateThreadMetadata saved",
      ]);
      expect(warn).toHaveBeenCalledWith(
        "Warning: invokedCommands is no longer referenced",
      );
      warn.mockRestore();
    });

    it("sets a template body from a file", async () => {
      const put = vi.fn(async ({ json }) => ({
        template: { ...LIST.templates[0], body: json.body },
        warnings: [],
      }));
      stubServerApi({ "v1.settings.prompts.:id.$put": put });
      const directory = await mkdtemp(join(tmpdir(), "bb-prompts-"));
      const bodyPath = join(directory, "body.md");
      await writeFile(bodyPath, "File body: {{cleanedPrompt}}\n", "utf8");

      try {
        await runCommand(
          [
            "settings",
            "prompts",
            "set",
            "generateThreadMetadata",
            "--body-file",
            bodyPath,
          ],
          register,
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }

      expect(put).toHaveBeenCalledWith({
        json: { body: "File body: {{cleanedPrompt}}" },
        param: { id: "generateThreadMetadata" },
      });
    });

    it("resets a template and clears orphaned overrides", async () => {
      const del = vi.fn(async () => ({ template: null }));
      stubServerApi({ "v1.settings.prompts.:id.$delete": del });

      await runCommand(
        ["settings", "prompts", "reset", "removedTemplate"],
        register,
      );

      expect(del).toHaveBeenCalledWith({
        param: { id: "removedTemplate" },
      });
      expect(collectLogLines(vi.mocked(console.log))).toEqual([
        "removedTemplate cleared (orphaned override)",
      ]);
    });
  });
});
