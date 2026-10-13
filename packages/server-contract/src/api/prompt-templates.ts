import { z } from "zod";

export interface PromptTemplateVariable {
  description: string;
  name: string;
  optional: boolean;
}

export interface PromptTemplateSummary {
  defaultChanged: boolean;
  editingNotes: string;
  id: string;
  intent: string;
  kind: string;
  modified: boolean;
  overrideBody: string | null;
  summary: string;
  title: string;
  updatedAt: number | null;
  variables: PromptTemplateVariable[];
}

export interface PromptTemplateDetail extends PromptTemplateSummary {
  body: string;
  defaultBody: string;
}

export interface OrphanedPromptTemplateOverride {
  basedOnDefaultHash: string;
  body: string;
  templateId: string;
  updatedAt: number;
}

export interface PromptTemplatesResponse {
  orphaned: OrphanedPromptTemplateOverride[];
  templates: PromptTemplateSummary[];
}

export interface PromptTemplateResponse {
  template: PromptTemplateDetail | null;
}

export interface SavePromptTemplateRequest {
  body: string;
}

export interface SavePromptTemplateResponse {
  template: PromptTemplateDetail;
  warnings: string[];
}

export const savePromptTemplateRequestSchema = z
  .object({
    body: z.string(),
  })
  .strict();
