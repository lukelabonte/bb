// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AppKeybindings,
  AppShortcut,
  PromptTextMention,
} from "@bb/domain";
import type { TerminalCreateTarget } from "@bb/server-contract";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { useState, type ComponentProps } from "react";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import {
  AppCommandProvider,
  useAppCommandHandler,
  useIsAppCommandModifierHeld,
} from "@/components/commands/AppCommandProvider";
import { usePanelTerminals } from "@/components/secondary-panel/usePanelTerminals";
import { SidebarSplitContainer } from "@/components/secondary-panel/SidebarSplitContainer";
import {
  resetFixedPanelTabsStateForTest,
  useFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import { sdk } from "@/lib/sdk";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import {
  createComposerQueryHarness,
  renderWithQueryClient,
} from "@/test/fixtures/plugins";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { DEFAULT_APP_KEYBINDINGS } from "../../../../server/src/services/system/app-keybindings";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
} from "./PromptBoxInternal";

const testState = vi.hoisted(() => ({
  calls: [] as string[],
  composerInputLocked: false,
  sidebarHandlerResult: true,
  sidebarShortcut: {
    key: "\\",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  } as AppShortcut,
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

vi.mock("@/lib/plugin-sdk-hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plugin-sdk-hooks")>()),
  useComposerInputLock: () => testState.composerInputLocked,
}));

function SidebarToggleHandler() {
  useAppCommandHandler("sidebar.toggle", () => {
    testState.calls.push("sidebar.toggle");
    return testState.sidebarHandlerResult;
  });
  return null;
}

function ThreadNavigationHandlers() {
  useAppCommandHandler("thread.previous", () => {
    testState.calls.push("thread.previous");
    return true;
  });
  useAppCommandHandler("thread.next", () => {
    testState.calls.push("thread.next");
    return true;
  });
  return null;
}

function ShortcutHintState() {
  return (
    <span>{useIsAppCommandModifierHeld() ? "hint-held" : "hint-released"}</span>
  );
}

type ComposerProps = ComponentProps<typeof PromptBoxInternal>;

const PANEL_NAVIGATION_KEYBINDINGS: AppKeybindings = [
  {
    command: "panel.nextTab",
    desktopOnly: false,
    shortcut: {
      key: "Enter",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
  {
    command: "panel.previousTab",
    desktopOnly: false,
    shortcut: {
      key: "ArrowLeft",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
];

function renderComposer(
  extra: React.ReactNode = null,
  {
    enterInsertsNewline = false,
    keybindings = [],
    ...props
  }: Partial<ComposerProps> & {
    enterInsertsNewline?: boolean;
    keybindings?: AppKeybindings;
  } = {},
) {
  const harness = createComposerQueryHarness();
  harness.queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      keybindings: [
        ...DEFAULT_APP_KEYBINDINGS.flatMap((binding) =>
          binding.command === "terminal.open" && binding.shortcut !== null
            ? [{ ...binding, shortcut: binding.shortcut }]
            : [],
        ),
        ...(["thread.previous", "thread.next"] as const).map(
          (command, index) => ({
            command,
            desktopOnly: false,
            shortcut: {
              key: index === 0 ? "ArrowUp" : "ArrowDown",
              mod: true,
              meta: false,
              control: false,
              alt: false,
              shift: true,
            },
            when: { all: ["mainSurface" as const], none: [] },
          }),
        ),
        {
          command: "sidebar.toggle",
          desktopOnly: false,
          shortcut: testState.sidebarShortcut,
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
        ...keybindings,
      ],
      defaultKeybindings: DEFAULT_APP_KEYBINDINGS,
    }),
  );
  harness.setGeneralSettings({ enterInsertsNewline });
  function Composer() {
    const [value, setValue] = useState(props.value ?? "");
    const [mentionRanges, setMentionRanges] = useState<
      readonly PromptTextMention[]
    >(props.mentionRanges ?? []);
    return (
      <PromptBoxInternal
        onSubmit={vi.fn()}
        mentionMenuPlacement="bottom"
        typeahead={{
          mention: {
            results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
            isLoading: false,
            isError: false,
            onQueryChange: vi.fn(),
          },
          command: INERT_TYPEAHEAD_COMMAND_CONFIG,
        }}
        {...props}
        value={value}
        mentionRanges={mentionRanges}
        onChange={(nextValue, nextMentions) => {
          setValue(nextValue);
          setMentionRanges(nextMentions);
          props.onChange?.(nextValue, nextMentions);
        }}
      />
    );
  }
  render(
    renderWithQueryClient(
      <MemoryRouter>
        <AppCommandProvider>
          <SidebarToggleHandler />
          {extra}
          <Composer />
          <button type="button">Outside composer</button>
        </AppCommandProvider>
      </MemoryRouter>,
      harness.queryClient,
    ),
  );
  const editor = document.querySelector<
    TiptapEditorHTMLElement & { editor: Editor }
  >("[data-promptbox-editor-content] [contenteditable]");
  if (!editor?.editor) throw new Error("prompt editor did not render");
  act(() => {
    editor.editor.commands.setTextSelection(
      editor.editor.state.doc.content.size - 1,
    );
    editor.focus();
  });
  return editor;
}

function TerminalPanel({
  isFocused = true,
  createTarget = { kind: "host_path", hostId: "host_test", cwd: "/workspace" },
}: {
  isFocused?: boolean;
  createTarget?: TerminalCreateTarget | null;
}) {
  usePanelTerminals({
    panelStateId: "shortcut-terminal-panel",
    syncThreadId: null,
    createTarget,
    isFocused,
    acceptsSession: () => true,
    tabsCarryTarget: true,
    reveal: () => undefined,
  });
  const state = useFixedPanelTabsState("shortcut-terminal-panel", null);
  const activeTab = state.secondary.tabs.find(
    (tab) => tab.id === state.secondary.activeTabId,
  );
  return (
    <output aria-label="Active terminal">
      {activeTab?.kind === "terminal" ? activeTab.terminalId : "No terminal"}
    </output>
  );
}

function NavigablePanel() {
  const [activeTabId, setActiveTabId] = useState("tab-a");
  return (
    <>
      <TerminalPanel />
      <SidebarSplitContainer
        activeTabId={activeTabId}
        isFullScreen={false}
        onActivateTab={setActiveTabId}
        onGlobalTabReorder={() => undefined}
        onToggleFullScreen={() => undefined}
        panelStateId="shortcut-navigation-panel"
        renderPane={({ group }) => (
          <output aria-label="Active navigation tab">
            {group.activeTabId}
          </output>
        )}
        tabs={[
          { id: "tab-a", label: "A", restoresPlacementAfterRemoval: true },
          { id: "tab-b", label: "B", restoresPlacementAfterRemoval: true },
        ]}
      />
    </>
  );
}

function pressInEditor(
  editor: HTMLElement,
  init: KeyboardEventInit,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  editor.dispatchEvent(event);
  return event;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  resetFixedPanelTabsStateForTest();
  testState.calls.length = 0;
  testState.composerInputLocked = false;
  testState.sidebarHandlerResult = true;
  testState.sidebarShortcut = {
    key: "\\",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  };
});

describe("prompt editor app shortcuts", () => {
  it.each([
    ["ArrowUp", "thread.previous"],
    ["ArrowDown", "thread.next"],
  ])("runs the configured Meta+Shift+%s app shortcut", (key, command) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const editor = renderComposer(<ThreadNavigationHandlers />);

    const event = pressInEditor(editor, {
      key,
      metaKey: true,
      shiftKey: true,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(testState.calls).toEqual([command]);
    expect(document.activeElement).toBe(editor);
  });

  it("runs the sidebar shortcut while the composer has focus", () => {
    const editor = renderComposer();

    const event = pressInEditor(editor, { ctrlKey: true, key: "\\" });

    expect(testState.calls).toEqual(["sidebar.toggle"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("runs a sidebar shortcut whose chord the editor keymap also claims", () => {
    testState.sidebarShortcut = {
      key: "b",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    };
    const editor = renderComposer();

    pressInEditor(editor, {
      code: "KeyB",
      ctrlKey: true,
      key: "B",
      shiftKey: true,
    });

    expect(testState.calls).toEqual(["sidebar.toggle"]);
  });

  it("offers a declined chord to the handlers only once", () => {
    testState.sidebarHandlerResult = false;
    const editor = renderComposer();

    const event = pressInEditor(editor, { ctrlKey: true, key: "\\" });

    expect(testState.calls).toEqual(["sidebar.toggle"]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the keyboard hint until modifier release when the composer runs a shortcut", () => {
    vi.useFakeTimers();
    try {
      const editor = renderComposer(<ShortcutHintState />);
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }),
      );
      act(() => vi.advanceTimersByTime(700));
      expect(screen.getByText("hint-held")).toBeDefined();

      act(() => {
        pressInEditor(editor, { ctrlKey: true, key: "\\" });
      });

      expect(testState.calls).toEqual(["sidebar.toggle"]);
      expect(screen.getByText("hint-held")).toBeDefined();
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
      });
      expect(screen.getByText("hint-released")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases focus on Escape while a plugin locks the composer", () => {
    testState.composerInputLocked = true;
    const editor = renderComposer();
    expect(editor.getAttribute("contenteditable")).toBe("false");
    editor.focus();
    expect(document.activeElement).toBe(editor);

    pressInEditor(editor, { key: "Escape" });

    expect(document.activeElement).not.toBe(editor);
  });

  it("keeps typed text in the composer", () => {
    const editor = renderComposer();

    const event = pressInEditor(editor, { code: "KeyB", key: "b" });

    expect(testState.calls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe.each([
  { platform: "MacIntel", modifiers: { metaKey: true } },
  { platform: "Win32", modifiers: { ctrlKey: true } },
  { platform: "Linux x86_64", modifiers: { ctrlKey: true } },
])(
  "terminal and composer shortcut precedence on $platform",
  ({ platform, modifiers }) => {
    it.each([
      {
        mode: "off with alternate",
        enabled: false,
        hasAlternate: true,
        swap: false,
        winner: "terminal",
      },
      {
        mode: "on with alternate",
        enabled: true,
        hasAlternate: true,
        swap: false,
        winner: "immediate",
      },
      {
        mode: "on without alternate",
        enabled: true,
        hasAlternate: false,
        swap: false,
        winner: "terminal",
      },
      {
        mode: "on with swapped resolved alternate",
        enabled: true,
        hasAlternate: false,
        swap: true,
        winner: "draft",
      },
    ])(
      "routes the default terminal chord in $mode",
      async ({ enabled, hasAlternate, swap, winner }) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        const createTerminal = vi
          .spyOn(sdk.terminals, "create")
          .mockResolvedValue(
            makeTerminalSession({ threadId: null, environmentId: null }),
          );
        const draft = vi.fn();
        const immediate = vi.fn();
        const editor = renderComposer(<TerminalPanel />, {
          enterInsertsNewline: enabled,
          value: "Follow up",
          onSubmit: draft,
          submission: {
            onModifierSubmit: hasAlternate ? immediate : undefined,
            swapSubmitActions: swap,
          },
        });

        let event!: KeyboardEvent;
        await act(async () => {
          event = pressInEditor(editor, {
            key: "Enter",
            code: "Enter",
            shiftKey: true,
            ...modifiers,
          });
        });

        expect(event.defaultPrevented).toBe(true);
        expect(draft).toHaveBeenCalledTimes(winner === "draft" ? 1 : 0);
        expect(immediate).toHaveBeenCalledTimes(winner === "immediate" ? 1 : 0);
        if (winner === "terminal") {
          await waitFor(() =>
            expect(screen.getByLabelText("Active terminal").textContent).toBe(
              "term_test",
            ),
          );
          expect(createTerminal).toHaveBeenCalledOnce();
          expect(createTerminal).toHaveBeenCalledWith(
            expect.objectContaining({
              scope: {
                kind: "host_path",
                hostId: "host_test",
                cwd: "/workspace",
              },
            }),
          );
        } else {
          expect(createTerminal).not.toHaveBeenCalled();
          expect(screen.getByLabelText("Active terminal").textContent).toBe(
            "No terminal",
          );
        }
      },
    );

    it("keeps the terminal command outside the composer when the preference is on", async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const createTerminal = vi
        .spyOn(sdk.terminals, "create")
        .mockResolvedValue(
          makeTerminalSession({ threadId: null, environmentId: null }),
        );
      const alternate = vi.fn();
      renderComposer(<TerminalPanel />, {
        enterInsertsNewline: true,
        value: "Follow up",
        submission: { onModifierSubmit: alternate },
      });
      const outside = screen.getByRole("button", { name: "Outside composer" });
      outside.focus();

      await act(async () => {
        pressInEditor(outside, {
          key: "Enter",
          code: "Enter",
          shiftKey: true,
          ...modifiers,
        });
      });

      await waitFor(() =>
        expect(screen.getByLabelText("Active terminal").textContent).toBe(
          "term_test",
        ),
      );
      expect(createTerminal).toHaveBeenCalledOnce();
      expect(alternate).not.toHaveBeenCalled();
    });

    it.each(
      [
        {
          unavailable: "unfocused panel",
          isFocused: false,
          createTarget: {
            kind: "host_path" as const,
            hostId: "host_test",
            cwd: null,
          },
        },
        { unavailable: "missing target", isFocused: true, createTarget: null },
      ].flatMap((panel) =>
        [false, true].map((enabled) => ({ ...panel, enabled })),
      ),
    )(
      "preserves editor fallthrough with $unavailable, no alternate, and enterInsertsNewline=$enabled",
      async ({ isFocused, createTarget, enabled }) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        const createTerminal = vi
          .spyOn(sdk.terminals, "create")
          .mockResolvedValue(makeTerminalSession());
        const primary = vi.fn();
        const changes = vi.fn();
        const editor = renderComposer(
          <TerminalPanel isFocused={isFocused} createTarget={createTarget} />,
          {
            enterInsertsNewline: enabled,
            value: "First line",
            onSubmit: primary,
            onChange: changes,
          },
        );
        const before = editor.editor.getJSON();
        let event!: KeyboardEvent;

        await act(async () => {
          event = pressInEditor(editor, {
            key: "Enter",
            code: "Enter",
            shiftKey: true,
            ...modifiers,
          });
        });

        expect(createTerminal).not.toHaveBeenCalled();
        expect(primary).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        expect(changes).not.toHaveBeenCalled();
        expect(editor.editor.getJSON()).toEqual(before);
      },
    );

    it("does not open a terminal as a fallback for a disabled resolved alternate", async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const createTerminal = vi
        .spyOn(sdk.terminals, "create")
        .mockResolvedValue(makeTerminalSession());
      const alternate = vi.fn();
      const primary = vi.fn();
      const editor = renderComposer(<TerminalPanel />, {
        enterInsertsNewline: true,
        value: "Follow up",
        onSubmit: primary,
        submission: { onModifierSubmit: alternate, disabled: true },
      });

      await act(async () => {
        pressInEditor(editor, {
          key: "Enter",
          code: "Enter",
          shiftKey: true,
          ...modifiers,
        });
      });

      expect(alternate).not.toHaveBeenCalled();
      expect(primary).not.toHaveBeenCalled();
      expect(createTerminal).not.toHaveBeenCalled();
    });

    it("applies slash completion before the winning alternate submission", async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const createTerminal = vi
        .spyOn(sdk.terminals, "create")
        .mockResolvedValue(makeTerminalSession());
      const primary = vi.fn();
      const alternate = vi.fn();
      const changes = vi.fn();
      const editor = renderComposer(<TerminalPanel />, {
        enterInsertsNewline: true,
        value: "/",
        onChange: changes,
        onSubmit: primary,
        submission: { onModifierSubmit: alternate },
        typeahead: {
          mention: {
            results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
            isLoading: false,
            isError: false,
            onQueryChange: vi.fn(),
          },
          command: {
            ...INERT_TYPEAHEAD_COMMAND_CONFIG,
            triggers: ["/"],
            suggestions: [
              {
                kind: "command",
                name: "review",
                source: "skill",
                origin: "user",
                description: null,
                argumentHint: null,
              },
            ],
          },
        },
      });
      await screen.findByRole("button", { name: "review" });

      await act(async () => {
        pressInEditor(editor, {
          key: "Enter",
          code: "Enter",
          shiftKey: true,
          ...modifiers,
        });
      });

      expect(changes).toHaveBeenLastCalledWith(
        "/review ",
        expect.arrayContaining([
          expect.objectContaining({
            resource: expect.objectContaining({
              kind: "command",
              name: "review",
            }),
          }),
        ]),
      );
      expect(primary).not.toHaveBeenCalled();
      expect(alternate).not.toHaveBeenCalled();
      expect(createTerminal).not.toHaveBeenCalled();
    });

    it.each([
      { guard: "isComposing", isComposing: true, keyCode: 13 },
      { guard: "keyCode 229", isComposing: false, keyCode: 229 },
    ])(
      "keeps $guard ahead of the winning alternate chord",
      async ({ isComposing, keyCode }) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        const createTerminal = vi
          .spyOn(sdk.terminals, "create")
          .mockResolvedValue(makeTerminalSession());
        const alternate = vi.fn();
        const primary = vi.fn();
        const changes = vi.fn();
        const editor = renderComposer(<TerminalPanel />, {
          enterInsertsNewline: true,
          value: "候補",
          onChange: changes,
          onSubmit: primary,
          submission: { onModifierSubmit: alternate },
        });
        const before = editor.editor.getJSON();
        fireEvent.compositionStart(editor, { data: "候補" });

        await act(async () => {
          pressInEditor(editor, {
            key: "Enter",
            code: "Enter",
            shiftKey: true,
            isComposing,
            keyCode,
            ...modifiers,
          });
        });

        expect(editor.editor.getJSON()).toEqual(before);
        expect(changes).not.toHaveBeenCalled();
        expect(primary).not.toHaveBeenCalled();
        expect(alternate).not.toHaveBeenCalled();
        expect(createTerminal).not.toHaveBeenCalled();
        fireEvent.compositionEnd(editor, { data: "候補" });
      },
    );
  },
);

it("keeps Safari postcomposition ahead of the alternate and terminal collision", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("iPad");
  vi.spyOn(navigator, "vendor", "get").mockReturnValue("Apple Computer, Inc.");
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (iPad) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  );
  const createTerminal = vi
    .spyOn(sdk.terminals, "create")
    .mockResolvedValue(makeTerminalSession());
  const primary = vi.fn();
  const alternate = vi.fn();
  const changes = vi.fn();
  const element = renderComposer(<TerminalPanel />, {
    enterInsertsNewline: true,
    value: "候補",
    onSubmit: primary,
    onChange: changes,
    submission: { onModifierSubmit: alternate },
  });
  const before = element.editor.getJSON();
  fireEvent.compositionStart(element, { data: "候補" });
  const ended = new CompositionEvent("compositionend", {
    bubbles: true,
    data: "候補",
  });
  fireEvent(element, ended);
  const immediate = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    metaKey: true,
    shiftKey: true,
  });
  Object.defineProperty(immediate, "timeStamp", { value: ended.timeStamp + 1 });

  fireEvent(element, immediate);
  await act(async () => {});

  expect(element.editor.getJSON()).toEqual(before);
  expect(changes).not.toHaveBeenCalled();
  expect(primary).not.toHaveBeenCalled();
  expect(alternate).not.toHaveBeenCalled();
  expect(createTerminal).not.toHaveBeenCalled();
  await waitFor(() => expect(element.editor.view.composing).toBe(false));
  const later = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    metaKey: true,
    shiftKey: true,
  });
  Object.defineProperty(later, "timeStamp", { value: ended.timeStamp + 1000 });

  fireEvent(element, later);
  await act(async () => {});

  expect(alternate).toHaveBeenCalledOnce();
  expect(primary).not.toHaveBeenCalled();
  expect(createTerminal).not.toHaveBeenCalled();
});

describe.each([
  { platform: "MacIntel", modifiers: { metaKey: true } },
  { platform: "Win32", modifiers: { ctrlKey: true } },
  { platform: "Linux x86_64", modifiers: { ctrlKey: true } },
])(
  "captured panel navigation and composer precedence on $platform",
  ({ platform, modifiers }) => {
    it.each([
      {
        mode: "off with alternate",
        enabled: false,
        hasAlternate: true,
        swap: false,
        value: "Follow up",
        winner: "navigation",
      },
      {
        mode: "on with alternate",
        enabled: true,
        hasAlternate: true,
        swap: false,
        value: "Follow up",
        winner: "immediate",
      },
      {
        mode: "on without alternate",
        enabled: true,
        hasAlternate: false,
        swap: false,
        value: "Follow up",
        winner: "navigation",
      },
      {
        mode: "on with swapped resolved alternate",
        enabled: true,
        hasAlternate: false,
        swap: true,
        value: "Follow up",
        winner: "draft",
      },
      {
        mode: "on with intentionally empty immediate action",
        enabled: true,
        hasAlternate: true,
        swap: false,
        value: "",
        winner: "immediate",
      },
    ])(
      "routes rebound panel.nextTab in $mode",
      async ({ enabled, hasAlternate, swap, value, winner }) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        const createTerminal = vi
          .spyOn(sdk.terminals, "create")
          .mockResolvedValue(
            makeTerminalSession({ threadId: null, environmentId: null }),
          );
        const draft = vi.fn();
        const immediate = vi.fn();
        const editor = renderComposer(<NavigablePanel />, {
          keybindings: PANEL_NAVIGATION_KEYBINDINGS,
          enterInsertsNewline: enabled,
          value,
          onSubmit: draft,
          submission: {
            isRunning: true,
            onModifierSubmit: hasAlternate ? immediate : undefined,
            swapSubmitActions: swap,
          },
        });
        expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
          "tab-a",
        );

        let event!: KeyboardEvent;
        await act(async () => {
          event = pressInEditor(editor, {
            key: "Enter",
            code: "Enter",
            shiftKey: true,
            ...modifiers,
          });
        });

        expect(event.defaultPrevented).toBe(true);
        expect(draft).toHaveBeenCalledTimes(winner === "draft" ? 1 : 0);
        expect(immediate).toHaveBeenCalledTimes(winner === "immediate" ? 1 : 0);
        expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
          winner === "navigation" ? "tab-b" : "tab-a",
        );
        expect(createTerminal).not.toHaveBeenCalled();
        expect(screen.getByLabelText("Active terminal").textContent).toBe(
          "No terminal",
        );
      },
    );

    it("preserves the rebound chord outside the composer and another captured navigation chord inside it", async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const createTerminal = vi
        .spyOn(sdk.terminals, "create")
        .mockResolvedValue(makeTerminalSession());
      const primary = vi.fn();
      const alternate = vi.fn();
      const editor = renderComposer(<NavigablePanel />, {
        keybindings: PANEL_NAVIGATION_KEYBINDINGS,
        enterInsertsNewline: true,
        value: "Follow up",
        onSubmit: primary,
        submission: { onModifierSubmit: alternate },
      });
      const outside = screen.getByRole("button", { name: "Outside composer" });
      outside.focus();

      let outsideEvent!: KeyboardEvent;
      await act(async () => {
        outsideEvent = pressInEditor(outside, {
          key: "Enter",
          code: "Enter",
          shiftKey: true,
          ...modifiers,
        });
      });

      expect(outsideEvent.defaultPrevented).toBe(true);
      expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
        "tab-b",
      );
      expect(alternate).not.toHaveBeenCalled();
      editor.focus();

      let navigationEvent!: KeyboardEvent;
      await act(async () => {
        navigationEvent = pressInEditor(editor, {
          key: "ArrowLeft",
          code: "ArrowLeft",
          shiftKey: true,
          ...modifiers,
        });
      });

      expect(navigationEvent.defaultPrevented).toBe(true);
      expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
        "tab-a",
      );
      expect(alternate).not.toHaveBeenCalled();
      expect(primary).not.toHaveBeenCalled();
      expect(createTerminal).not.toHaveBeenCalled();
    });

    it.each([
      {
        restriction: "disabled",
        value: "Follow up",
        submission: { disabled: true },
        attachments: {},
        swap: false,
      },
      {
        restriction: "submitting",
        value: "Follow up",
        submission: { isSubmitting: true },
        attachments: {},
        swap: false,
      },
      {
        restriction: "attaching",
        value: "Follow up",
        submission: {},
        attachments: { isAttaching: true },
        swap: false,
      },
      {
        restriction: "empty input-required resolved alternate",
        value: "",
        submission: {},
        attachments: {},
        swap: true,
      },
    ])(
      "does not fall through to primary submission or panel navigation when $restriction",
      async ({ value, submission, attachments, swap }) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        const createTerminal = vi
          .spyOn(sdk.terminals, "create")
          .mockResolvedValue(makeTerminalSession());
        const draft = vi.fn();
        const immediate = vi.fn();
        const editor = renderComposer(<NavigablePanel />, {
          keybindings: PANEL_NAVIGATION_KEYBINDINGS,
          enterInsertsNewline: true,
          value,
          onSubmit: draft,
          submission: {
            ...submission,
            onModifierSubmit: immediate,
            swapSubmitActions: swap,
          },
          attachments,
        });

        let event!: KeyboardEvent;
        await act(async () => {
          event = pressInEditor(editor, {
            key: "Enter",
            code: "Enter",
            shiftKey: true,
            ...modifiers,
          });
        });

        expect(event.defaultPrevented).toBe(true);
        expect(draft).not.toHaveBeenCalled();
        expect(immediate).not.toHaveBeenCalled();
        expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
          "tab-a",
        );
        expect(createTerminal).not.toHaveBeenCalled();
        const outside = screen.getByRole("button", {
          name: "Outside composer",
        });
        outside.focus();

        await act(async () => {
          pressInEditor(outside, {
            key: "Enter",
            code: "Enter",
            shiftKey: true,
            ...modifiers,
          });
        });

        expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
          "tab-b",
        );
        expect(draft).not.toHaveBeenCalled();
        expect(immediate).not.toHaveBeenCalled();
        expect(createTerminal).not.toHaveBeenCalled();
      },
    );

    it("completes the selected slash command before submission or captured panel navigation", async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const createTerminal = vi
        .spyOn(sdk.terminals, "create")
        .mockResolvedValue(makeTerminalSession());
      const primary = vi.fn();
      const alternate = vi.fn();
      const changes = vi.fn();
      const editor = renderComposer(<NavigablePanel />, {
        keybindings: PANEL_NAVIGATION_KEYBINDINGS,
        enterInsertsNewline: true,
        value: "/",
        onSubmit: primary,
        onChange: changes,
        submission: { onModifierSubmit: alternate },
        typeahead: {
          mention: {
            results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
            isLoading: false,
            isError: false,
            onQueryChange: vi.fn(),
          },
          command: {
            ...INERT_TYPEAHEAD_COMMAND_CONFIG,
            triggers: ["/"],
            suggestions: [
              {
                kind: "command",
                name: "review",
                source: "skill",
                origin: "user",
                description: null,
                argumentHint: null,
              },
            ],
          },
        },
      });
      await screen.findByRole("button", { name: "review" });

      await act(async () => {
        pressInEditor(editor, {
          key: "Enter",
          code: "Enter",
          shiftKey: true,
          ...modifiers,
        });
      });

      expect(changes).toHaveBeenLastCalledWith(
        "/review ",
        expect.arrayContaining([
          expect.objectContaining({
            resource: expect.objectContaining({
              kind: "command",
              name: "review",
            }),
          }),
        ]),
      );
      expect(primary).not.toHaveBeenCalled();
      expect(alternate).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
        "tab-a",
      );
      expect(createTerminal).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "review" })).toBeNull(),
      );

      await act(async () => {
        pressInEditor(editor, {
          key: "Enter",
          code: "Enter",
          shiftKey: true,
          ...modifiers,
        });
      });

      expect(alternate).toHaveBeenCalledOnce();
      expect(primary).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
        "tab-a",
      );
      expect(createTerminal).not.toHaveBeenCalled();
    });

    it.each([
      { guard: "isComposing alone", isComposing: true, keyCode: 13 },
      { guard: "keyCode 229 alone", isComposing: false, keyCode: 229 },
    ])(
      "keeps $guard ahead of submission and captured panel navigation",
      async ({ isComposing, keyCode }) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        const createTerminal = vi
          .spyOn(sdk.terminals, "create")
          .mockResolvedValue(makeTerminalSession());
        const primary = vi.fn();
        const alternate = vi.fn();
        const changes = vi.fn();
        const editor = renderComposer(<NavigablePanel />, {
          keybindings: PANEL_NAVIGATION_KEYBINDINGS,
          enterInsertsNewline: true,
          value: "候補",
          onSubmit: primary,
          onChange: changes,
          submission: { onModifierSubmit: alternate },
        });
        const before = editor.editor.getJSON();

        await act(async () => {
          pressInEditor(editor, {
            key: "Enter",
            code: "Enter",
            shiftKey: true,
            isComposing,
            keyCode,
            ...modifiers,
          });
        });

        expect(editor.editor.getJSON()).toEqual(before);
        expect(changes).not.toHaveBeenCalled();
        expect(primary).not.toHaveBeenCalled();
        expect(alternate).not.toHaveBeenCalled();
        expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
          "tab-a",
        );
        expect(createTerminal).not.toHaveBeenCalled();

        await act(async () => {
          pressInEditor(editor, {
            key: "Enter",
            code: "Enter",
            shiftKey: true,
            ...modifiers,
          });
        });

        expect(alternate).toHaveBeenCalledOnce();
        expect(primary).not.toHaveBeenCalled();
        expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
          "tab-a",
        );
        expect(createTerminal).not.toHaveBeenCalled();
      },
    );

    it("keeps active view composition alone ahead of submission and captured panel navigation, then releases the alternate chord", async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const createTerminal = vi
        .spyOn(sdk.terminals, "create")
        .mockResolvedValue(makeTerminalSession());
      const primary = vi.fn();
      const alternate = vi.fn();
      const changes = vi.fn();
      const editor = renderComposer(<NavigablePanel />, {
        keybindings: PANEL_NAVIGATION_KEYBINDINGS,
        enterInsertsNewline: true,
        value: "候補",
        onSubmit: primary,
        onChange: changes,
        submission: { onModifierSubmit: alternate },
      });
      const before = editor.editor.getJSON();
      const selectionBefore = editor.editor.state.selection.toJSON();
      expect(document.activeElement).toBe(editor);
      expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
        "tab-a",
      );
      expect(screen.getByLabelText("Active terminal").textContent).toBe(
        "No terminal",
      );
      fireEvent.compositionStart(editor, { data: "候補" });
      expect(editor.editor.view.composing).toBe(true);

      await act(async () => {
        pressInEditor(editor, {
          key: "Enter",
          code: "Enter",
          shiftKey: true,
          isComposing: false,
          keyCode: 13,
          ...modifiers,
        });
      });

      expect(editor.editor.getJSON()).toEqual(before);
      expect(editor.editor.state.selection.toJSON()).toEqual(selectionBefore);
      expect(changes).not.toHaveBeenCalled();
      expect(primary).not.toHaveBeenCalled();
      expect(alternate).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(editor);
      expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
        "tab-a",
      );
      expect(createTerminal).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Active terminal").textContent).toBe(
        "No terminal",
      );

      const ended = new CompositionEvent("compositionend", {
        bubbles: true,
        data: "候補",
      });
      fireEvent(editor, ended);
      await waitFor(() => expect(editor.editor.view.composing).toBe(false));
      const later = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter",
        shiftKey: true,
        isComposing: false,
        keyCode: 13,
        ...modifiers,
      });
      Object.defineProperty(later, "timeStamp", {
        value: ended.timeStamp + 1000,
      });

      fireEvent(editor, later);
      await act(async () => {});

      expect(alternate).toHaveBeenCalledOnce();
      expect(primary).not.toHaveBeenCalled();
      expect(editor.editor.getJSON()).toEqual(before);
      expect(editor.editor.state.selection.toJSON()).toEqual(selectionBefore);
      expect(changes).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
        "tab-a",
      );
      expect(createTerminal).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Active terminal").textContent).toBe(
        "No terminal",
      );
    });
  },
);

it("keeps Safari postcomposition ahead of the rebound captured navigation chord", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("iPad");
  vi.spyOn(navigator, "vendor", "get").mockReturnValue("Apple Computer, Inc.");
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (iPad) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  );
  const createTerminal = vi
    .spyOn(sdk.terminals, "create")
    .mockResolvedValue(makeTerminalSession());
  const primary = vi.fn();
  const alternate = vi.fn();
  const changes = vi.fn();
  const element = renderComposer(<NavigablePanel />, {
    keybindings: PANEL_NAVIGATION_KEYBINDINGS,
    enterInsertsNewline: true,
    value: "候補",
    onSubmit: primary,
    onChange: changes,
    submission: { onModifierSubmit: alternate },
  });
  const before = element.editor.getJSON();
  fireEvent.compositionStart(element, { data: "候補" });
  const ended = new CompositionEvent("compositionend", {
    bubbles: true,
    data: "候補",
  });
  fireEvent(element, ended);
  await waitFor(() => expect(element.editor.view.composing).toBe(false));
  const immediate = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    metaKey: true,
    shiftKey: true,
  });
  Object.defineProperty(immediate, "timeStamp", { value: ended.timeStamp + 1 });

  fireEvent(element, immediate);
  await act(async () => {});

  expect(element.editor.getJSON()).toEqual(before);
  expect(changes).not.toHaveBeenCalled();
  expect(primary).not.toHaveBeenCalled();
  expect(alternate).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
    "tab-a",
  );
  expect(createTerminal).not.toHaveBeenCalled();
  const later = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    metaKey: true,
    shiftKey: true,
  });
  Object.defineProperty(later, "timeStamp", { value: ended.timeStamp + 1000 });

  fireEvent(element, later);
  await act(async () => {});

  expect(alternate).toHaveBeenCalledOnce();
  expect(primary).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Active navigation tab").textContent).toBe(
    "tab-a",
  );
  expect(createTerminal).not.toHaveBeenCalled();
});
