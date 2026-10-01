import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Clock3,
  EyeOff,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useMyProfile } from "@/hooks/use-my-profile";
import { verificationLabel } from "@/lib/profile-options";

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
        .order("updated_at", { ascending: false });
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
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const p = me.data;
  const myId = p?.id;
  const firstName = p?.full_name?.split(" ")[0] || "there";
  const status = verificationLabel(p?.verification_status);
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
        <div className="mb-7 flex items-center gap-3 border-l-2 border-brass bg-background px-5 py-4 text-sm">
          <LockKeyhole className="size-4 shrink-0 text-brass" />
          <span>
            Only you can approve interests or reveal photographs. Co-pilots can suggest profiles and
            add private notes.
          </span>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
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
              {p?.verification_status !== "verified" && (
                <Button asChild className="mt-6">
                  <Link to="/verification">Continue verification</Link>
                </Button>
              )}
            </section>

            <section className="border border-border bg-card p-5 shadow-paper md:p-7">
              <h2 className="font-serif text-2xl font-semibold">Your controls</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Privacy settings travel with your profile everywhere.
              </p>
              <div className="mt-6 divide-y divide-border border-y border-border">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4">
                  <span className="text-brass [&_svg]:size-5">
                    <UserRoundCheck />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Profile details & attributes</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {p?.onboarded
                        ? `${p.institution || "Alumni"} · ${p.city || "City"} · Edit bio, values, height and background.`
                        : "Complete your member profile to start discovery."}
                    </p>
                  </div>
                  <Link to="/onboarding">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4">
                  <span className="text-brass [&_svg]:size-5">
                    <EyeOff />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {p?.is_visible === false ? "Ghost mode is on" : "Visible in discovery"}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {p?.is_visible === false
                        ? "You do not appear in general discovery."
                        : "Verified members can find you in search."}
                    </p>
                  </div>
                  <Link to="/settings">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4">
                  <span className="text-brass [&_svg]:size-5">
                    <ShieldCheck />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {received
                        ? `${received} introduction${received === 1 ? "" : "s"} awaiting you`
                        : "No pending introductions"}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {accepted
                        ? `${accepted} accepted · contact details unlocked.`
                        : "Only fully verified members may send interest."}
                    </p>
                  </div>
                  <Link to="/connections">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4">
                  <span className="text-brass [&_svg]:size-5">
                    <UsersRound />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {mine.length
                        ? `${mine.length} co-pilot${mine.length === 1 ? "" : "s"} invited`
                        : "No co-pilots yet"}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {activeCopilot
                        ? `${activeCopilot.copilot_name || activeCopilot.copilot_email} · view and suggest access.`
                        : "Many members invite one parent."}
                    </p>
                  </div>
                  <Link to="/copilots">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </div>
              </div>
            </section>
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
