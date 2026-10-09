// @vitest-environment jsdom

import { useState, type ComponentProps, type ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import {
  act,
  cleanup,
  fireEvent,
  render as renderWithoutProviders,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { MemoryRouter } from "react-router-dom";
import type { Host, PromptTextMention } from "@bb/domain";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SystemEnvironmentProvider,
  SystemMachineProvider,
} from "@bb/server-contract";
import {
  EnvironmentSlot,
  NewThreadPromptBoxUI,
  ProjectlessMachineSlot,
} from "./NewThreadPromptBox";
import { INERT_TYPEAHEAD_COMMAND_CONFIG } from "./PromptBoxInternal";
import { KeyboardSettingsSection } from "@/components/settings/KeyboardSettingsSection";
import { sdk } from "@/lib/sdk";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  createComposerQueryHarness,
  renderWithQueryClient,
} from "@/test/fixtures/plugins";

const host = makeHost({
  id: "host_test",
  name: "Local host",
});

function render(
  ui: ReactNode,
  queryClient: QueryClient = createComposerQueryHarness().queryClient,
) {
  return renderWithoutProviders(ui, {
    wrapper: ({ children }) =>
      renderWithQueryClient(
        <TooltipProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </TooltipProvider>,
        queryClient,
      ),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("ProjectlessMachineSlot", () => {
  const secondHost: Host = {
    ...host,
    id: "host_second",
    name: "Mac Studio",
  };

  const personalWorkspaceProvider: SystemEnvironmentProvider = {
    machineProviderId: null,
    id: "personal-workspace",
    displayName: "Personal workspace",
    description: "Prepare a workspace for this thread.",
    icon: "Folder",
    logoUrl: null,
    pluginId: "environment-personal-workspace",
    acceptsEmptyInputs: true,
    machineAvailability: {},
    availability: null,
    requires: {
      projectCheckout: false,
      gitCheckout: false,
      gitRemote: false,
      projectless: true,
    },
    inputs: null,
  };

  function makeEnvironment(overrides?: {
    selectedProviderHostId?: string;
    onSelectProvider?: (
      provider: SystemEnvironmentProvider,
      hostId: string | null,
    ) => void;
    machines?: {
      hosts: Host[];
      localDaemonHostId: string | null;
      primaryHostId: string | null;
    } | null;
    machineProviders?: readonly SystemMachineProvider[];
  }) {
    return {
      value: "provider:personal-workspace",
      sources: [],
      host,
      isLocal: true,
      machines:
        overrides && "machines" in overrides
          ? overrides.machines
          : {
              hosts: [host, secondHost],
              localDaemonHostId: host.id,
              primaryHostId: host.id,
            },
      providers: [personalWorkspaceProvider],
      machineProviders: overrides?.machineProviders,
      selectedProviderHostId: overrides?.selectedProviderHostId ?? host.id,
      onSelectProvider: overrides?.onSelectProvider ?? vi.fn(),
    };
  }

  it("renders no chip without multi-machine host data", () => {
    render(
      <ProjectlessMachineSlot
        environment={makeEnvironment({ machines: null })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Machine" })).toBeNull();
  });

  it("renders no chip with a single host", () => {
    render(
      <ProjectlessMachineSlot
        environment={makeEnvironment({
          machines: {
            hosts: [host],
            localDaemonHostId: host.id,
            primaryHostId: host.id,
          },
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Machine" })).toBeNull();
  });

  it("counts provider-made machines in the projectless machine chip", () => {
    const modalHost = makeHost({
      id: "host_modal",
      name: "Modal sandbox 3f9a",
      type: "ephemeral",
      machineProviderId: "modal-sandbox",
    });
    render(
      <ProjectlessMachineSlot
        environment={makeEnvironment({
          selectedProviderHostId: modalHost.id,
          machines: {
            hosts: [host, modalHost],
            localDaemonHostId: host.id,
            primaryHostId: host.id,
          },
          machineProviders: [
            {
              id: "modal-sandbox",
              displayName: "Modal Sandbox",
              description: "Run a machine for development.",
              icon: "Cloud",
              logoUrl: null,
              pluginId: "environment-modal-sandbox",
              inputs: null,
              acceptsEmptyInputs: true,
              supportsSuspend: true,
            },
          ],
        })}
      />,
    );

    const chip = screen.getByRole("button", { name: "Machine" });
    expect(chip.querySelector('[data-icon="Cloud"]')).not.toBeNull();
    expect(chip.querySelector('[data-icon="Laptop"]')).toBeNull();
    expect(chip.textContent).toContain(modalHost.name);
    expect(chip.textContent).not.toContain("Modal Sandbox");
  });

  it("routes a machine pick through the selected provider", () => {
    const onSelectProvider = vi.fn();
    render(
      <ProjectlessMachineSlot
        environment={makeEnvironment({
          selectedProviderHostId: secondHost.id,
          onSelectProvider,
        })}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Machine" });
    expect(trigger.textContent).toContain("Mac Studio");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Local host/u }));

    expect(onSelectProvider).toHaveBeenCalledWith(
      personalWorkspaceProvider,
      host.id,
    );
  });
});

describe("EnvironmentSlot", () => {
  const secondHost: Host = {
    ...host,
    id: "host_second",
    name: "Mac Studio",
  };

  const personalProvider: SystemEnvironmentProvider = {
    machineProviderId: null,
    id: "personal-workspace",
    displayName: "Personal workspace",
    description: "Prepare a workspace for this thread.",
    icon: "Folder",
    logoUrl: null,
    pluginId: "environment-personal-workspace",
    acceptsEmptyInputs: true,
    machineAvailability: {},
    availability: null,
    requires: {
      projectCheckout: false,
      gitCheckout: false,
      gitRemote: false,
      projectless: true,
    },
    inputs: null,
  };

  const sandboxProvider: SystemEnvironmentProvider = {
    machineProviderId: null,
    id: "modal-sandbox",
    displayName: "Modal sandbox",
    description: "Prepare a workspace for this thread.",
    icon: "Cloud",
    logoUrl: null,
    pluginId: "environment-modal-sandbox",
    acceptsEmptyInputs: true,
    machineAvailability: {},
    availability: null,
    requires: {
      projectCheckout: false,
      gitCheckout: false,
      gitRemote: false,
      projectless: false,
    },
    inputs: null,
  };

  const modalMachineProvider: SystemMachineProvider = {
    id: "modal-sandbox",
    displayName: "Modal sandbox",
    description: "Run a machine for development.",
    icon: "Box",
    logoUrl: null,
    pluginId: "environment-modal-sandbox",
    inputs: null,
    acceptsEmptyInputs: true,
    supportsSuspend: true,
  };

  function makeEnvironment(overrides: {
    isLoading?: boolean;
    value?: string;
    providers?: readonly SystemEnvironmentProvider[];
    machineProviders?: readonly SystemMachineProvider[];
    onSelectProvider?: (
      provider: SystemEnvironmentProvider,
      hostId: string | null,
    ) => void;
  }) {
    return {
      value: overrides.value ?? "provider:personal-workspace",
      sources: [],
      host,
      isLocal: true,
      machines: {
        hosts: [host, secondHost],
        localDaemonHostId: host.id,
        primaryHostId: host.id,
      },
      isLoading: overrides.isLoading ?? false,
      providers: overrides.providers ?? [personalProvider],
      selectedProviderHostId: host.id,
      onSelectProvider: overrides.onSelectProvider ?? vi.fn(),
      machineProviders: overrides.machineProviders,
    };
  }

  function makeWorktree(value: string | null = null) {
    return {
      options: [
        {
          environmentId: "env_personal",
          branchName: null,
          name: "Scratch space",
          path: null,
          environmentProviderId: "personal-workspace",
          threads: [{ id: "thr_1", title: "Earlier personal thread" }],
        },
      ],
      value,
      onChange: vi.fn(),
      disabled: false,
    };
  }

  it("shows environment loading before resolving to the machine slot", () => {
    const { rerender } = render(
      <EnvironmentSlot
        projectless
        environment={makeEnvironment({ providers: [], isLoading: true })}
        worktree={makeWorktree()}
      />,
    );
    expect(screen.getByRole("button", { name: "Environment" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Machine" })).toBeNull();
    rerender(
      <EnvironmentSlot
        projectless
        environment={makeEnvironment({
          providers: [personalProvider],
          isLoading: false,
        })}
        worktree={makeWorktree()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Environment" })).toBeNull();
    expect(screen.getByRole("button", { name: "Machine" })).not.toBeNull();
  });

  it("omits project-only providers from the projectless picker", () => {
    render(
      <EnvironmentSlot
        projectless
        environment={makeEnvironment({
          value: "provider:personal-workspace",
          providers: [personalProvider, sandboxProvider],
        })}
        worktree={makeWorktree()}
      />,
    );

    expect(screen.getByRole("button", { name: "Machine" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Environment" })).toBeNull();
    expect(screen.queryByText("Modal sandbox")).toBeNull();
  });

  it("keeps the machine slot when only one environment is available", () => {
    render(
      <EnvironmentSlot
        projectless
        environment={makeEnvironment({
          providers: [personalProvider],
          machineProviders: [modalMachineProvider],
        })}
        worktree={makeWorktree()}
      />,
    );
    expect(screen.getByRole("button", { name: "Machine" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Environment" })).toBeNull();
  });

  it("shows the reused environment instead of the machine slot when a thread reuses one", () => {
    render(
      <EnvironmentSlot
        projectless
        environment={makeEnvironment({
          value: "reuse:env_personal",
          providers: [personalProvider],
        })}
        worktree={makeWorktree("env_personal")}
      />,
    );

    expect(screen.queryByRole("button", { name: "Machine" })).toBeNull();
    const triggers = screen.getAllByRole("button", { name: "Environment" });
    expect(triggers).toHaveLength(2);
    expect(triggers[0]?.textContent).toContain("Reuse");
    expect(triggers[1]?.textContent).toContain("Scratch space");
  });

  it("keeps an open environment menu mounted while project scope replays", () => {
    const projectProvider = {
      ...sandboxProvider,
      requires: {
        ...sandboxProvider.requires,
        projectless: false,
      },
    };
    const environment = makeEnvironment({
      value: "reuse:env_personal",
      providers: [personalProvider, projectProvider],
    });
    const { rerender } = render(
      <EnvironmentSlot
        projectless={false}
        environment={environment}
        worktree={makeWorktree("env_personal")}
      />,
    );
    const trigger = screen.getAllByRole("button", { name: "Environment" })[0];
    fireEvent.click(trigger!);
    expect(screen.getByRole("dialog", { name: "Environment" })).toBeTruthy();

    rerender(
      <EnvironmentSlot
        projectless
        environment={environment}
        worktree={makeWorktree("env_personal")}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Environment" })).toBeTruthy();
    expect(document.querySelector('button[aria-label="Environment"]')).toBe(
      trigger,
    );
  });

  it("keeps an open environment menu mounted while projectless options settle", () => {
    const loadingEnvironment = makeEnvironment({
      providers: [personalProvider],
      isLoading: true,
    });
    const { rerender } = render(
      <EnvironmentSlot
        projectless
        environment={loadingEnvironment}
        worktree={makeWorktree()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Environment" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Environment" })).toBeTruthy();

    rerender(
      <EnvironmentSlot
        projectless
        environment={{ ...loadingEnvironment, isLoading: false }}
        worktree={makeWorktree()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Environment" })).toBeTruthy();
    expect(document.querySelector('button[aria-label="Environment"]')).toBe(
      trigger,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Environment" })).toBeNull();
    expect(screen.getByRole("button", { name: "Machine" })).toBeTruthy();
  });
});

type NewThreadPromptProps = ComponentProps<typeof NewThreadPromptBoxUI>;

function NewThreadComposer({
  onSubmit,
}: {
  onSubmit: NewThreadPromptProps["onSubmit"];
}) {
  const [value, setValue] = useState("Draft for a new thread");
  const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);
  return (
    <NewThreadPromptBoxUI
      value={value}
      mentionRanges={mentionRanges}
      onChange={(text, mentions) => {
        setValue(text);
        setMentionRanges(mentions);
      }}
      onSubmit={onSubmit}
      isSubmitting={false}
      disabled={false}
      autoFocus={false}
      mentionMenuPlacement="bottom"
      history={{
        currentDraft: { text: value, mentions: mentionRanges, attachments: [] },
        entries: [],
        onSelectEntry: vi.fn(),
      }}
      typeahead={{
        mention: {
          results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
          isLoading: false,
          isError: false,
          onQueryChange: vi.fn(),
        },
        command: INERT_TYPEAHEAD_COMMAND_CONFIG,
      }}
      attachments={{ items: [] }}
      modeConfig={{
        environment: {
          value: `host:${host.id}:local`,
          sources: [],
          host,
          isLocal: true,
          machines: null,
        },
        worktree: { options: [], value: null, onChange: vi.fn() },
        permission: { options: [], onChange: vi.fn(), supported: false },
      }}
      project={{ projects: [], value: null, onChange: vi.fn() }}
      execution={{
        provider: {},
        model: {
          selected: "",
          options: [],
          moreOptions: [],
          isLoading: false,
          loadFailed: false,
          onChange: vi.fn(),
        },
        reasoning: { value: "medium", options: [], onChange: vi.fn() },
      }}
    />
  );
}

function getNewThreadEditor() {
  const element = document.querySelector<TiptapEditorHTMLElement>(
    '[contenteditable="true"]',
  );
  const editor = element?.editor;
  if (!element || !editor) {
    throw new Error("New-thread editor was not mounted");
  }
  return { element, editor };
}

describe.each([
  {
    platform: "MacIntel",
    modifier: { metaKey: true },
    submitLabel: "⌘ Enter",
    ariaShortcut: "Meta+Enter",
  },
  {
    platform: "Win32",
    modifier: { ctrlKey: true },
    submitLabel: "Ctrl + Enter",
    ariaShortcut: "Control+Enter",
  },
  {
    platform: "Linux x86_64",
    modifier: { ctrlKey: true },
    submitLabel: "Ctrl + Enter",
    ariaShortcut: "Control+Enter",
  },
])(
  "NewThreadPromptBoxUI $platform browser modifier events",
  ({ platform, modifier, submitLabel, ariaShortcut }) => {
    it.each([false, true, "missing"] as const)(
      "keeps new-thread submission and newline affordances aligned with preference=%s",
      (preference) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        const harness = createComposerQueryHarness();
        if (preference === "missing") {
          const config = makeSystemConfig();
          const generalSettings = { ...config.generalSettings };
          Reflect.deleteProperty(generalSettings, "enterInsertsNewline");
          harness.queryClient.setQueryData(systemConfigQueryKey(), {
            ...config,
            generalSettings,
          });
        } else {
          harness.setGeneralSettings({ enterInsertsNewline: preference });
        }
        const onSubmit = vi.fn();
        render(<NewThreadComposer onSubmit={onSubmit} />, harness.queryClient);
        const { element, editor } = getNewThreadEditor();
        act(() => {
          element.focus();
          editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        });
        const enabled = preference === true;
        const sendButton = screen.getByRole("button", {
          name: `Submit (${enabled ? submitLabel : "Enter"})`,
        });
        expect(element.getAttribute("enterkeyhint")).toBe(
          enabled ? "enter" : "send",
        );
        expect(element.getAttribute("aria-keyshortcuts")).toBe(
          enabled ? ariaShortcut : null,
        );
        expect(sendButton.getAttribute("aria-keyshortcuts")).toBe(
          enabled ? ariaShortcut : null,
        );

        fireEvent.keyDown(element, { key: "Enter", shiftKey: true });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(editor.getText({ blockSeparator: "\n" })).toBe(
          "Draft for a new thread\n",
        );
        fireEvent.keyDown(element, { key: "Enter" });
        if (enabled) {
          expect(onSubmit).not.toHaveBeenCalled();
          expect(editor.getText({ blockSeparator: "\n" })).toBe(
            "Draft for a new thread\n\n",
          );
        } else {
          expect(onSubmit).toHaveBeenCalledOnce();
        }
        onSubmit.mockClear();

        fireEvent.keyDown(element, {
          key: "Enter",
          ...modifier,
          shiftKey: true,
        });
        expect(onSubmit).not.toHaveBeenCalled();
        fireEvent.keyDown(element, { key: "Enter", ...modifier });
        expect(onSubmit).toHaveBeenCalledOnce();
        fireEvent.click(sendButton);
        expect(onSubmit).toHaveBeenCalledTimes(2);
      },
    );
  },
);

it("applies saved keyboard changes to the mounted new-thread composer and retains the mode on cache-backed remount", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const harness = createComposerQueryHarness();
  const onSubmit = vi.fn();
  const enabledSettings = {
    ...makeSystemConfig().generalSettings,
    enterInsertsNewline: true,
  };
  const updateSettings = vi
    .spyOn(sdk.system, "updateGeneralSettings")
    .mockResolvedValue(enabledSettings);
  const config = vi
    .spyOn(sdk.system, "config")
    .mockResolvedValue(makeSystemConfig({ generalSettings: enabledSettings }));
  const composer = (
    <>
      <KeyboardSettingsSection />
      <NewThreadComposer onSubmit={onSubmit} />
    </>
  );
  const view = render(composer, harness.queryClient);
  const { element, editor } = getNewThreadEditor();
  act(() => {
    element.focus();
    editor.commands.setTextSelection({ from: 2, to: 6 });
  });
  const draft = editor.getJSON();
  fireEvent.click(
    screen.getByRole("switch", { name: "Enter inserts a newline" }),
  );
  await waitFor(() => {
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enterInsertsNewline: true }),
    );
    expect(
      screen.getByRole("button", { name: "Submit (⌘ Enter)" }),
    ).toBeTruthy();
    expect(element.getAttribute("enterkeyhint")).toBe("enter");
    expect(config).toHaveBeenCalled();
  });
  expect(getNewThreadEditor().element).toBe(element);
  expect(getNewThreadEditor().editor).toBe(editor);
  expect(editor.getJSON()).toEqual(draft);
  expect(editor.state.selection.from).toBe(2);
  expect(editor.state.selection.to).toBe(6);
  expect(element.getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
  expect(
    screen
      .getByRole("button", { name: "Submit (⌘ Enter)" })
      .getAttribute("aria-keyshortcuts"),
  ).toBe("Meta+Enter");
  act(() =>
    editor.commands.setTextSelection(editor.state.doc.content.size - 1),
  );
  fireEvent.keyDown(element, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(editor.getText({ blockSeparator: "\n" })).toBe(
    "Draft for a new thread\n",
  );
  fireEvent.keyDown(element, {
    key: "Enter",
    metaKey: true,
    shiftKey: true,
  });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(element, { key: "Enter", metaKey: true });
  expect(onSubmit).toHaveBeenCalledOnce();
  onSubmit.mockClear();

  view.rerender(<KeyboardSettingsSection />);
  view.rerender(composer);
  const remounted = getNewThreadEditor();
  expect(remounted.element).not.toBe(element);
  expect(screen.getByRole("button", { name: "Submit (⌘ Enter)" })).toBeTruthy();
  expect(remounted.element.getAttribute("enterkeyhint")).toBe("enter");
  act(() => {
    remounted.element.focus();
    remounted.editor.commands.setTextSelection(
      remounted.editor.state.doc.content.size - 1,
    );
  });
  fireEvent.keyDown(remounted.element, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(remounted.editor.getText({ blockSeparator: "\n" })).toBe(
    "Draft for a new thread\n",
  );
  fireEvent.keyDown(remounted.element, { key: "Enter", metaKey: true });
  expect(onSubmit).toHaveBeenCalledOnce();

  updateSettings.mockResolvedValue(makeSystemConfig().generalSettings);
  config.mockResolvedValue(makeSystemConfig());
  fireEvent.click(
    screen.getByRole("switch", { name: "Enter inserts a newline" }),
  );
  await waitFor(() => {
    expect(updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ enterInsertsNewline: false }),
    );
    expect(screen.getByRole("button", { name: "Submit (Enter)" })).toBeTruthy();
    expect(remounted.element.getAttribute("enterkeyhint")).toBe("send");
  });
  expect(getNewThreadEditor().element).toBe(remounted.element);
  expect(remounted.element.getAttribute("aria-keyshortcuts")).toBeNull();
  fireEvent.keyDown(remounted.element, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledTimes(2);
});
