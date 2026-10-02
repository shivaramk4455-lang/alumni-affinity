import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

/**
 * Photograph view requests.
 *
 * The consent flow behind the `accepted_only` photo setting: a member asks to
 * see a photograph, the owner allows or declines, and only then does the
 * storage policy start serving the object. Nothing is blurred client-side —
 * the file is simply not sent until the owner says yes, which is the only
 * version of "blurred until approved" that is actually true.
 *
 * `hidden` is not requestable. That setting means nobody, including matches,
 * and a request must never quietly weaken it.
 */

export type PhotoRequestStatus = "pending" | "accepted" | "declined" | "revoked";

export type PhotoRequestRow = {
  id: string;
  requester_id: string;
  owner_id: string;
  status: PhotoRequestStatus;
  created_at: string;
  decided_at: string | null;
};

/** The caller's outgoing request to one profile, if any. */
export function useMyPhotoRequest(ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ["photo-request", "outgoing", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<PhotoRequestRow | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("session unavailable");
      const { data, error } = await supabase
        .from("photo_view_requests")
        .select("id, requester_id, owner_id, status, created_at, decided_at")
        .eq("owner_id", ownerId!)
        .eq("requester_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as PhotoRequestRow | null) ?? null;
    },
  });
}

/** Requests waiting on the caller's decision, newest first. */
export function useIncomingPhotoRequests() {
  return useQuery({
    queryKey: ["photo-request", "incoming"],
    queryFn: async (): Promise<PhotoRequestRow[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("session unavailable");
      const { data, error } = await supabase
        .from("photo_view_requests")
        .select("id, requester_id, owner_id, status, created_at, decided_at")
        .eq("owner_id", u.user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PhotoRequestRow[];
    },
  });
}

export function useRequestPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ownerId: string) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sign in again to request a photograph.");
      const { error } = await supabase
        .from("photo_view_requests")
        .insert({ owner_id: ownerId, requester_id: u.user.id, status: "pending" });
      // 23505 = the unique index already holds a live request for this pair.
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: (_r, ownerId) => {
      qc.invalidateQueries({ queryKey: ["photo-request"] });
      toast.success("Request sent. You will see the photograph if they allow it.");
      void ownerId;
    },
    onError: () => toast.error("Could not send the request. Please try again."),
  });
}

export function useDecidePhotoRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "accepted" | "declined" }) => {
      const { error } = await supabase
        .from("photo_view_requests")
        .update({ status, decided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["photo-request"] });
      // The requester's own view caches a signed URL per path; drop it so an
      // allowed photograph appears rather than a stale withheld panel.
      qc.invalidateQueries({ queryKey: ["photo"] });
      qc.invalidateQueries({ queryKey: ["gallery"] });
      qc.invalidateQueries({ queryKey: ["member"] });
      toast.success(
        vars.status === "accepted"
          ? "Photograph shared with that member."
          : "Request declined. They are not told why.",
      );
    },
    onError: () => toast.error("Could not save that decision. Please try again."),
  });
}
