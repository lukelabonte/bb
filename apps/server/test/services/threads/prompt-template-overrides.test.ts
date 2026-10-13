import { describe, expect, it } from "vitest";
import type { PromptInput } from "@bb/domain";
import {
  renderTemplate,
  renderTemplateBody,
  templateBody,
} from "@bb/templates";
import {
  buildChildThreadNeedsAttentionInput,
  buildChildThreadTurnStatusBatchInput,
  type ChildThreadNotificationSource,
  type ChildThreadTurnNotificationBatchItem,
} from "../../../src/services/threads/child-thread-notifications.js";
import { buildParentSystemInputFromTemplateSlot } from "../../../src/services/threads/parent-system-messages.js";
import { buildThreadOwnershipSystemInput } from "../../../src/services/threads/thread-ownership.js";
import { formatAgentThreadInput } from "../../../src/services/threads/thread-send.js";
import { buildThreadTitlePrompt } from "../../../src/services/threads/title-generation.js";
import { buildCommitMessagePrompt } from "../../../src/services/ai/commit-message.js";

function textInput(text: string): PromptInput {
  return { type: "text", text, mentions: [] };
}

function firstText(input: PromptInput[]): string {
  const [first] = input;
  if (!first || first.type !== "text") {
    throw new Error("Expected one text input");
  }
  return first.text;
}

function firstTextMentions(
  input: PromptInput[],
): { start: number; end: number }[] {
  const [first] = input;
  if (!first || first.type !== "text") {
    throw new Error("Expected one text input");
  }
  return first.mentions;
}

const TITLE_INPUT = [textInput("Fix the flaky login bug")];

const COMMIT_ARGS = {
  diffDescription: "the working tree",
  shortstat: " 2 files changed, 10 insertions(+)",
  files: "M\tsrc/example.ts",
  patch: "diff --git a/src/example.ts b/src/example.ts",
};

const AGENT_INPUT = [textInput("Please check the failing test.")];

const THREAD: ChildThreadNotificationSource = {
  id: "thr_child",
  projectId: "proj_alpha",
  title: "Fix checkout flow",
};

const BATCH_ITEMS: ChildThreadTurnNotificationBatchItem[] = [
  {
    activeWorkflowCount: 0,
    childThread: THREAD,
    terminalOutput: "Implemented the requested change.",
    turnStatus: "completed",
  },
];

describe("prompt template override rendering", () => {
  it("renders the shipped default when no override body is passed", () => {
    expect(buildThreadTitlePrompt(TITLE_INPUT)).toBe(
      buildThreadTitlePrompt(
        TITLE_INPUT,
        templateBody("generateThreadMetadata"),
      ),
    );
    expect(buildCommitMessagePrompt(COMMIT_ARGS)).toBe(
      buildCommitMessagePrompt(
        COMMIT_ARGS,
        templateBody("generateCommitMessage"),
      ),
    );
    expect(
      formatAgentThreadInput({
        input: AGENT_INPUT,
        senderThreadId: "thr_sender",
      }),
    ).toEqual(
      formatAgentThreadInput({
        body: templateBody("agentThreadMessage"),
        input: AGENT_INPUT,
        senderThreadId: "thr_sender",
      }),
    );
    expect(
      firstText(
        buildThreadOwnershipSystemInput(
          "systemMessageThreadOwnershipAssigned",
          THREAD,
        ),
      ),
    ).toBe(
      firstText(
        buildThreadOwnershipSystemInput(
          "systemMessageThreadOwnershipAssigned",
          THREAD,
          templateBody("systemMessageThreadOwnershipAssigned"),
        ),
      ),
    );
    expect(
      firstText(
        buildChildThreadNeedsAttentionInput({
          childThread: THREAD,
          blockerSummary: null,
        }),
      ),
    ).toBe(
      firstText(
        buildChildThreadNeedsAttentionInput({
          body: templateBody("systemMessageChildThreadNeedsAttention"),
          childThread: THREAD,
          blockerSummary: null,
        }),
      ),
    );
    expect(
      firstText(buildChildThreadTurnStatusBatchInput({ items: BATCH_ITEMS })),
    ).toBe(
      firstText(
        buildChildThreadTurnStatusBatchInput({
          body: templateBody("systemMessageChildThreadOutcomeBatch"),
          items: BATCH_ITEMS,
        }),
      ),
    );
  });

  it("uses an override body for the thread title prompt", () => {
    const body = "Override title: {{cleanedPrompt}}";
    expect(buildThreadTitlePrompt(TITLE_INPUT, body)).toBe(
      renderTemplateBody("generateThreadMetadata", body, {
        cleanedPrompt: "Fix the flaky login bug",
      }),
    );
  });

  it("uses an override body for the commit message prompt", () => {
    const body = "Commit: {{shortstat}}";
    expect(buildCommitMessagePrompt(COMMIT_ARGS, body)).toBe(
      renderTemplateBody("generateCommitMessage", body, COMMIT_ARGS),
    );
  });

  it("uses an override body for agent thread messages", () => {
    const rendered = firstText(
      formatAgentThreadInput({
        body: "From {{senderThreadId}}: {{messageText}}",
        input: AGENT_INPUT,
        senderThreadId: "thr_sender",
      }),
    );
    expect(rendered).toBe("From thr_sender: Please check the failing test.");
  });

  it("uses an override body for ownership notices", () => {
    const rendered = firstText(
      buildThreadOwnershipSystemInput(
        "systemMessageThreadOwnershipAssigned",
        THREAD,
        "[bb system]\n\nHeads up: {{threadMention}} joined.",
      ),
    );
    expect(rendered).toBe("[bb system]\n\nHeads up: @thread:thr_child joined.");
  });

  it("uses an override body for child thread notifications", () => {
    expect(
      firstText(
        buildChildThreadNeedsAttentionInput({
          body: "[bb system]\n\n{{threadMention}} blocked: {{blockerSummary}}",
          childThread: THREAD,
          blockerSummary: "Blocked on approval.",
        }),
      ),
    ).toBe("[bb system]\n\n@thread:thr_child blocked: Blocked on approval.");
    expect(
      firstText(
        buildChildThreadTurnStatusBatchInput({
          body: "[bb system]\n\nUpdate:\n{{updates}}",
          items: BATCH_ITEMS,
        }),
      ),
    ).toContain("@thread:thr_child completed:");
  });

  it("drops mention segments when an override omits the slot", () => {
    const input = buildThreadOwnershipSystemInput(
      "systemMessageThreadOwnershipAssigned",
      THREAD,
      "[bb system]\n\nA child arrived.",
    );
    expect(firstText(input)).toBe("[bb system]\n\nA child arrived.");
    expect(firstTextMentions(input)).toEqual([]);
  });

  it("repeats mention segments when an override references the slot twice", () => {
    const input = buildThreadOwnershipSystemInput(
      "systemMessageThreadOwnershipAssigned",
      THREAD,
      "{{threadMention}} and again {{threadMention}}",
    );
    expect(firstText(input)).toBe(
      "@thread:thr_child and again @thread:thr_child",
    );
    const mentions = firstTextMentions(input);
    expect(mentions).toHaveLength(2);
    expect(mentions[1]!.start).toBeGreaterThanOrEqual(mentions[0]!.end);
  });

  it("renders the default ownership notice through the shipped template", () => {
    expect(
      firstText(
        buildThreadOwnershipSystemInput(
          "systemMessageThreadOwnershipAssigned",
          THREAD,
        ),
      ),
    ).toBe(
      renderTemplate("systemMessageThreadOwnershipAssigned", {
        threadMention: "@thread:thr_child",
      }),
    );
  });
});

describe("parent system slot expansion", () => {
  const segments = [
    {
      kind: "mention" as const,
      mention: {
        resource: {
          kind: "thread" as const,
          label: "Fix checkout flow",
          threadId: THREAD.id,
        },
        serializedText: "@thread:thr_child",
      },
    },
  ];

  it("leaves the text unchanged when the slot is absent", () => {
    const input = buildParentSystemInputFromTemplateSlot({
      renderedText: "No slot here.",
      segments,
      slot: "__SLOT__",
    });
    expect(firstText(input)).toBe("No slot here.");
    expect(firstTextMentions(input)).toEqual([]);
  });

  it("splices segments at a single slot", () => {
    const input = buildParentSystemInputFromTemplateSlot({
      renderedText: "Before __SLOT__ after.",
      segments,
      slot: "__SLOT__",
    });
    expect(firstText(input)).toBe("Before @thread:thr_child after.");
    expect(firstTextMentions(input)).toEqual([
      {
        start: 7,
        end: 7 + "@thread:thr_child".length,
        resource: segments[0]!.mention.resource,
      },
    ]);
  });

  it("splices segments at every slot and drops the sentinel text", () => {
    const input = buildParentSystemInputFromTemplateSlot({
      renderedText: "__SLOT__/__SLOT__",
      segments,
      slot: "__SLOT__",
    });
    expect(firstText(input)).toBe("@thread:thr_child/@thread:thr_child");
    expect(firstTextMentions(input)).toHaveLength(2);
  });
});
