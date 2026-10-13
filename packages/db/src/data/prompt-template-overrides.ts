import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { promptTemplateOverrides } from "../schema.js";

export interface StoredPromptTemplateOverride {
  basedOnDefaultHash: string;
  body: string;
  templateId: string;
  updatedAt: number;
}

export function listStoredPromptTemplateOverrides(
  db: DbConnection,
): StoredPromptTemplateOverride[] {
  return db
    .select({
      basedOnDefaultHash: promptTemplateOverrides.basedOnDefaultHash,
      body: promptTemplateOverrides.body,
      templateId: promptTemplateOverrides.templateId,
      updatedAt: promptTemplateOverrides.updatedAt,
    })
    .from(promptTemplateOverrides)
    .all();
}

export function getStoredPromptTemplateOverride(
  db: DbConnection,
  templateId: string,
): StoredPromptTemplateOverride | undefined {
  return db
    .select({
      basedOnDefaultHash: promptTemplateOverrides.basedOnDefaultHash,
      body: promptTemplateOverrides.body,
      templateId: promptTemplateOverrides.templateId,
      updatedAt: promptTemplateOverrides.updatedAt,
    })
    .from(promptTemplateOverrides)
    .where(eq(promptTemplateOverrides.templateId, templateId))
    .get();
}

export function upsertStoredPromptTemplateOverride(
  db: DbConnection,
  override: StoredPromptTemplateOverride,
): void {
  db.insert(promptTemplateOverrides)
    .values(override)
    .onConflictDoUpdate({
      target: promptTemplateOverrides.templateId,
      set: {
        basedOnDefaultHash: override.basedOnDefaultHash,
        body: override.body,
        updatedAt: override.updatedAt,
      },
    })
    .run();
}

export function deleteStoredPromptTemplateOverride(
  db: DbConnection,
  templateId: string,
): boolean {
  const deleted = db
    .delete(promptTemplateOverrides)
    .where(eq(promptTemplateOverrides.templateId, templateId))
    .returning({ templateId: promptTemplateOverrides.templateId })
    .all();
  return deleted.length > 0;
}
