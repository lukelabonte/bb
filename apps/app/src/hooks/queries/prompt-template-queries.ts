import { queryOptions, useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { promptTemplateQueryKey, promptTemplatesQueryKey } from "./query-keys";

export function promptTemplatesQueryOptions() {
  return queryOptions({
    queryKey: promptTemplatesQueryKey(),
    queryFn: ({ signal }) => sdk.system.experimental_prompts.list({ signal }),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function usePromptTemplates() {
  return useQuery(promptTemplatesQueryOptions());
}

export function promptTemplateQueryOptions(templateId: string) {
  return queryOptions({
    queryKey: promptTemplateQueryKey(templateId),
    queryFn: ({ signal }) =>
      sdk.system.experimental_prompts.get({ id: templateId, signal }),
    enabled: templateId.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function usePromptTemplate(templateId: string) {
  return useQuery(promptTemplateQueryOptions(templateId));
}
