import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { MY_PROFILE_KEY } from "@/hooks/use-my-profile";

const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

export function AccountDangerZone() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const withdraw = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not-signed-in");
      const { error } = await supabase
        .from("profiles")
        .update({ is_visible: false })
        .eq("id", u.user.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      toast.success("Your profile is withdrawn from discovery.");
      setWithdrawOpen(false);
    },
    onError: () => toast.error("Could not withdraw. Please try again."),
  });

  const requestDeletion = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirm: deleteConfirm },
      });
      if (error) throw error;
      const payload = data as { error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
    },
    onSuccess: async () => {
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();
      toast.success("Your account and uploaded documents have been deleted.");
      navigate({ to: "/", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete the account."),
  });

  return (
    <>
      <section className="mt-6 border border-destructive/40 bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold text-destructive">
          <Trash2 className="size-5" /> Delete account & erase all data
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Exercise your right to erasure (DPDP Act s.12). This permanently purges your profile,
          uploaded credentials, photographs, messages, introductions, and login credentials. This
          action is irreversible.
        </p>

        {deleteOpen ? (
          <div
            role="group"
            aria-label="Confirm permanent account deletion"
            className="mt-5 space-y-4 rounded-md border border-destructive/30 bg-destructive/5 p-4"
          >
            <p className="text-sm font-semibold uppercase tracking-wider text-destructive">
              Permanent Deletion Confirmation
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              To confirm, type <strong className="text-foreground">{DELETE_CONFIRMATION}</strong>{" "}
              below:
            </p>
            <Input
              id="delete-confirm"
              aria-label={`Type ${DELETE_CONFIRMATION} to confirm permanent deletion`}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={DELETE_CONFIRMATION}
              className="max-w-sm border-destructive/40 bg-background text-sm"
            />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="destructive"
                disabled={deleteConfirm !== DELETE_CONFIRMATION || requestDeletion.isPending}
                onClick={() => requestDeletion.mutate()}
              >
                {requestDeletion.isPending ? "Erasing all data…" : "Permanently delete account"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirm("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="mt-5 border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteOpen(true)}
          >
            Request complete erasure
          </Button>
        )}
      </section>

      <section className="mt-6 border border-destructive/40 bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <TriangleAlert className="size-5 text-destructive" /> Withdraw membership
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Withdrawing hides your profile from discovery immediately. Your account, verifications and
          introductions are retained so you can return. Contact the grievance desk for full
          deletion.
        </p>
        {withdrawOpen ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              variant="destructive"
              onClick={() => withdraw.mutate()}
              disabled={withdraw.isPending}
            >
              Confirm withdrawal
            </Button>
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)}>
              Keep my profile
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="mt-5" onClick={() => setWithdrawOpen(true)}>
            Withdraw from discovery
          </Button>
        )}
      </section>
    </>
  );
}
