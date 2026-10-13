import { useMemo, useState } from "react";
import { validateTemplateBody } from "@bb/templates/validation";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PromptTemplateSummary } from "@bb/server-contract";
import {
  SettingsBadge,
  SettingsSection,
} from "@/components/ui/settings-section";
import {
  useResetPromptTemplate,
  useSavePromptTemplate,
} from "@/hooks/mutations/prompt-template-mutations";
import {
  usePromptTemplate,
  usePromptTemplates,
} from "@/hooks/queries/prompt-template-queries";

const KIND_LABELS: Record<string, string> = {
  instruction: "Instructions",
  prompt: "Prompts",
  "system-message": "System messages",
};

const KIND_ORDER = ["prompt", "instruction", "system-message"];

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function kindRank(kind: string): number {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

function formatUpdatedAt(updatedAt: number): string {
  return new Date(updatedAt).toLocaleString();
}

interface PromptTemplateRowProps {
  active: boolean;
  onSelect(templateId: string): void;
  template: PromptTemplateSummary;
}

function PromptTemplateRow({
  active,
  onSelect,
  template,
}: PromptTemplateRowProps) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "w-full rounded border px-3 py-2 text-left",
        active ? "border-ring bg-muted/30" : "border-border hover:bg-muted/20",
      )}
      onClick={() => onSelect(template.id)}
      type="button"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-foreground">{template.title}</span>
        {template.modified ? <SettingsBadge>Modified</SettingsBadge> : null}
        {template.defaultChanged ? (
          <SettingsBadge>Default changed</SettingsBadge>
        ) : null}
      </span>
      <span className="mt-0.5 block font-mono text-2xs text-subtle-foreground">
        {template.id}
      </span>
      <span className="mt-1 block text-xs leading-snug text-subtle-foreground/75">
        {template.editingNotes}
      </span>
      {template.variables.length > 0 ? (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {template.variables.map((variable) => (
            <span
              className="rounded-sm bg-muted/40 px-1 py-0.5 font-mono text-2xs text-subtle-foreground"
              key={variable.name}
            >
              {`{{${variable.name}}}`}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

interface KindFilterButtonProps {
  active: boolean;
  count: number;
  label: string;
  onClick(): void;
}

function KindFilterButton({
  active,
  count,
  label,
  onClick,
}: KindFilterButtonProps) {
  return (
    <Button
      aria-pressed={active}
      className="h-7 px-2 text-xs"
      onClick={onClick}
      size="sm"
      type="button"
      variant={active ? "default" : "outline"}
    >
      {label}
      <span className="ml-1 text-2xs opacity-70">{count}</span>
    </Button>
  );
}

export function MagicPromptsSettingsSection() {
  const templatesQuery = usePromptTemplates();
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDefault, setShowDefault] = useState(false);
  const [draft, setDraft] = useState<{
    sourceKey: string;
    body: string;
  } | null>(null);
  const saveMutation = useSavePromptTemplate();
  const resetMutation = useResetPromptTemplate();

  const templates = templatesQuery.data?.templates;
  const orphaned = templatesQuery.data?.orphaned ?? [];

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const template of templates ?? []) {
      counts.set(template.kind, (counts.get(template.kind) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      ([left], [right]) => kindRank(left) - kindRank(right),
    );
  }, [templates]);

  const visibleTemplates = useMemo(
    () =>
      templates === undefined
        ? []
        : kindFilter === null
          ? templates
          : templates.filter((template) => template.kind === kindFilter),
    [kindFilter, templates],
  );

  const groups = useMemo(() => {
    const grouped = new Map<string, PromptTemplateSummary[]>();
    for (const template of visibleTemplates) {
      const group = grouped.get(template.kind);
      if (group === undefined) {
        grouped.set(template.kind, [template]);
      } else {
        group.push(template);
      }
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => kindRank(left) - kindRank(right))
      .map(([kind, entries]) => ({ kind, templates: entries }));
  }, [visibleTemplates]);

  const activeId = visibleTemplates.some(
    (template) => template.id === selectedId,
  )
    ? selectedId
    : (visibleTemplates[0]?.id ?? null);
  const detailQuery = usePromptTemplate(activeId ?? "");
  const detail = detailQuery.data?.template ?? null;
  const sourceKey =
    detail === null ? "" : `${detail.id}:${detail.updatedAt ?? "default"}`;
  const editorBody =
    draft !== null && draft.sourceKey === sourceKey
      ? draft.body
      : (detail?.body ?? "");
  const validation = useMemo(
    () =>
      detail === null
        ? null
        : validateTemplateBody({
            body: editorBody,
            declaredVariables: detail.variables,
            templateId: detail.id,
          }),
    [detail, editorBody],
  );
  const dirty = detail !== null && editorBody !== detail.body;
  const saveDisabled =
    detail === null ||
    validation === null ||
    validation.errors.length > 0 ||
    !dirty ||
    saveMutation.isPending;

  function selectTemplate(templateId: string): void {
    setSelectedId(templateId);
    setShowDefault(false);
    saveMutation.reset();
    resetMutation.reset();
  }

  function updateBody(body: string): void {
    setDraft({ sourceKey, body });
  }

  function saveTemplate(): void {
    if (detail === null) return;
    saveMutation.mutate(
      { body: editorBody, id: detail.id },
      { onSuccess: () => setDraft(null) },
    );
  }

  function resetTemplate(templateId: string): void {
    resetMutation.mutate(
      { id: templateId },
      { onSuccess: () => setDraft(null) },
    );
  }

  return (
    <SettingsSection
      description="Every prompt template bb ships. Edits apply to new triggers on every connected client."
      title="Magic Prompts"
    >
      <div className="space-y-4">
        <div
          aria-label="Filter prompt templates by kind"
          className="flex flex-wrap items-center gap-2"
          role="group"
        >
          <KindFilterButton
            active={kindFilter === null}
            count={templates?.length ?? 0}
            label="All"
            onClick={() => setKindFilter(null)}
          />
          {kindCounts.map(([kind, count]) => (
            <KindFilterButton
              active={kindFilter === kind}
              count={count}
              key={kind}
              label={kindLabel(kind)}
              onClick={() => setKindFilter(kind)}
            />
          ))}
        </div>
        {templatesQuery.isError ? (
          <p className="text-xs text-destructive" role="alert">
            {templatesQuery.error.message}
          </p>
        ) : null}
        <div className="grid gap-5 @min-[64rem]/settings:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.kind}>
                <h3 className="mb-2 text-xs font-medium text-subtle-foreground">
                  {kindLabel(group.kind)}
                </h3>
                <div className="space-y-2">
                  {group.templates.map((template) => (
                    <PromptTemplateRow
                      active={template.id === activeId}
                      key={template.id}
                      onSelect={selectTemplate}
                      template={template}
                    />
                  ))}
                </div>
              </section>
            ))}
            {templatesQuery.isSuccess && groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-subtle-foreground">
                No prompt templates match this filter.
              </p>
            ) : null}
          </div>
          <div className="min-w-0 space-y-3 rounded border border-border p-4">
            {detail === null ? (
              <p className="text-sm text-subtle-foreground">
                Select a prompt template to view and edit its body.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm text-foreground">{detail.title}</h3>
                  {detail.modified ? (
                    <SettingsBadge>Modified</SettingsBadge>
                  ) : null}
                  {detail.defaultChanged ? (
                    <SettingsBadge>Default changed</SettingsBadge>
                  ) : null}
                </div>
                <p className="font-mono text-2xs text-subtle-foreground">
                  {detail.id} · {kindLabel(detail.kind)}
                </p>
                <p className="text-xs leading-snug text-subtle-foreground/75">
                  {detail.summary}
                </p>
                <p className="text-xs leading-snug text-subtle-foreground/75">
                  {detail.editingNotes}
                </p>
                {detail.variables.length > 0 ? (
                  <div
                    aria-label="Template variables"
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    {detail.variables.map((variable) => (
                      <span
                        className="rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-2xs text-subtle-foreground"
                        key={variable.name}
                      >
                        {`{{${variable.name}}}${variable.optional ? " (optional)" : ""}`}
                      </span>
                    ))}
                  </div>
                ) : null}
                {detail.updatedAt !== null ? (
                  <p className="text-2xs text-subtle-foreground/75">
                    Saved {formatUpdatedAt(detail.updatedAt)}
                  </p>
                ) : null}
                {detail.defaultChanged ? (
                  <p className="text-xs text-warning-text" role="status">
                    The shipped default changed since this edit was saved.
                    Saving again adopts the new default as the base; reset
                    restores it.
                  </p>
                ) : null}
                <label className="block space-y-1">
                  <span className="text-xs text-subtle-foreground">
                    Template body
                  </span>
                  <textarea
                    aria-label={`Template body for ${detail.title}`}
                    className="min-h-72 w-full resize-y rounded border border-border bg-transparent p-2 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:border-ring"
                    onChange={(event) => updateBody(event.target.value)}
                    spellCheck={false}
                    value={editorBody}
                  />
                </label>
                {validation !== null && validation.errors.length > 0 ? (
                  <div className="space-y-1" role="alert">
                    {validation.errors.map((error) => (
                      <p className="text-xs text-destructive" key={error}>
                        {error}
                      </p>
                    ))}
                  </div>
                ) : null}
                {validation !== null && validation.warnings.length > 0 ? (
                  <div className="space-y-1">
                    {validation.warnings.map((warning) => (
                      <p className="text-xs text-warning-text" key={warning}>
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}
                {saveMutation.isError ? (
                  <p className="text-xs text-destructive" role="alert">
                    {saveMutation.error.message}
                  </p>
                ) : null}
                {resetMutation.isError ? (
                  <p className="text-xs text-destructive" role="alert">
                    {resetMutation.error.message}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={saveDisabled}
                    onClick={saveTemplate}
                    size="sm"
                    type="button"
                  >
                    Save
                  </Button>
                  <Button
                    disabled={!detail.modified || resetMutation.isPending}
                    onClick={() => resetTemplate(detail.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Reset to default
                  </Button>
                  <Button
                    onClick={() => setShowDefault((current) => !current)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {showDefault
                      ? "Hide shipped default"
                      : "View shipped default"}
                  </Button>
                </div>
                {showDefault ? (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/20 p-2 font-mono text-xs text-subtle-foreground">
                    {detail.defaultBody}
                  </pre>
                ) : null}
              </>
            )}
          </div>
        </div>
        {orphaned.length > 0 ? (
          <section className="space-y-2 rounded border border-border p-4">
            <h3 className="text-sm text-foreground">Orphaned overrides</h3>
            <p className="text-xs leading-snug text-subtle-foreground/75">
              Saved overrides for templates this bb version no longer ships.
              They are ignored when rendering; clear one to remove it.
            </p>
            <div className="divide-y divide-border">
              {orphaned.map((entry) => (
                <div
                  className="flex items-center justify-between gap-3 py-2"
                  key={entry.templateId}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-foreground">
                      {entry.templateId}
                    </p>
                    <p className="text-2xs text-subtle-foreground/75">
                      Saved {formatUpdatedAt(entry.updatedAt)}
                    </p>
                  </div>
                  <Button
                    disabled={resetMutation.isPending}
                    onClick={() => resetTemplate(entry.templateId)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Clear
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </SettingsSection>
  );
}
