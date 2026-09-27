import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type ConversationRow = {
  id: string;
  interest_id: string;
  participant_a: string;
  participant_b: string;
  last_message_at: string | null;
  created_at: string;
};

/**
 * Post-acceptance messaging. Conversations exist only between the two
 * candidates of a mutually ACCEPTED interest; creation is atomic so two
 * simultaneous opens cannot duplicate. Deliberately no typing indicators
 * (metadata leakage), no edit/delete (clean desk audit trail) and no
 * attachments (photos stay inside the photo escrow).
 */
export function useConversation(interestId: string | undefined) {
  const qc = useQueryClient();

  const convo = useQuery({
    queryKey: ["conversation", interestId],
    enabled: !!interestId,
    queryFn: async (): Promise<ConversationRow | null> => {
      const { data, error } = await supabase.rpc("get_or_create_conversation", {
        _interest_id: interestId!,
      });
      if (error) throw error;
      if (!data) return null;
      return data as unknown as ConversationRow;
    },
    staleTime: 60_000,
  });

  const conversationId = convo.data?.id ?? null;

  const history = useQuery({
    queryKey: ["messages", conversationId],
    enabled: !!conversationId,
    queryFn: async (): Promise<MessageRow[]> => {
      // Newest-first + limit so a long thread loads its latest window, then
      // reverse for chronological rendering.
      const { data, error } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, body, read_at, created_at")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as MessageRow[]).slice().reverse();
    },
  });

  // Realtime appends; the channel is scoped per conversation id. History stays
  // the source of truth — realtime only invalidates/appends.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          qc.setQueryData<MessageRow[]>(["messages", conversationId], (old) => {
            const row = payload.new as unknown as MessageRow;
            if (!old) return [row];
            if (old.some((m) => m.id === row.id)) return old;
            return [...old, row];
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, qc]);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function send(body: string): Promise<boolean> {
    const text = body.trim().slice(0, 2000);
    if (!text || !conversationId || sending) return false;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return false;
    setSending(true);
    setSendError(null);
    // Optimistic row; reconciled by id on realtime echo.
    const temp: MessageRow = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: u.user.id,
      body: text,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    qc.setQueryData<MessageRow[]>(["messages", conversationId], (old) => [...(old ?? []), temp]);
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: u.user.id, body: text })
      .select("id, conversation_id, sender_id, body, read_at, created_at")
      .single();
    if (error) {
      qc.setQueryData<MessageRow[]>(["messages", conversationId], (old) =>
        (old ?? []).filter((m) => m.id !== temp.id),
      );
      setSendError("Could not send. Please try again.");
      setSending(false);
      return false;
    }
    const row = data as unknown as MessageRow;
    qc.setQueryData<MessageRow[]>(["messages", conversationId], (old) =>
      (old ?? []).map((m) => (m.id === temp.id ? row : m)),
    );
    setSending(false);

    // Bell alert for the counterpart. Server-composed via notify_counterparty
    // (relationship-checked); a failure here must not lose the message.
    const convoRow = convo.data;
    if (convoRow) {
      const other =
        convoRow.participant_a === u.user.id ? convoRow.participant_b : convoRow.participant_a;
      const { error: notifyError } = await supabase.rpc("notify_counterparty", {
        _user: other,
        _event: "message_received",
      });
      if (notifyError) console.error("counterparty notification", notifyError);
    }
    return true;
  }

  // Stable per conversation so callers can safely depend on it in effects.
  const markRead = useCallback(async (): Promise<void> => {
    if (!conversationId) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .neq("sender_id", u.user.id)
      .is("read_at", null);
  }, [conversationId]);

  return { convo, history, send, sending, sendError, markRead };
}
