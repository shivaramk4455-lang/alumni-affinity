import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { GraduationCap, MapPin, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyProfile } from "@/hooks/use-my-profile";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { supabase } from "@/integrations/supabase/client";
import { SEARCH_COLUMNS } from "@/lib/profile-columns";
import {
  DIETS,
  GENDERS,
  INSTITUTIONS,
  MARITAL_STATUSES,
  RELOCATION,
  formatHeight,
} from "@/lib/profile-options";
import {
  EMPTY_PREFERENCES,
  alignCandidate,
  hasAnyPreferences,
  type PartnerPreferences,
} from "@/lib/alignment";

export const Route = createFileRoute("/_authenticated/members")({
  head: () => ({
    meta: [
      { title: "Member search — The Merit Circle" },
      {
        name: "description",
        content: "Search verified members by institution, city, profession and values.",
      },
      { property: "og:title", content: "Member search — The Merit Circle" },
      { property: "og:description", content: "Private search across verified alumni members." },
    ],
  }),
  component: Members,
});

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";
const PAGE_SIZE = 24;
const year = new Date().getFullYear();

function Members() {
  const [q, setQ] = useState("");
  const [inst, setInst] = useState("");
  const [reloc, setReloc] = useState("");
  const [gender, setGender] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [diet, setDiet] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [sort, setSort] = useState<"recent" | "youngest" | "grad" | "match">("recent");
  const [page, setPage] = useState(0);
  const [savedOnly, setSavedOnly] = useState(false);
  const debouncedQ = useDebouncedValue(q);

  const me = useMyProfile();

  // Family co-pilot access check: if the viewer is an active co-pilot for a member,
  // they can browse the directory even if their own profile is unverified.
  const copilotQuery = useQuery({
    queryKey: ["my-copilot-status", me.data?.id],
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilots")
        .select("id, candidate_id, copilot_name, relation")
        .eq("copilot_user_id", me.data!.id)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });
  const isCopilot = (copilotQuery.data?.length ?? 0) > 0;

  // The viewer's own partner preferences (private row; may not exist yet).
  const prefs = useQuery({
    queryKey: ["partner-preferences"],
    enabled: !!me.data,
    queryFn: async (): Promise<Omit<PartnerPreferences, "user_id">> => {
      const { data, error } = await supabase
        .from("partner_preferences")
        .select("min_age, max_age, genders, institutions, cities, relocations, shield_employer")
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ...EMPTY_PREFERENCES };
      return {
        min_age: data.min_age,
        max_age: data.max_age,
        genders: data.genders ?? [],
        institutions: data.institutions ?? [],
        cities: data.cities ?? [],
        relocations: data.relocations ?? [],
        shield_employer: data.shield_employer ?? false,
      };
    },
  });

  const blocked = useQuery({
    queryKey: ["my-reports"],
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("reports").select("reported_profile_id");
      if (error) throw error;
      return (data ?? []).map((r) => r.reported_profile_id);
    },
  });

  const saved = useQuery({
    queryKey: ["saved"],
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("saved_profiles").select("profile_id");
      if (error) throw error;
      return (data ?? []).map((r) => r.profile_id);
    },
  });

  // The directory policy already hides ghosts, the unverified, the not-onboarded
  // and pauses; the reporter's own blocks are excluded client-side below, so
  // rows + count stay in agreement. (Blocks are NOT an RLS clause: filtering
  // them in the policy would corrupt the page count — see migration 20261010.)
  const hidden = blocked.data ?? [];
  const blockedKey = [...hidden].sort().join(",");
  const savedIds = saved.data ?? [];
  const savedKey = [...savedIds].sort().join(",");
  const results = useQuery({
    queryKey: [
      "members",
      debouncedQ,
      inst,
      reloc,
      gender,
      ageBand,
      diet,
      maritalStatus,
      sort,
      page,
      me.data?.id,
      blockedKey,
      savedOnly,
      savedKey,
    ],
    enabled:
      !!me.data &&
      (me.data.verification_status === "verified" || isCopilot) &&
      blocked.isSuccess &&
      (!savedOnly || saved.isSuccess),
    // `signal` is threaded through to PostgREST so superseded searches (fast
    // typing, rapid filter changes) are aborted instead of racing to land.
    queryFn: async ({ signal }) => {
      if (savedOnly && !savedIds.length) return { rows: [], total: 0, hasMore: false };
      let query = supabase
        .from("profiles")
        .select(SEARCH_COLUMNS, { count: "exact" })
        .eq("onboarded", true)
        .eq("is_visible", true)
        .eq("verification_status", "verified")
        .neq("id", me.data!.id);
      if (hidden.length) query = query.filter("id", "not.in", `(${hidden.join(",")})`);
      if (savedOnly) query = query.filter("id", "in", `(${savedIds.join(",")})`);
      if (inst) query = query.eq("institution", inst);
      if (reloc) query = query.eq("relocation", reloc);
      if (gender) query = query.eq("gender", gender);
      if (diet) query = query.eq("diet", diet);
      if (maritalStatus) query = query.eq("marital_status", maritalStatus);
      if (ageBand === "20s")
        query = query.gte("birth_year", year - 29).lte("birth_year", year - 21);
      if (ageBand === "30s")
        query = query.gte("birth_year", year - 39).lte("birth_year", year - 30);
      if (ageBand === "40plus") query = query.lte("birth_year", year - 40);
      if (sort === "youngest") query = query.order("birth_year", { ascending: false });
      else if (sort === "grad") query = query.order("grad_year", { ascending: false });
      else if (sort === "match") {
        // Best match re-orders the same page client-side instead of pushing a
        // 200-row window: scoring runs on directory-visible fields only and
        // the count stays server-authoritative. A larger page keeps the first
        // screen meaningful without changing pagination math.
        query = query.order("updated_at", { ascending: false });
      } else query = query.order("updated_at", { ascending: false });
      const term = debouncedQ
        .trim()
        .replace(/[%,()]/g, "")
        .slice(0, 60);
      if (term)
        query = query.or(
          `full_name.ilike.%${term}%,city.ilike.%${term}%,profession.ilike.%${term}%,degree.ilike.%${term}%`,
        );
      query = query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, error, count } = await query.abortSignal(signal);
      if (error) throw error;
      return {
        rows: data ?? [],
        total: count ?? 0,
        hasMore: (count ?? 0) > (page + 1) * PAGE_SIZE,
      };
    },
  });

  function resetPage() {
    setPage(0);
  }

  if (me.data && !me.data.onboarded && !isCopilot) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">Complete your profile first</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Search opens once your member profile is complete — members only see those who have shared
          the same.
        </p>
        <Button asChild className="mt-8" size="lg">
          <Link to="/onboarding">Start onboarding</Link>
        </Button>
      </main>
    );
  }

  if (me.data && me.data.verification_status !== "verified" && !isCopilot) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">Verification first</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          The directory lists verified members only, and it opens for you once the desk has approved
          your profile. That usually takes under a day.
        </p>
        <Button asChild className="mt-8" size="lg">
          <Link to="/verification">Open verification</Link>
        </Button>
      </main>
    );
  }

  if (me.isError) {
    // `results` is enabled only once the profile loads, so without this branch
    // the grid's skeleton spins forever when the profile read fails.
    return (
      <main className="mx-auto max-w-2xl px-5 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">Search could not open</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          We could not load your member profile, so the directory cannot be filtered for you. This
          is a connection problem, not a missing account.
        </p>
        <Button
          className="mt-8"
          size="lg"
          onClick={() => void me.refetch()}
          disabled={me.isFetching}
        >
          {me.isFetching ? "Retrying…" : "Try again"}
        </Button>
      </main>
    );
  }

  const rows = results.data?.rows ?? [];
  const total = results.data?.total ?? 0;
  const hasMore = (page + 1) * PAGE_SIZE < total;

  const mine = prefs.data ?? EMPTY_PREFERENCES;
  const withAlignment =
    sort === "match"
      ? [...rows]
          .map((p) => ({
            p,
            a: alignCandidate(
              mine,
              { city: me.data?.city ?? null, institution: me.data?.institution ?? null },
              p,
            ),
          }))
          .sort((x, y) => y.a.score - x.a.score)
      : rows.map((p) => ({
          p,
          a: alignCandidate(
            mine,
            { city: me.data?.city ?? null, institution: me.data?.institution ?? null },
            p,
          ),
        }));

  return (
    <main className="mx-auto max-w-7xl px-5 py-12 md:px-8 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        Verified members
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Search the Circle</h1>

      {isCopilot && (
        <aside
          role="note"
          aria-label="Family co-pilot active"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-brass bg-secondary/40 p-4"
        >
          <div className="flex items-center gap-2.5 text-sm">
            <UsersRound className="size-4 shrink-0 text-brass" />
            <span>
              <strong>Browsing as family co-pilot.</strong> You can explore profiles and suggest
              matches to your family member. Introductions and contact details remain strictly
              candidate-led.
            </span>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/copilots">View suggestions</Link>
          </Button>
        </aside>
      )}

      <div className="mt-8 grid gap-3 border border-border bg-card p-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <label className="relative sm:col-span-2">
          <span className="sr-only">Search</span>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Name, city, profession, degree"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
            maxLength={60}
          />
        </label>
        <select
          aria-label="Institution"
          className={selectCls}
          value={inst}
          onChange={(e) => {
            setInst(e.target.value);
            resetPage();
          }}
        >
          <option value="">All institutions</option>
          {INSTITUTIONS.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <select
          aria-label="Relocation"
          className={selectCls}
          value={reloc}
          onChange={(e) => {
            setReloc(e.target.value);
            resetPage();
          }}
        >
          <option value="">Any relocation</option>
          {RELOCATION.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <select
          aria-label="Gender"
          className={selectCls}
          value={gender}
          onChange={(e) => {
            setGender(e.target.value);
            resetPage();
          }}
        >
          <option value="">All genders</option>
          {GENDERS.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <select
          aria-label="Age"
          className={selectCls}
          value={ageBand}
          onChange={(e) => {
            setAgeBand(e.target.value);
            resetPage();
          }}
        >
          <option value="">Any age</option>
          <option value="20s">20s</option>
          <option value="30s">30s</option>
          <option value="40plus">40+</option>
        </select>
        <select
          aria-label="Diet"
          className={selectCls}
          value={diet}
          onChange={(e) => {
            setDiet(e.target.value);
            resetPage();
          }}
        >
          <option value="">All diets</option>
          {DIETS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          aria-label="Marital status"
          className={selectCls}
          value={maritalStatus}
          onChange={(e) => {
            setMaritalStatus(e.target.value);
            resetPage();
          }}
        >
          <option value="">All marital statuses</option>
          {MARITAL_STATUSES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          aria-label="Sort"
          className={selectCls}
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="recent">Recently active</option>
          <option value="youngest">Youngest first</option>
          <option value="grad">Recent graduates</option>
          <option value="match" disabled={prefs.isError}>
            Best match to my criteria
          </option>
        </select>
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
          <input
            type="checkbox"
            className="size-6 accent-[var(--brass)]"
            checked={savedOnly}
            onChange={(e) => {
              setSavedOnly(e.target.checked);
              resetPage();
            }}
          />
          Shortlisted only{savedIds.length ? ` (${savedIds.length})` : ""}
        </label>
      </div>

      {prefs.isError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          Your partner preferences could not be loaded, so “Best match to my criteria” is
          unavailable — results would silently fall back to recency order.{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => void prefs.refetch()}
            disabled={prefs.isFetching}
          >
            {prefs.isFetching ? "Retrying…" : "Retry"}
          </button>
        </p>
      )}

      {prefs.data && hasAnyPreferences(prefs.data) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Alignment badges reflect your own criteria —{" "}
          <Link
            to="/settings"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            edit partner preferences
          </Link>
          .
        </p>
      )}

      <div className="mt-8">
        {results.isFetching && !results.isLoading && (
          <p role="status" aria-live="polite" className="mb-3 text-xs text-muted-foreground">
            Updating results…
          </p>
        )}
        {results.isLoading || me.isLoading ? (
          // Hold the grid's shape while loading: collapsing it to one line of
          // text made every keystroke a full layout jump, and a bare
          // "Searching…" is indistinguishable from a slow failure.
          <div aria-busy="true">
            <span className="sr-only">Searching verified members…</span>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="border border-border bg-card p-6">
                  <div className="flex items-start justify-between gap-3">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="mt-3 h-4 w-24" />
                  <Skeleton className="mt-4 h-3 w-full" />
                  <Skeleton className="mt-2 h-3 w-2/3" />
                </li>
              ))}
            </ul>
          </div>
        ) : results.error ? (
          <p role="alert" className="text-sm text-destructive">
            Search failed. Please try again.
          </p>
        ) : !rows.length ? (
          <div className="border border-dashed border-border p-10 text-center">
            <p className="font-serif text-xl">
              {savedOnly ? "No shortlisted profiles yet" : "No members match yet"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {savedOnly
                ? "Open a profile and choose “Shortlist” to keep it here for later."
                : "Try broader filters. New verified members join every week."}
            </p>
          </div>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {withAlignment.map(({ p, a }) => (
                <li key={p.id}>
                  <Link
                    to="/members/$id"
                    params={{ id: p.id }}
                    className="block h-full border border-border bg-card p-6 transition-colors hover:border-brass hover:shadow-paper"
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/*
                        A small avatar rather than a full-bleed hero: most
                        members set photo visibility to accepted-only or hidden,
                        so a large frame would mostly show "photograph withheld".
                      */}
                      <div className="min-w-0">
                        <h2 className="font-serif text-xl font-semibold">
                          {p.full_name.split(" ")[0] || "Member"}
                          {p.birth_year ? `, ${year - p.birth_year}` : ""}
                        </h2>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {p.profession}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {/* `aria-label` on a role-less <svg> is ignored, so the
                            card's only trust signal was exposed to nobody. */}
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                          <ShieldCheck className="size-4" /> Verified
                        </span>
                        <AvatarPhoto
                          path={p.photo_path}
                          name={p.full_name}
                          visibility={p.photo_visibility}
                        />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <GraduationCap className="size-3.5" />
                        {p.degree}, {p.institution} ’{String(p.grad_year ?? "").slice(-2)}
                      </span>
                      <span className="flex items-center gap-2">
                        <MapPin className="size-3.5" />
                        {p.city} · {p.relocation}
                      </span>
                      {(p.height_cm || p.diet || p.marital_status) && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {[
                            formatHeight(p.height_cm),
                            p.diet,
                            p.marital_status && p.marital_status !== "Never married"
                              ? p.marital_status
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                    {a.badges.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {a.badges.slice(0, 3).map((b) => (
                          <span
                            key={b.label}
                            // The detail was reachable only via a hover title,
                            // which keyboard and touch users cannot open.
                            aria-label={`${b.label}: ${b.detail}`}
                            className="border border-brass/50 bg-brass/5 px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-brass-strong"
                          >
                            {b.label}
                          </span>
                        ))}
                        {/* Silently dropping badge 4+ left the member unable to
                            tell truncation apart from a weak match. */}
                        {a.badges.length > 3 && (
                          <span className="px-1 py-0.5 text-xs font-semibold text-muted-foreground">
                            +{a.badges.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center justify-center gap-4">
              {page > 0 && (
                <Button variant="outline" onClick={() => setPage((v) => Math.max(0, v - 1))}>
                  Previous
                </Button>
              )}
              <span
                // Search and filters are silent for a screen-reader user
                // without this: typing produces no announced change.
                role="status"
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                Page {page + 1}
                {total ? ` · ${total} member${total === 1 ? "" : "s"}` : ""}
              </span>
              {hasMore && (
                <Button variant="outline" onClick={() => setPage((v) => v + 1)}>
                  Next
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/**
 * Small round thumbnail for a search card.
 *
 * Deliberately not `MemberPhoto`: that component renders a large "photograph
 * withheld" panel when the signed URL cannot be read, and most members keep
 * photo visibility at accepted-only or hidden. Fetching one signed URL per
 * card is also why this checks `photo_visibility` first and degrades to
 * initials, rather than issuing a request storage RLS would refuse.
 */
function AvatarPhoto({
  path,
  name,
  visibility,
}: {
  path?: string | null;
  name: string;
  visibility?: string | null;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  // "hidden" can never resolve, and accepted-only resolves only once an
  // introduction exists — which the desk has already filtered us away from.
  const withheld = !path || visibility === "hidden" || visibility === "accepted_only";

  const { data } = useQuery({
    queryKey: ["search-photo", path],
    enabled: !!path && !withheld,
    staleTime: 4 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("profile-photos")
        .createSignedUrl(path!, 300);
      if (error) return null;
      return data.signedUrl;
    },
  });

  if (withheld || !data) {
    return (
      <span
        aria-hidden="true"
        title={path ? "Photograph withheld until an introduction is accepted" : undefined}
        className="grid size-14 shrink-0 place-items-center rounded-full border border-border bg-secondary/60 text-xs font-semibold text-muted-foreground"
      >
        {initials || <UserRound className="size-5" />}
      </span>
    );
  }

  return (
    <img
      src={data}
      // Decorative: the member's name is already the card's heading, so an
      // alt here would just repeat it on every card.
      alt=""
      draggable={false}
      className="size-14 shrink-0 rounded-full border border-border object-cover"
    />
  );
}
