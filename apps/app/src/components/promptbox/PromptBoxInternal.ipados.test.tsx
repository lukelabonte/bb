// @vitest-environment jsdom

import { vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(navigator, "vendor", {
    configurable: true,
    value: "Apple Computer, Inc.",
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) " +
      "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  });
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 5,
  });
});

import type { PromptTextMention } from "@bb/domain";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render as renderWithoutProviders,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
} from "./PromptBoxInternal";
import {
  createComposerQueryHarness,
  renderWithQueryClient,
} from "@/test/fixtures/plugins";

function render(ui: ReactNode, enterInsertsNewline = false) {
  const { queryClient, setGeneralSettings } = createComposerQueryHarness();
  setGeneralSettings({ enterInsertsNewline });
  return renderWithoutProviders(renderWithQueryClient(ui, queryClient));
}

function mountComposer(
  enterInsertsNewline: boolean,
  props: Partial<ComponentProps<typeof PromptBoxInternal>> = {},
) {
  const changes = vi.fn();
  const primary = vi.fn();
  function Composer() {
    const [value, setValue] = useState(props.value ?? "First line");
    const [mentions, setMentions] = useState<PromptTextMention[]>([]);
    return (
      <PromptBoxInternal
        onSubmit={primary}
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
        mentionRanges={mentions}
        onChange={(nextValue, nextMentions) => {
          changes(nextValue, nextMentions);
          setValue(nextValue);
          setMentions(nextMentions);
          props.onChange?.(nextValue, nextMentions);
        }}
      />
    );
  }
  render(<Composer />, enterInsertsNewline);
  const element =
    document.querySelector<TiptapEditorHTMLElement>(".ProseMirror");
  const editor = element?.editor;
  if (!element || !editor) throw new Error("Prompt editor was not rendered");
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    element.focus();
  });
  return { element, editor, changes, primary };
}

const IOS_ENTER_REPLAY_MS = 200;

function getPromptEditorElement(): HTMLElement {
  const editorElement = document.querySelector(".ProseMirror");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("Prompt editor element was not rendered");
  }
  return editorElement;
}

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe("PromptBoxInternal with iPadOS WebKit DOM hardware handling", () => {
  it("applies typeahead before submitting a Magic Keyboard Enter", async () => {
    const changes = vi.fn();
    const onSubmit = vi.fn();

    function Harness() {
      const [value, setValue] = useState("/");
      const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>(
        [],
      );
      return (
        <PromptBoxInternal
          value={value}
          mentionRanges={mentionRanges}
          onChange={(nextValue, nextMentions) => {
            changes(nextValue, nextMentions);
            setValue(nextValue);
            setMentionRanges(nextMentions);
          }}
          onSubmit={onSubmit}
          mentionMenuPlacement="bottom"
          typeahead={{
            mention: {
              results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
              isLoading: false,
              isError: false,
              onQueryChange: vi.fn(),
            },
            command: {
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
              isLoading: false,
              isError: false,
              hasMore: false,
              isLoadingMore: false,
              loadMore: vi.fn(),
              onQueryChange: vi.fn(),
            },
          }}
        />
      );
    }

    render(<Harness />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "review" })).toBeTruthy();

    fireEvent.keyDown(getPromptEditorElement(), {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
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
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a Magic Keyboard Enter once, with no replayed second submit", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <PromptBoxInternal
        value="Run this"
        mentionRanges={[]}
        onChange={onChange}
        onSubmit={onSubmit}
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
      />,
    );

    fireEvent.keyDown(getPromptEditorElement(), {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });

    expect(onSubmit).toHaveBeenCalledOnce();

    act(() => {
      vi.advanceTimersByTime(IOS_ENTER_REPLAY_MS * 2);
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "turns software-keyboard Return into a newline with enterInsertsNewline=%s",
    (enabled) => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();
      render(
        <PromptBoxInternal
          value="First line"
          mentionRanges={[]}
          onChange={onChange}
          onSubmit={onSubmit}
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
        />,
        enabled,
      );

      fireEvent.keyDown(getPromptEditorElement(), {
        key: "Enter",
        code: "",
        keyCode: 13,
      });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(IOS_ENTER_REPLAY_MS + 50);
      });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenLastCalledWith("First line\n", []);
    },
  );
});

describe.each([false, true])(
  "iPadOS hardware keyboard with enterInsertsNewline=%s",
  (enabled) => {
    it.each([false, true])(
      "uses native newline structure for Shift=%s when the chord is not a submit",
      (shiftKey) => {
        const { element, editor, changes, primary } = mountComposer(enabled);

        fireEvent.keyDown(element, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          shiftKey,
        });
        act(() => vi.advanceTimersByTime(IOS_ENTER_REPLAY_MS * 2));

        if (!enabled && !shiftKey) {
          expect(primary).toHaveBeenCalledOnce();
          expect(changes).not.toHaveBeenCalled();
          expect(editor.state.doc.childCount).toBe(1);
        } else {
          expect(primary).not.toHaveBeenCalled();
          expect(changes).toHaveBeenLastCalledWith("First line\n", []);
          expect(editor.state.doc.childCount).toBe(2);
          expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
          expect(editor.state.selection.empty).toBe(true);
          expect(editor.state.selection.$from.parent.textContent).toBe("");
          act(() => editor.commands.undo());
          expect(editor.getText()).toBe("First line");
          expect(primary).not.toHaveBeenCalled();
        }
      },
    );

    it.each([
      { shiftKey: false, swapSubmitActions: false },
      { shiftKey: true, swapSubmitActions: false },
      { shiftKey: false, swapSubmitActions: true },
      { shiftKey: true, swapSubmitActions: true },
    ])(
      "resolves Command Enter with Shift=$shiftKey and swapped actions=$swapSubmitActions before the iOS replay",
      ({ shiftKey, swapSubmitActions }) => {
        const alternate = vi.fn();
        const { element, editor, changes, primary } = mountComposer(enabled, {
          submission: { onModifierSubmit: alternate, swapSubmitActions },
        });
        const before = editor.getJSON();

        fireEvent.keyDown(element, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          metaKey: true,
          shiftKey,
        });
        act(() => vi.advanceTimersByTime(IOS_ENTER_REPLAY_MS * 2));

        const submits = enabled || !shiftKey;
        const usesResolvedAlternate = enabled ? shiftKey : true;
        const submitsDraft = usesResolvedAlternate
          ? swapSubmitActions
          : !swapSubmitActions;
        expect(primary).toHaveBeenCalledTimes(submits && submitsDraft ? 1 : 0);
        expect(alternate).toHaveBeenCalledTimes(
          submits && !submitsDraft ? 1 : 0,
        );
        expect(editor.getJSON()).toEqual(before);
        expect(changes).not.toHaveBeenCalled();
      },
    );

    it("never falls back to primary for Command Shift Enter without an alternate", () => {
      const { element, editor, changes, primary } = mountComposer(enabled);
      const before = editor.getJSON();
      const selectionBefore = editor.state.selection.toJSON();
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        metaKey: true,
        shiftKey: true,
      });

      fireEvent(element, event);
      act(() => vi.advanceTimersByTime(IOS_ENTER_REPLAY_MS * 2));

      expect(primary).not.toHaveBeenCalled();
      expect(changes).not.toHaveBeenCalled();
      expect(editor.getJSON()).toEqual(before);
      expect(editor.state.selection.toJSON()).toEqual(selectionBefore);
    });

    it.each([
      { guard: "isComposing", isComposing: true, keyCode: 13 },
      { guard: "keyCode 229", isComposing: false, keyCode: 229 },
    ])("does not submit or edit during $guard", ({ isComposing, keyCode }) => {
      const alternate = vi.fn();
      const { element, editor, changes, primary } = mountComposer(enabled, {
        value: "候補",
        submission: { onModifierSubmit: alternate },
      });
      const before = editor.getJSON();
      fireEvent.compositionStart(element, { data: "候補" });

      for (const modifiers of [
        {},
        { shiftKey: true },
        { metaKey: true },
        { metaKey: true, shiftKey: true },
      ]) {
        fireEvent.keyDown(element, {
          key: "Enter",
          code: "Enter",
          isComposing,
          keyCode,
          ...modifiers,
        });
      }

      expect(editor.getJSON()).toEqual(before);
      expect(changes).not.toHaveBeenCalled();
      expect(primary).not.toHaveBeenCalled();
      expect(alternate).not.toHaveBeenCalled();
      fireEvent.compositionEnd(element, { data: "候補" });
    });

    it.each([false, true])(
      "ignores Safari postcomposition Command Enter with Shift=%s, then accepts a later chord",
      async (shiftKey) => {
        const alternate = vi.fn();
        const { element, editor, changes, primary } = mountComposer(enabled, {
          value: "候補",
          submission: { onModifierSubmit: alternate },
        });
        const before = editor.getJSON();
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
          shiftKey,
        });
        Object.defineProperty(immediate, "timeStamp", {
          value: ended.timeStamp + 1,
        });

        fireEvent(element, immediate);

        expect(editor.getJSON()).toEqual(before);
        expect(changes).not.toHaveBeenCalled();
        expect(primary).not.toHaveBeenCalled();
        expect(alternate).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(50));
        expect(editor.view.composing).toBe(false);
        const later = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          metaKey: true,
          shiftKey,
        });
        Object.defineProperty(later, "timeStamp", {
          value: ended.timeStamp + 1000,
        });

        fireEvent(element, later);
        act(() => vi.advanceTimersByTime(IOS_ENTER_REPLAY_MS * 2));

        expect(primary).toHaveBeenCalledTimes(enabled && !shiftKey ? 1 : 0);
        expect(alternate).toHaveBeenCalledTimes(
          enabled ? (shiftKey ? 1 : 0) : shiftKey ? 0 : 1,
        );
        expect(changes).not.toHaveBeenCalled();
      },
    );

    it.each([false, true])(
      "keeps the send button primary with swapped actions=%s",
      (swapSubmitActions) => {
        const alternate = vi.fn();
        const { primary } = mountComposer(enabled, {
          submission: { onModifierSubmit: alternate, swapSubmitActions },
        });
        const submit = screen.getByRole("button", { name: /^Submit \(/u });
        vi.spyOn(submit, "getBoundingClientRect").mockReturnValue(
          new DOMRect(0, 0, 40, 40),
        );
        const touch = {
          button: 0,
          pointerType: "touch",
          pointerId: 1,
          isPrimary: true,
          clientX: 20,
          clientY: 20,
        };

        fireEvent.pointerDown(submit, touch);
        fireEvent.pointerUp(submit, touch);
        fireEvent.click(submit, { detail: 1 });

        expect(primary).toHaveBeenCalledTimes(swapSubmitActions ? 0 : 1);
        expect(alternate).toHaveBeenCalledTimes(swapSubmitActions ? 1 : 0);
      },
    );
  },
);
