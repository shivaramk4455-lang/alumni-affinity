import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookmarkX, GraduationCap, MapPin, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyProfile } from "@/hooks/use-my-profile";
import { supabase } from "@/integrations/supabase/client";
import { BASE_SEARCH_COLUMNS, SEARCH_COLUMNS } from "@/lib/profile-columns";

export const Route = createFileRoute("/_authenticated/shortlist")({
  head: () => ({
    meta: [
      { title: "Shortlist — The Merit Circle" },
      {
        name: "description",
        content: "Profiles you saved for later. Private to you.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ShortlistPage,
});

const year = new Date().getFullYear();

/**
 * The saved-profiles tray as a page of its own rather than a checkbox on
 * search. Saved rows are owner-visible only: this page shows *your* saves,
 * and nobody is ever told you saved them. Unsave here mirrors the toggle on
 * the profile page through the same ["saved"] cache key.
 */
function ShortlistPage() {
  const me = useMyProfile();
  const qc = useQueryClient();

  const saved = useQuery({
    queryKey: ["saved"],
    enabled: !!me.data,
    queryFn: async () => {
      // Bounded: RLS scopes this to the member's own shortlist, but it grows
      // over a lifetime and this query runs on every shortlist load.
      const { data, error } = await supabase.from("saved_profiles").select("profile_id").limit(500);
      if (error) throw error;
      return (data ?? []).map((r) => r.profile_id);
    },
  });

  const savedKey = [...(saved.data ?? [])].sort().join(",");
  const profiles = useQuery({
    queryKey: ["saved-profiles", savedKey],
    enabled: !!me.data && saved.isSuccess,
    queryFn: async () => {
      const ids = saved.data ?? [];
      if (!ids.length) return [];
      const res = await supabase.from("profiles").select(SEARCH_COLUMNS).in("id", ids);
      if (!res.error && res.data) return res.data;
      if (res.error) {
        console.warn("Retrying shortlist query with BASE_SEARCH_COLUMNS:", res.error.message);
        const fallback = await supabase.from("profiles").select(BASE_SEARCH_COLUMNS).in("id", ids);
        if (!fallback.error && fallback.data) {
          return fallback.data.map((r) => ({
            ...r,
            religion: null,
            caste: null,
            gotra: null,
          }));
        }
        throw fallback.error || res.error;
      }
      return [];
    },
  });

  const unsave = useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await supabase.from("saved_profiles").delete().eq("profile_id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved"] });
      qc.invalidateQueries({ queryKey: ["saved-profiles"] });
      toast.success("Removed from your shortlist.");
    },
    onError: () => toast.error("Could not remove from your shortlist."),
  });

  const sorted = [...(profiles.data ?? [])].sort((a, b) =>
    (a.full_name ?? "").localeCompare(b.full_name ?? ""),
  );

  if (me.isError) {
    return (
      <main className="mx-auto max-w-7xl px-5 py-20 text-center md:px-8">
        <h1 className="font-serif text-3xl font-semibold">Shortlist could not load</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Your profile could not be read, so the shortlist is hidden rather than shown empty.
        </p>
        <Button className="mt-8" size="lg" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-12 md:px-8 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        Saved for later
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Shortlist</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Private to you — saving never notifies the other member. Open a profile to express interest
        when you are ready.
      </p>

      <div className="mt-8">
        {saved.isLoading || me.isLoading ? (
          <div aria-busy="true">
            <span className="sr-only">Loading your shortlist…</span>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="border border-border bg-card p-6">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="mt-3 h-4 w-24" />
                  <Skeleton className="mt-4 h-3 w-full" />
                </li>
              ))}
            </ul>
          </div>
        ) : saved.isError || profiles.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Your shortlist could not be loaded — this is not the same as an empty one.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                void saved.refetch();
                void profiles.refetch();
              }}
              disabled={saved.isFetching || profiles.isFetching}
            >
              Retry
            </button>
          </p>
        ) : !sorted.length ? (
          <div className="border border-dashed border-border p-10 text-center">
            <p className="font-serif text-xl">Nothing saved yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Bookmark a profile to keep it here for later.
            </p>
            <Button asChild className="mt-6">
              <Link to="/members">Search members</Link>
            </Button>
          </div>
        ) : (
          <>
            <p role="status" aria-live="polite" className="mb-4 text-sm text-muted-foreground">
              {sorted.length} saved profile{sorted.length === 1 ? "" : "s"}
            </p>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((p) => (
                <li key={p.id} className="flex h-full flex-col border border-border bg-card p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-serif text-xl font-semibold">
                        {p.full_name.split(" ")[0] || "Member"}
                        {p.birth_year ? `, ${year - p.birth_year}` : ""}
                      </h2>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{p.profession}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-success">
                      <ShieldCheck className="size-4" /> Verified
                    </span>
                  </div>
                  <div className="mt-4 grid flex-1 gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <GraduationCap className="size-3.5" />
                      {p.degree}, {p.institution}
                      {p.grad_year ? ` ’${String(p.grad_year).slice(-2)}` : ""}
                    </span>
                    <span className="flex items-center gap-2">
                      <MapPin className="size-3.5" />
                      {p.city} · {p.relocation}
                    </span>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link to="/members/$id" params={{ id: p.id }}>
                        View profile
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={unsave.isPending}
                      onClick={() => unsave.mutate(p.id)}
                      aria-label={`Remove ${p.full_name} from shortlist`}
                    >
                      <BookmarkX className="size-4" />
                      {unsave.isPending ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
