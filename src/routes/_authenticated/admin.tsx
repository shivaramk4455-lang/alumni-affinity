import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  FileCheck2,
  ShieldAlert,
  Undo2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MemberPhoto } from "@/components/member-photo";
import { useMyProfile, MY_PROFILE_KEY } from "@/hooks/use-my-profile";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Membership desk — The Merit Circle" },
      { name: "description", content: "Review pending verifications." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Admin,
});

type Decision = "verified" | "needs_resubmission" | "rejected";

function Admin() {
  const qc = useQueryClient();
  const [note, setNote] = useState<Record<string, string>>({});
  const [outcomeChoice, setOutcomeChoice] = useState<Record<string, string>>({});
  /**
   * Rejecting a member and dismissing a safety report are both irreversible
   * from this screen, and dismissing emails the reporter that their report was
   * dismissed. Both therefore take a second explicit click, and rejecting
   * requires a written reason so the member and the grievance desk can see it.
   */
  const [confirming, setConfirming] = useState<{ id: string; kind: Decision | "dismissed" } | null>(
    null,
  );
  /**
   * Server-side paging for the desk queue (see migration 20261016). We track a
   * page index and concatenate every fetched page, so the operator scrolls
   * through the backlog without the browser ever holding more rows than asked
   * for.
   */
  const PAGE = 10;
  const [page, setPage] = useState(0);

  const me = useMyProfile();

  // Private fields (alumni email, credential path) are only reachable through
  // the desk RPC, which re-checks private.is_admin() on every call.
  //
  // Paged server-side. Each row mounts a MemberPhoto that mints its own
  // 300-second signed URL, so an unbounded queue meant hundreds of image
  // requests against private storage just to review a dozen applications.
  // Rows are appended, not replaced, as the operator pages through.
  const pending = useQuery({
    queryKey: ["admin-pending"],
    enabled: me.data?.is_admin === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("desk_review_queue", {
        _limit: PAGE,
        _offset: 0,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Pages after the first, fetched on demand only.
  const morePending = useQuery({
    queryKey: ["admin-pending", page],
    enabled: me.data?.is_admin === true && page > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("desk_review_queue", {
        _limit: PAGE,
        _offset: page * PAGE,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const pendingRows = useMemo(() => {
    const first = pending.data ?? [];
    const rest = page > 0 ? (morePending.data ?? []) : [];
    const seen = new Set<string>();
    const rows: typeof first = [];
    for (const row of [...first, ...rest]) {
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  }, [pending.data, morePending.data, page]);

  const reports = useQuery({
    queryKey: ["admin-reports"],
    enabled: me.data?.is_admin === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("desk_reports", { _limit: 50 });
      if (error) throw error;
      return data;
    },
  });

  const decide = useMutation({
    mutationFn: async ({
      id,
      decision,
      noteText,
    }: {
      id: string;
      decision: Decision;
      noteText: string;
    }) => {
      const { data: fnData, error: fnError } = await supabase.functions.invoke("admin-review", {
        body: { profile_id: id, decision, note: noteText || null },
      });
      if (fnError) throw fnError;
      if (fnData && typeof fnData === "object" && "error" in fnData && fnData.error) {
        throw new Error(typeof fnData.error === "string" ? fnData.error : "Review failed");
      }
    },
    onSuccess: () => {
      setConfirming(null);
      qc.invalidateQueries({ queryKey: ["admin-pending"] });
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      toast.success("Review recorded.");
    },
    onError: (e) => {
      setConfirming(null);
      toast.error(e instanceof Error ? e.message : "Could not record the review.");
    },
  });

  // Liquidity over vanity: verified supply, reply rate, open safety work.
  const health = useQuery({
    queryKey: ["admin-health"],
    enabled: me.data?.is_admin === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("desk_network_health");
      if (error) throw error;
      return data as unknown as {
        verified_by_status?: Record<string, number>;
        verified_gender_split?: Record<string, number>;
        verified_last_7d?: number;
        reply_rate?: number | null;
        median_hours_to_reply?: number | null;
        open_reports?: number;
        unanswered_pending_interests?: number;
      };
    },
    staleTime: 30_000,
  });

  // Report triage: status moves through open -> in_review -> resolved/dismissed
  // and the reporter is notified server-side inside the same RPC.
  const updateReport = useMutation({
    mutationFn: async ({
      id,
      status,
      outcome,
    }: {
      id: string;
      status: "in_review" | "resolved" | "dismissed";
      outcome?: string;
    }) => {
      const { error } = await supabase.rpc("desk_update_report", {
        _id: id,
        _status: status,
        ...(outcome ? { _outcome: outcome } : {}),
        ...((note[id] ?? "").trim() ? { _note: (note[id] ?? "").trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      setConfirming(null);
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      qc.invalidateQueries({ queryKey: ["admin-health"] });
      // `desk_update_report` only notifies the reporter on resolved/dismissed.
      // Claiming otherwise on "take review" — which merely claims the ticket —
      // told someone who reported abuse that it had been handled.
      toast.success(
        v.status === "in_review"
          ? "Report claimed for review."
          : "Report updated — the reporter has been informed.",
      );
    },
    onError: (e) => {
      setConfirming(null);
      toast.error(e instanceof Error ? e.message : "Could not update the report.");
    },
  });

  if (me.isLoading)
    return (
      <main className="mx-auto max-w-4xl px-5 py-16">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  if (me.data?.is_admin !== true) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-20 text-center">
        <ShieldAlert className="mx-auto size-8 text-brass" />
        <h1 className="mt-5 font-serif text-3xl font-semibold">Membership desk only</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This area is restricted to the verification team.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 md:px-8 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        Membership desk
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Verification reviews</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Approve credentials or request resubmission with a private note. Decisions are recorded by a
        server function so members can never self-verify.
      </p>

      {/* Liquidity panel: the metrics that decide whether the network is alive. */}
      <section className="mt-8 border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
          <Activity className="size-4 text-brass" /> Network health
        </h2>
        {health.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : health.error ? (
          <p className="mt-3 text-sm text-destructive">Could not load network health.</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Stat
                label="Verified members"
                value={Object.values(health.data?.verified_by_status ?? {}).reduce(
                  (a, b) => a + b,
                  0,
                )}
              />
              <Stat
                label="Reply rate (30d)"
                value={
                  health.data?.reply_rate == null
                    ? "—"
                    : `${Math.round((health.data.reply_rate ?? 0) * 100)}%`
                }
              />
              <Stat
                label="Median reply time"
                value={
                  health.data?.median_hours_to_reply == null
                    ? "—"
                    : `${health.data.median_hours_to_reply}h`
                }
              />
              <Stat label="Open reports" value={health.data?.open_reports ?? 0} />
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Verified by status:{" "}
              {Object.entries(health.data?.verified_by_status ?? {})
                // Raw enum keys leaked as e.g. "needs_resubmission 4".
                .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                .join(" · ") || "none"}
              {" · "}Gender split (verified):{" "}
              {Object.entries(health.data?.verified_gender_split ?? {})
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ") || "none"}
              {" · "}New verified this week: {health.data?.verified_last_7d ?? 0}
              {" · "}Introductions expiring in 3 days:{" "}
              {health.data?.unanswered_pending_interests ?? 0}
            </p>
          </>
        )}
      </section>

      <div className="mt-8 grid gap-4">
        {pending.isLoading ? (
          <div className="grid gap-3" aria-busy="true">
            <span className="sr-only">Loading the review queue…</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : pending.error ? (
          <p role="alert" className="border border-destructive/40 p-5 text-sm leading-6 text-destructive">
            Could not load the queue.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void pending.refetch()}
              disabled={pending.isFetching}
            >
              {pending.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        ) : !pendingRows.length ? (
          <p className="border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Queue is clear. No pending verifications.
          </p>
        ) : (
          <>
            {pendingRows.map((p) => (
              <article
                key={p.id}
                className="grid gap-6 border border-border bg-card p-5 md:grid-cols-[160px_1fr] md:p-7"
              >
                <MemberPhoto path={p.photo_path} watermark="Desk review" name={p.full_name} />
                <div className="min-w-0">
                  <h2 className="font-serif text-2xl font-semibold">{p.full_name || "Member"}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {p.degree}, {p.institution} ({p.grad_year}) · {p.city}
                  </p>
                  <p className="mt-2 text-sm">Institutional email: {p.alumni_email || "—"}</p>
                  <p className="mt-1 text-sm">
                    Credential:{" "}
                    {p.verification_doc_path ? (
                      // Without the member's name the desk hears N identical
                      // "open document" buttons with no idea whose file is whose.
                      <DocLink path={p.verification_doc_path} name={p.full_name || "this member"} />
                    ) : (
                      "none uploaded"
                    )}
                  </p>
                  <div className="mt-4 grid gap-2">
                    <Input
                      // A placeholder is not an accessible name: it vanishes on
                      // focus and is not exposed to assistive technology.
                      aria-label={`Private note to ${p.full_name || "this member"}, shown to them on resubmission`}
                      placeholder="Private note to the member (shown on resubmission)"
                      value={note[p.id] ?? ""}
                      onChange={(e) => setNote((s) => ({ ...s, [p.id]: e.target.value }))}
                      maxLength={600}
                    />
                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={() =>
                          decide.mutate({
                            id: p.id,
                            decision: "verified",
                            noteText: (note[p.id] ?? "").trim(),
                          })
                        }
                        disabled={decide.isPending}
                      >
                        <BadgeCheck /> Approve
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          decide.mutate({
                            id: p.id,
                            decision: "needs_resubmission",
                            noteText: (note[p.id] ?? "").trim(),
                          })
                        }
                        disabled={decide.isPending}
                      >
                        <Undo2 /> Request resubmission
                      </Button>
                      {confirming?.id === p.id && confirming.kind === "rejected" ? (
                        <div
                          role="group"
                          aria-label={`Confirm declining ${p.full_name || "this member"}`}
                          className="grid basis-full gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                        >
                          <p className="text-sm font-semibold text-destructive">
                            Decline {p.full_name || "this member"}?
                          </p>
                          <p className="text-sm leading-6 text-muted-foreground">
                            This is recorded against their profile and cannot be undone from this
                            screen. A reason is required so the member and the grievance desk can
                            see it.
                          </p>
                          {!(note[p.id] ?? "").trim() && (
                            <p role="alert" className="text-sm text-destructive">
                              Add a reason in the note field above before declining.
                            </p>
                          )}
                          <div className="flex flex-wrap gap-3">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={decide.isPending || !(note[p.id] ?? "").trim()}
                              onClick={() =>
                                decide.mutate({
                                  id: p.id,
                                  decision: "rejected",
                                  noteText: (note[p.id] ?? "").trim(),
                                })
                              }
                            >
                              {decide.isPending ? "Declining…" : "Yes, decline"}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => setConfirming({ id: p.id, kind: "rejected" })}
                          disabled={decide.isPending}
                        >
                          Decline
                        </Button>
                      )}
                      {p.verification_doc_path && (
                        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                          <FileCheck2 className="size-4 text-brass" /> Credential uploaded — open
                          via the link in this row.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {/*
              A short page means the queue is exhausted; a full one means there
              is probably more. The RPC caps a page at 200 regardless of what
              is asked, so this never walks off the end silently.
            */}
            {morePending.error ? (
              <p role="alert" className="border border-destructive/40 p-4 text-sm text-destructive">
                Could not load the next page.{" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => void morePending.refetch()}
                  disabled={morePending.isFetching}
                >
                  {morePending.isFetching ? "Retrying…" : "Retry"}
                </button>
              </p>
            ) : (
              <div className="flex flex-col items-center gap-2 border border-dashed border-border p-5 text-center">
                <p className="text-sm text-muted-foreground">
                  Showing {pendingRows.length} application{pendingRows.length === 1 ? "" : "s"}.
                </p>
                {(morePending.data?.length ?? 0) > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setPage((n) => n + 1)}
                    disabled={morePending.isFetching}
                  >
                    {morePending.isFetching ? "Loading…" : "Load next 10"}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-semibold">Member reports</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Reports are private to the desk. Reports never reveal who filed what to the reported
          member.
        </p>
        <div className="mt-5 grid gap-3">
          {reports.isLoading ? (
            <div aria-busy="true">
              <span className="sr-only">Loading reports…</span>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="mb-3 h-32 w-full" />
              ))}
            </div>
          ) : reports.isError ? (
            // Never render "no reports" for a failed read: the desk would read
            // a broken connection as an absence of member safety reports.
            <p
              role="alert"
              className="border border-destructive/40 p-5 text-sm leading-6 text-destructive"
            >
              Reports could not be loaded. This is not the same as having none.{" "}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => void reports.refetch()}
                disabled={reports.isFetching}
              >
                {reports.isFetching ? "Retrying…" : "Retry"}
              </button>
            </p>
          ) : !reports.data?.length ? (
            <p className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No reports filed.
            </p>
          ) : (
            reports.data.map((r) => (
              <article key={r.id} className="border border-border bg-card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="font-serif text-lg font-semibold">{r.reported_name}</p>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full border px-3 py-1 text-xs ${
                        r.status === "open"
                          ? "border-destructive/40 text-destructive"
                          : r.status === "in_review"
                            ? "border-brass/50 text-brass"
                            : "border-success/40 text-success"
                      }`}
                    >
                      {r.status.replace("_", " ")}
                      {r.outcome ? ` · ${r.outcome.replace(/_/g, " ")}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-6">{r.reason}</p>
                <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Filed by {r.reporter_name}</span>
                  <span>·</span>
                  <span>{r.reported_visible ? "Still discoverable" : "Hidden from discovery"}</span>
                  <Link
                    to="/members/$id"
                    params={{ id: r.reported_profile_id }}
                    className="font-semibold text-foreground underline underline-offset-4"
                  >
                    Open profile
                  </Link>
                </p>
                {r.resolution_note && (
                  <p className="mt-2 border-l-2 border-brass bg-secondary/40 px-3 py-2 text-xs leading-5">
                    Desk note: {r.resolution_note}
                    {r.handled_at ? ` — ${new Date(r.handled_at).toLocaleDateString("en-IN")}` : ""}
                  </p>
                )}
                {r.status !== "resolved" && r.status !== "dismissed" && (
                  <div className="mt-4 grid gap-3 border-t border-border pt-4">
                    <Input
                      placeholder="Private resolution note (recorded, not shown to the reported member)"
                      value={note[r.id] ?? ""}
                      onChange={(e) => setNote((s) => ({ ...s, [r.id]: e.target.value }))}
                      maxLength={600}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        className="h-9 border border-input bg-background px-3 text-sm"
                        value={outcomeChoice[r.id] ?? "referred_to_desk"}
                        onChange={(e) =>
                          setOutcomeChoice((s) => ({ ...s, [r.id]: e.target.value }))
                        }
                        aria-label="Resolution outcome"
                      >
                        <option value="referred_to_desk">Referred to desk</option>
                        <option value="no_action">No action</option>
                        <option value="warning_sent">Warning sent</option>
                        <option value="profile_hidden">Profile hidden</option>
                        <option value="account_suspended">Account suspended</option>
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateReport.isPending}
                        onClick={() =>
                          updateReport.mutate({
                            id: r.id,
                            status: "in_review",
                          })
                        }
                      >
                        <Clock3 className="size-4" /> Take review
                      </Button>
                      <Button
                        size="sm"
                        disabled={updateReport.isPending}
                        onClick={() =>
                          updateReport.mutate({
                            id: r.id,
                            status: "resolved",
                            outcome: outcomeChoice[r.id] ?? "referred_to_desk",
                          })
                        }
                      >
                        <CheckCircle2 className="size-4" /> Resolve
                      </Button>
                      {confirming?.id === r.id && confirming.kind === "dismissed" ? (
                        <div
                          role="group"
                          aria-label="Confirm dismissing this report"
                          className="grid basis-full gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                        >
                          <p className="text-sm font-semibold text-destructive">
                            Dismiss this report?
                          </p>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {r.reporter_name} is notified that their report was dismissed, and this
                            cannot be undone from this screen. Add a resolution note above first.
                          </p>
                          <div className="flex flex-wrap gap-3">
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={updateReport.isPending}
                              onClick={() => updateReport.mutate({ id: r.id, status: "dismissed" })}
                            >
                              {updateReport.isPending ? "Dismissing…" : "Yes, dismiss"}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={updateReport.isPending}
                          onClick={() => setConfirming({ id: r.id, kind: "dismissed" })}
                        >
                          <XCircle className="size-4" /> Dismiss
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-border p-3">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-xl font-semibold">{value}</p>
    </div>
  );
}

function DocLink({ path, name }: { path: string; name: string }) {
  const [opening, setOpening] = useState(false);
  async function open() {
    setOpening(true);
    try {
      const { data, error } = await supabase.storage
        .from("verification-docs")
        .createSignedUrl(path, 300);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("No URL returned");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open the document.");
    } finally {
      setOpening(false);
    }
  }
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0 text-sm"
      disabled={opening}
      onClick={open}
      // Names the document, so N rows do not all read as "open document".
      aria-label={`Open ${name}'s credential document`}
    >
      {opening ? "Opening…" : "open document"}
    </Button>
  );
}
