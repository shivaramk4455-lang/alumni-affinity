import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { notificationDestination } from "@/lib/safe-link";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — The Merit Circle" },
      { name: "description", content: "Introductions, suggestions and verification updates." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Notifications,
});

function Notifications() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, kind, title, body, link, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const ids = (list.data ?? []).filter((n) => !n.read_at).map((n) => n.id);
      if (!ids.length) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Reading the inbox means the member has seen them: clear the badge on the
  // way out, but keep the "New" markers visible while they are still on screen.
  const unreadRef = useRef<string[]>([]);
  unreadRef.current = (list.data ?? []).filter((n) => !n.read_at).map((n) => n.id);
  useEffect(
    () => () => {
      const ids = unreadRef.current;
      if (!ids.length) return;
      void supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
    },
    [],
  );

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
            Updates
          </p>
          <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Notifications</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending}
        >
          Mark all read
        </Button>
      </div>

      <div className="mt-8 grid gap-3">
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : list.error ? (
          <p className="text-sm text-destructive">Could not load notifications.</p>
        ) : !list.data?.length ? (
          <div className="border border-dashed border-border p-10 text-center">
            <Bell className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">All quiet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Introductions, suggestions and desk decisions will appear here.
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/members">Search members</Link>
            </Button>
          </div>
        ) : (
          list.data.map((n) => (
            <Link
              key={n.id}
              to={notificationDestination(n.link)}
              onClick={() => {
                if (!n.read_at) markOne.mutate(n.id);
              }}
              className="block border border-border bg-card p-5 hover:border-brass"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{n.title}</p>
                {!n.read_at && (
                  <span className="shrink-0 border border-brass bg-brass/10 px-2 py-0.5 text-xs font-semibold text-brass-strong">
                    New
                  </span>
                )}
              </div>
              {n.body && <p className="mt-1 text-sm leading-6 text-muted-foreground">{n.body}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {new Date(n.created_at).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
