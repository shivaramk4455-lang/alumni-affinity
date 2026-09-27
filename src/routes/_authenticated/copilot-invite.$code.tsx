import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/copilot-invite/$code")({
  head: () => ({
    meta: [
      { title: "Co-pilot invitation — The Merit Circle" },
      { name: "description", content: "Accept an invitation to co-pilot for a family member." },
      { property: "og:title", content: "Co-pilot invitation — The Merit Circle" },
      { property: "og:description", content: "Accept a family co-pilot invitation." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CopilotInvite,
});

function CopilotInvite() {
  const { code } = Route.useParams();
  const navigate = useNavigate();

  const accept = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("sign-in-required");
      // SECURITY DEFINER: binds the invite to the signed-in email, freezes
      // candidate_id/invite_code, and writes the candidate's notification.
      const { data, error } = await supabase.rpc("accept_copilot_invite", { _code: code });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      toast.success("You are now a co-pilot.");
      navigate({ to: "/copilots" });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "";
      if (message.includes("invitation_email_mismatch")) {
        toast.error(
          "This invitation was sent to a different email address. Sign in with that address to accept.",
        );
      } else if (message.includes("invitation_already_used")) {
        toast.error("This invitation has already been accepted.");
      } else {
        toast.error("This invitation is not valid or has already been used.");
      }
    },
  });

  return (
    <main className="mx-auto max-w-2xl px-5 py-16 md:py-24">
      <div className="border border-border bg-card p-7 text-center md:p-12">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-brass/10 text-brass">
          <UsersRound className="size-6" />
        </span>
        <h1 className="mt-7 font-serif text-3xl font-semibold md:text-4xl">
          A family member has invited you to co-pilot.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-muted-foreground">
          As a co-pilot you may look through verified members and suggest profiles with a private
          note. You cannot express interest, accept an introduction, or see contact details — those
          remain with the candidate alone.
        </p>
        <Button
          size="lg"
          className="mt-8"
          onClick={() => accept.mutate()}
          disabled={accept.isPending}
        >
          Accept invitation
        </Button>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" /> Access can be withdrawn by the candidate
          at any time.
        </p>
        <p className="mt-6 text-sm">
          <Link to="/members" className="font-semibold underline underline-offset-4">
            Not now
          </Link>
        </p>
      </div>
    </main>
  );
}
