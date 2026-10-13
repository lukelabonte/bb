import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import {
  allPromptTemplatesQueryKeyPrefix,
  promptTemplatesQueryKey,
} from "../queries/query-keys";

function invalidatePromptTemplateQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  void queryClient.invalidateQueries({ queryKey: promptTemplatesQueryKey() });
  void queryClient.invalidateQueries({
    queryKey: allPromptTemplatesQueryKeyPrefix(),
  });
}

export function useSavePromptTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to save the prompt template.",
    },
    mutationFn: (args: { body: string; id: string }) =>
      sdk.system.experimental_prompts.set(args),
    onSuccess: () => {
      invalidatePromptTemplateQueries(queryClient);
    },
  });
}

export function useResetPromptTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reset the prompt template.",
    },
    mutationFn: (args: { id: string }) =>
      sdk.system.experimental_prompts.reset(args),
    onSuccess: () => {
      invalidatePromptTemplateQueries(queryClient);
    },
  });
}
