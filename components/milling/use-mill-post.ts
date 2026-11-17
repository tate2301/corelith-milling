"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useToast } from "@/components/ui/use-toast";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

/**
 * POST to a mill endpoint; on success refresh everything under ["milling"]
 * and say so; on refusal keep the server's sentence for the form to show.
 */
export function useMillPost<T = unknown>(options: { done?: string; onDone?: (result: T) => void } = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => fetchJson<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) }),
    onMutate: () => setError(null),
    onSuccess: (result) => {
      if (options.done) toast({ title: options.done, variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["milling"] });
      options.onDone?.(result);
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });
  return {
    post: (url: string, body?: unknown) => mutation.mutate({ url, body }),
    postAsync: (url: string, body?: unknown) => mutation.mutateAsync({ url, body }),
    pending: mutation.isPending,
    error,
    clearError: () => setError(null),
  };
}
