import { renderTemplateBody, templateBody } from "@bb/templates";
import { truncateToWidthAtWordBoundary } from "@bb/text-utils";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { resolvePromptTemplateBody } from "../system/prompt-templates.js";
import { runTextAiTask } from "./ai-tasks.js";

const MAX_COMMIT_SUBJECT_WIDTH = 72;

export interface GenerateCommitMessageArgs {
  diffDescription: string;
  shortstat: string;
  files: string;
  patch: string;
}

export function buildCommitMessagePrompt(
  args: GenerateCommitMessageArgs,
  body?: string,
): string {
  return renderTemplateBody(
    "generateCommitMessage",
    body ?? templateBody("generateCommitMessage"),
    {
      diffDescription: args.diffDescription,
      shortstat: args.shortstat,
      files: args.files,
      patch: args.patch,
    },
  );
}

export function sanitizeGeneratedCommitMessage(value: string): string | null {
  const message = truncateToWidthAtWordBoundary(
    value.replace(/\s+/gu, " ").trim(),
    MAX_COMMIT_SUBJECT_WIDTH,
  ).trim();
  return message.length > 0 ? message : null;
}

export async function generateCommitMessage(
  deps: LoggedWorkSessionDeps,
  args: GenerateCommitMessageArgs,
): Promise<string | null> {
  const outcome = await runTextAiTask(deps, {
    task: "commit-message",
    label: "Commit message generation",
    prompt: buildCommitMessagePrompt(
      args,
      resolvePromptTemplateBody(deps, "generateCommitMessage"),
    ),
  });
  return outcome.ok ? sanitizeGeneratedCommitMessage(outcome.value) : null;
}
