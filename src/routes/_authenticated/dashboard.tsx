import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  Check,
  Clock3,
  FileCheck2,
  MessageSquare,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useMyProfile } from "@/hooks/use-my-profile";
import { verificationLabel } from "@/lib/profile-options";
import { profileCompleteness } from "@/lib/profile-completeness";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your membership — The Merit Circle" },
      {
        name: "description",
        content: "Verification progress, introductions and co-pilot activity at a glance.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const me = useMyProfile();

  const interests = useQuery({
    queryKey: ["interests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interests")
        .select("id, sender_id, recipient_id, status")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const copilots = useQuery({
    queryKey: ["copilots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilots")
        .select("id, candidate_id, copilot_name, copilot_email, status")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const p = me.data;
  const myId = p?.id;
  const firstName = p?.full_name?.split(" ")[0] || "there";
  const status = verificationLabel(p?.verification_status);
  // Weighted so substance carries the score; see profile-completeness.ts.
  const completeness = profileCompleteness(p);
  const all = interests.data ?? [];
  const received = all.filter((i) => i.recipient_id === myId && i.status === "pending").length;
  const accepted = all.filter(
    (i) => i.status === "accepted" && (i.sender_id === myId || i.recipient_id === myId),
  ).length;
  const mine = (copilots.data ?? []).filter(
    (c) => c.candidate_id === myId && c.status !== "revoked",
  );
  const activeCopilot = mine.find((c) => c.status === "active") ?? mine[0];

  const stepsDone =
    (p?.alumni_email || p?.verification_doc_path ? 1 : 0) +
    (p?.verification_status === "pending_review" || p?.verification_status === "verified" ? 1 : 0) +
    (p?.verification_status === "verified" ? 1 : 0);

  return (
    <main className="min-h-screen bg-secondary/35">
      <section className="border-b border-border bg-background px-5 py-9 md:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-bold uppercase tracking-[0.17em] text-brass">
            Membership desk
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold md:text-4xl">
            Good to see you, {firstName}.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {p?.onboarded
              ? "Your profile is private while verification is underway."
              : "Finish your profile to open member search."}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-12">
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <section className="border border-border bg-card p-5 shadow-paper md:p-7">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.15em] text-brass">
                    Profile strength
                  </p>
                  <h2 className="mt-2 font-serif text-2xl font-semibold">
                    {completeness.percent === 100
                      ? "Your profile is complete"
                      : `${completeness.percent}% complete`}
                  </h2>
                </div>
                <span className="shrink-0 border border-brass bg-brass/10 px-2.5 py-1 text-xs font-semibold text-brass-strong">
                  {completeness.percent}%
                </span>
              </div>

              {/* A meter only a member can see: never shown to others, and the
                  score is weighted so a photoless or silent profile cannot
                  reach 100%. */}
              <div
                className="mt-7 h-1.5 overflow-hidden bg-muted"
                role="progressbar"
                aria-valuenow={completeness.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Profile completeness"
              >
                <div className="h-full bg-brass" style={{ width: `${completeness.percent}%` }} />
              </div>

              {completeness.missing.length === 0 ? (
                <p className="mt-5 text-sm leading-6 text-muted-foreground">
                  Nothing outstanding. Keep it current as things change.
                </p>
              ) : (
                <>
                  <p className="mt-5 text-sm leading-6 text-muted-foreground">
                    {completeness.missing.length === 1
                      ? "One thing would strengthen your profile:"
                      : `${completeness.missing.length} things would strengthen your profile:`}
                  </p>
                  <ul className="mt-4 grid gap-3">
                    {completeness.missing.map((m) => (
                      <li
                        key={m.label}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/40 pb-2.5 text-sm last:border-0 last:pb-0"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass" />
                          <span className="min-w-0">
                            <span className="font-medium text-foreground">{m.label}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                              {m.hint}
                            </span>
                          </span>
                        </div>
                        {m.to && (
                          <Button
                            asChild
                            size="sm"
                            variant="outline"
                            className="h-7 self-start sm:self-center shrink-0 text-xs font-semibold"
                          >
                            <Link to={m.to} {...(m.hash ? { hash: m.hash } : {})}>
                              {m.actionLabel || "Add"}
                            </Link>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {!p?.photo_path && (
                      <Button
                        asChild
                        size="sm"
                        className="bg-foreground text-background hover:bg-foreground/90 font-medium shadow-sm"
                      >
                        <Link to="/verification" hash="photos">
                          <Camera className="mr-1.5 size-4" />
                          Upload photo
                        </Link>
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <Link to="/onboarding">Edit profile details</Link>
                    </Button>
                  </div>
                </>
              )}
            </section>

            {p?.verification_status === "verified" ? (
              <section className="border border-border bg-card p-5 shadow-paper md:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-brass">
                      Introductions & Activity
                    </p>
                    <h2 className="mt-1 font-serif text-2xl font-semibold">
                      {received > 0
                        ? `${received} pending introduction${received === 1 ? "" : "s"}`
                        : "Introductions overview"}
                    </h2>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/connections">View introductions</Link>
                  </Button>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="border border-border bg-secondary/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      Awaiting response
                    </p>
                    <p className="mt-2 font-serif text-3xl font-semibold">
                      {interests.isPending ? <Skeleton className="h-8 w-16" /> : received}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {received === 0
                        ? "No pending introductions"
                        : "Introductions received from verified members"}
                    </p>
                  </div>

                  <div className="border border-border bg-secondary/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      Active connections
                    </p>
                    <p className="mt-2 font-serif text-3xl font-semibold">
                      {interests.isPending ? <Skeleton className="h-8 w-16" /> : accepted}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Mutual introductions with unlocked contact details
                    </p>
                  </div>
                </div>

                {activeCopilot && (
                  <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <UsersRound className="size-4 text-brass" />
                      Family co-pilot:{" "}
                      <strong className="text-foreground">
                        {activeCopilot.copilot_name || activeCopilot.copilot_email}
                      </strong>
                    </span>
                    <Link to="/copilots" className="font-semibold text-brass hover:underline">
                      Manage co-pilot
                    </Link>
                  </div>
                )}
              </section>
            ) : (
              <section className="border border-border bg-card p-5 shadow-paper md:p-7">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-brass">
                      Verification
                    </p>
                    <h2 className="mt-2 font-serif text-2xl font-semibold">{status.label}</h2>
                  </div>
                  <span className="shrink-0 border border-brass bg-brass/10 px-2.5 py-1 text-xs font-semibold text-brass-strong">
                    {stepsDone} of 3 complete
                  </span>
                </div>
                <div className="mt-7 h-1.5 overflow-hidden bg-muted">
                  <div
                    className="h-full bg-brass"
                    style={{ width: `${Math.round((stepsDone / 3) * 100)}%` }}
                  />
                </div>
                <div className="mt-7 grid gap-3">
                  <Status
                    icon={<UserRoundCheck />}
                    title="Identity"
                    detail={
                      p?.full_name
                        ? `${p.full_name} · profile ${p.onboarded ? "complete" : "in progress"}`
                        : "Complete onboarding to begin"
                    }
                    done={!!p?.onboarded}
                  />
                  <Status
                    icon={<FileCheck2 />}
                    title="Institution"
                    detail={
                      p?.alumni_email
                        ? `${p.alumni_email}${p.alumni_email_verified ? " · confirmed" : ""}`
                        : p?.verification_doc_path
                          ? "Credential uploaded · awaiting desk"
                          : "Add an alumni email or credential"
                    }
                    done={!!(p?.alumni_email_verified || p?.verification_status === "verified")}
                  />
                  <Status
                    icon={<Clock3 />}
                    title="Desk review"
                    detail={
                      p?.verification_status === "verified"
                        ? "Complete"
                        : p?.verification_status === "pending_review"
                          ? "Usually within 24 hours"
                          : "Not yet submitted"
                    }
                    done={p?.verification_status === "verified"}
                  />
                </div>
                <Button asChild className="mt-6">
                  <Link to="/verification">Continue verification</Link>
                </Button>
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <section className="border border-border bg-primary p-6 text-primary-foreground">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-brass">Next step</p>
              <h2 className="mt-3 font-serif text-2xl font-semibold">
                {!p?.onboarded
                  ? "Complete your introduction"
                  : p?.verification_status !== "verified"
                    ? "Finish verification"
                    : received
                      ? "Reply to your introductions"
                      : "Search the Circle"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-primary-foreground/65">
                {!p?.onboarded
                  ? "Add a thoughtful note about the partnership and everyday life you hope to build."
                  : p?.verification_status !== "verified"
                    ? "Submit your credential to the membership desk."
                    : "Your suggestions remain private until you choose to act on them."}
              </p>
              <Button asChild variant="secondary" className="mt-6 w-full">
                <Link
                  to={
                    !p?.onboarded
                      ? "/onboarding"
                      : p?.verification_status !== "verified"
                        ? "/verification"
                        : received
                          ? "/connections"
                          : "/members"
                  }
                >
                  {!p?.onboarded
                    ? "Continue profile"
                    : p?.verification_status !== "verified"
                      ? "Open verification"
                      : received
                        ? "Review introductions"
                        : "Search members"}
                </Link>
              </Button>
            </section>
            <section className="border border-border bg-card p-6 shadow-paper">
              <ShieldCheck className="size-6 text-success" />
              <h2 className="mt-4 font-serif text-xl font-semibold">Privacy centre</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Review visibility, photograph access, or withdraw your application at any time.
              </p>
              <Button asChild variant="outline" className="mt-5 w-full">
                <Link to="/settings">Open privacy centre</Link>
              </Button>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Status({
  icon,
  title,
  detail,
  done = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  done?: boolean;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border border-border p-4">
      <span
        className={`grid size-9 place-items-center rounded-full [&_svg]:size-4 ${done ? "bg-success/10 text-success" : "bg-brass/10 text-brass"}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
      {done && <Check className="size-4 shrink-0 text-success" />}
    </div>
  );
}
