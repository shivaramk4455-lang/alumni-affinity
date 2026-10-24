import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { MY_PROFILE_KEY } from "@/hooks/use-my-profile";
import { recordConsent } from "@/lib/consent";
import { useContactAccessLog, useProfileNames, useVisitorLog } from "@/lib/access-log";

const CONSENT_RECEIPT_WARNING =
  "Saved, but the consent receipt could not be written — retry from Settings.";

interface AccessAuditLogsSectionProps {
  profile?:
    | {
        id: string;
        show_profile_views?: boolean | null | undefined;
      }
    | null
    | undefined;
}

export function AccessAuditLogsSection({ profile }: AccessAuditLogsSectionProps) {
  const qc = useQueryClient();

  const visitorLog = useVisitorLog(profile?.show_profile_views === true);
  const activityTracking = useQuery({
    queryKey: ["activity-tracking", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("member_activity")
        .select("enabled")
        .maybeSingle();
      if (error) throw error;
      return data?.enabled ?? false;
    },
  });

  const saveActivityTracking = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.rpc("set_member_activity_tracking", {
        _enabled: enabled,
        _policy_version: "2026-09",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["activity-tracking"] });
      void qc.invalidateQueries({ queryKey: ["directory-match-signals"] });
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["consent-events"] });
      toast.success("Activity sharing preference saved.");
    },
    onError: () => toast.error("Could not update activity sharing."),
  });

  const contactLog = useContactAccessLog(profile?.id);
  const names = useProfileNames([
    ...(visitorLog.data ?? []).map((v) => v.viewer_id),
    ...(contactLog.data ?? []).map((r) => r.viewer_id),
  ]);

  /**
   * First name + institution only: the audit log never needs a full record.
   * A failed name read must read differently from a name we simply do not have,
   * so a transient outage is not mistaken for an anonymous stranger.
   */
  const who = (id: string): string => {
    const row = names.data?.find((n) => n.id === id);
    if (!row) return names.isError ? "Identity unavailable" : "A member";
    const first = row.full_name?.split(" ")[0] || "Member";
    return row.institution ? `${first} · ${row.institution}` : first;
  };

  const saveViewPref = useMutation({
    mutationFn: async (next: boolean) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not-signed-in");
      const { error } = await supabase
        .from("profiles")
        .update({ show_profile_views: next })
        .eq("id", u.user.id);
      if (error) throw error;
      return recordConsent(
        "profile_views_display",
        next,
        next ? "Visitor log display enabled" : "Visitor log display disabled",
      );
    },
    onSuccess: (consent) => {
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      qc.invalidateQueries({ queryKey: ["consent-events"] });
      if (consent.ok) toast.success("Visibility preference saved.");
      else toast.warning(CONSENT_RECEIPT_WARNING, { duration: 8000 });
    },
    onError: () => toast.error("Could not update the visitor log setting."),
  });

  return (
    <section className="mt-6 border border-border bg-card p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
            <Eye className="size-5 text-brass" /> Access audit log
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Every profile view and every opening of your contact coordinates is recorded. Viewing is
            logged whether or not you choose to see it — the toggle only controls what is shown back
            to you.
          </p>
          {names.isError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              Some visitor names could not be loaded, so those rows read “Identity unavailable”.{" "}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => void names.refetch()}
                disabled={names.isFetching}
              >
                {names.isFetching ? "Retrying…" : "Retry"}
              </button>
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-start gap-3 text-sm font-medium">
            <Switch
              checked={profile?.show_profile_views === true}
              disabled={saveViewPref.isPending}
              onCheckedChange={(v) => saveViewPref.mutate(v)}
              aria-label="Show who viewed my profile"
            />
            <span>
              Show visitors
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                When on, verified members who opted to show visitor history can appear here.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm font-medium">
            <Switch
              checked={activityTracking.data === true}
              disabled={activityTracking.isLoading || saveActivityTracking.isPending}
              onCheckedChange={(enabled) => saveActivityTracking.mutate(enabled)}
              aria-label="Share coarse recent activity"
            />
            <span>
              Share coarse recent activity
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Optional. Verified members may see “active recently” or “active this week”, never an
                exact time.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
            Profile visitors
          </p>
          <div className="mt-3 divide-y divide-border border border-border">
            {visitorLog.isLoading ? (
              <p className="p-3 text-xs text-muted-foreground">Loading…</p>
            ) : visitorLog.isError ? (
              <p role="alert" className="p-3 text-xs text-destructive">
                Your visitor log could not be loaded. This is not the same as an empty log.{" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => void visitorLog.refetch()}
                  disabled={visitorLog.isFetching}
                >
                  {visitorLog.isFetching ? "Retrying…" : "Retry"}
                </button>
              </p>
            ) : !visitorLog.data?.length ? (
              <p className="p-3 text-xs text-muted-foreground">
                {profile?.show_profile_views
                  ? "No visits recorded yet."
                  : "Turn on “Show visitors” to see this log."}
              </p>
            ) : (
              visitorLog.data.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {who(v.viewer_id)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(v.viewed_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
            Contact coordinates opened
          </p>
          <div className="mt-3 divide-y divide-border border border-border">
            {contactLog.isLoading ? (
              <p className="p-3 text-xs text-muted-foreground">Loading…</p>
            ) : contactLog.isError ? (
              <p role="alert" className="p-3 text-xs text-destructive">
                This log could not be loaded. This is not the same as nobody having looked.{" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => void contactLog.refetch()}
                  disabled={contactLog.isFetching}
                >
                  {contactLog.isFetching ? "Retrying…" : "Retry"}
                </button>
              </p>
            ) : !contactLog.data?.length ? (
              <p className="p-3 text-xs text-muted-foreground">
                Nobody has opened your contact details yet.
              </p>
            ) : (
              contactLog.data.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col gap-1 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {who(r.viewer_id)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {r.access_count} × · last{" "}
                    {new Date(r.last_revealed_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
