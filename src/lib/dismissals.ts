import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

/**
 * "Not for me" — a private, reversible dismissal of a profile from your own
 * search.
 *
 * Deliberately separate from report (a desk alert, for genuine misconduct) and
 * block (terminal, ends an introduction and hides both sides). A dismissal
 * touches nobody else: the other member is never notified and cannot detect it
 * in either direction, so nothing here can become a social signal.
 */

export type DismissalRow = {
  id: string;
  dismissed_id: string;
  created_at: string;
};

/** Ids the caller has dismissed — search filters with these. */
export function useDismissedIds(enabled = true) {
  return useQuery({
    queryKey: ["dismissals", "ids"],
    enabled,
    queryFn: async (): Promise<string[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("session unavailable");
      const { data, error } = await supabase
        .from("profile_dismissals")
        .select("dismissed_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => r.dismissed_id);
    },
  });
}

export function useDismissProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dismissedId: string) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sign in again to hide a profile.");
      const { error } = await supabase
        .from("profile_dismissals")
        .insert({ dismissed_id: dismissedId, dismisser_id: u.user.id });
      // 23505 = already dismissed; an insert that lands is not a failure.
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dismissals"] });
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Hidden from your search. Reversible from Settings — they are never told.");
    },
    onError: () => toast.error("Could not hide that profile. Please try again."),
  });
}

/** Undone from Settings: the member reappears in the next search. */
export function useRestoreProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dismissedId: string) => {
      const { error } = await supabase
        .from("profile_dismissals")
        .delete()
        .eq("dismissed_id", dismissedId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dismissals"] });
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Visible in your search again.");
    },
    onError: () => toast.error("Could not restore that profile. Please try again."),
  });
}
