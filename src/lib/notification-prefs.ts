import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

/**
 * Outbound channel preferences.
 *
 * Alerts are opt-out (email on by default) but SMS/WhatsApp are opt-in, since
 * both cost money per message and neither is required for the product to work.
 * The weekly digest is opt-in for the same reason. Alerts and the digest are
 * separate switches: a member may well want to hear about an accepted
 * introduction immediately but not receive a weekly roundup.
 */
export type NotificationPreferences = {
  email_alerts: boolean;
  sms_alerts: boolean;
  whatsapp_alerts: boolean;
  email_digest: boolean;
  digest_skip_when_empty: boolean;
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  email_alerts: true,
  sms_alerts: false,
  whatsapp_alerts: false,
  email_digest: false,
  digest_skip_when_empty: true,
};

const PREF_KEY = ["notification-preferences"];

/** Coarse delivery status, so the desk can see a backlog without reading logs. */
export type OutboxStatus = {
  sent: number;
  queued: number;
  failed: number;
};

export function useNotificationPreferences() {
  return useQuery({
    queryKey: PREF_KEY,
    queryFn: async (): Promise<NotificationPreferences> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return DEFAULT_PREFERENCES;

      const { data, error } = await supabase
        .from("notification_preferences")
        .select("email_alerts, sms_alerts, whatsapp_alerts, email_digest, digest_skip_when_empty")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      // A missing row is not a missing preference: the column defaults are the
      // intended defaults, so an absent row renders as the defaults.
      if (!data) return DEFAULT_PREFERENCES;
      return {
        email_alerts: data.email_alerts,
        sms_alerts: data.sms_alerts,
        whatsapp_alerts: data.whatsapp_alerts,
        email_digest: data.email_digest,
        digest_skip_when_empty: data.digest_skip_when_empty,
      };
    },
  });
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<NotificationPreferences>) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("not-signed-in");

      // Upsert rather than update: a member who has never opened this screen
      // has no row yet, and the switch they just flipped must still stick.
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PREF_KEY });
    },
    onError: () => toast.error("Could not save your notification settings."),
  });
}

/** The member's own delivery history — read-only, straight from the outbox. */
export function useOutboxHistory() {
  return useQuery({
    queryKey: ["notification-outbox"],
    queryFn: async (): Promise<
      { id: string; channel: string; template: string; status: string; sent_at: string | null }[]
    > => {
      const { data, error } = await supabase
        .from("notification_outbox")
        .select("id, channel, template, status, sent_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}
