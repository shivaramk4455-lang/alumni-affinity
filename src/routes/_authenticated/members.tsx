import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, UsersRound, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MemberCard } from "@/components/directory/member-card";
import { useMyProfile } from "@/hooks/use-my-profile";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDismissedIds } from "@/lib/dismissals";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { SEARCH_COLUMNS, type SearchResultRow } from "@/lib/profile-columns";
import {
  DIETS,
  GENDERS,
  INSTITUTIONS,
  INSTITUTION_GROUPS,
  MANGALIK_OPTIONS,
  MARITAL_STATUSES,
  MOTHER_TONGUES,
  RASHIS,
  RELIGIONS,
  RELOCATION,
  RESIDENCY_STATUSES,
  formatHeight,
} from "@/lib/profile-options";
import { cn } from "@/lib/utils";
import { alignCandidate, EMPTY_PREFERENCES, type Alignment } from "@/lib/alignment";

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
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Members,
});

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";
const PAGE_SIZE = 24;
const year = new Date().getFullYear();

interface RunMemberDirectoryQueryParams {
  pageNumber: number;
  city: string;
  profession: string;
  withPhoto: boolean;
  feed: string;
  sort: string;
  institution: string;
  relocation: string;
  gender: string;
  diet: string;
  maritalStatus: string;
  residency: string;
  tongue: string;
  religion: string;
  rashi: string;
  manglik: string;
  minHeight: string;
  ageBand: string;
  debouncedQ: string;
  signal?: AbortSignal;
}

async function runCopilotDirectoryQuery(params: RunMemberDirectoryQueryParams) {
  const ageBounds =
    params.ageBand === "20s"
      ? { min: year - 29, max: year - 21 }
      : params.ageBand === "30s"
        ? { min: year - 39, max: year - 30 }
        : params.ageBand === "40plus"
          ? { min: undefined, max: year - 40 }
          : { min: undefined, max: undefined };
  let query = supabase
    .from("profiles")
    .select(SEARCH_COLUMNS, { count: "exact" })
    .eq("onboarded", true)
    .eq("is_visible", true)
    .eq("verification_status", "verified");
  if (params.city) query = query.eq("city", params.city);
  if (params.institution) query = query.eq("institution", params.institution);
  if (params.relocation) query = query.eq("relocation", params.relocation);
  if (params.gender) query = query.eq("gender", params.gender);
  if (params.diet) query = query.eq("diet", params.diet);
  if (params.maritalStatus) query = query.eq("marital_status", params.maritalStatus);
  if (params.residency) query = query.eq("residency_status", params.residency);
  if (params.tongue) query = query.eq("mother_tongue", params.tongue);
  if (params.religion) query = query.eq("religion", params.religion);
  if (params.rashi) query = query.eq("rashi", params.rashi);
  if (params.manglik) query = query.eq("manglik", params.manglik);
  if (params.profession) query = query.ilike("profession", `%${params.profession}%`);
  if (params.withPhoto) query = query.not("photo_path", "is", null);
  if (params.minHeight) query = query.gte("height_cm", Number(params.minHeight));
  if (ageBounds.min) query = query.gte("birth_year", ageBounds.min);
  if (ageBounds.max) query = query.lte("birth_year", ageBounds.max);
  const term = params.debouncedQ
    .trim()
    .replace(/[%,()]/g, "")
    .slice(0, 60);
  if (term)
    query = query.or(
      `full_name.ilike.%${term}%,city.ilike.%${term}%,profession.ilike.%${term}%,degree.ilike.%${term}%`,
    );
  if (params.sort === "youngest") query = query.order("birth_year", { ascending: false });
  else query = query.order("created_at", { ascending: false });
  query = query.range(params.pageNumber * PAGE_SIZE, params.pageNumber * PAGE_SIZE + PAGE_SIZE - 1);
  const response = params.signal ? await query.abortSignal(params.signal) : await query;
  if (response.error) throw response.error;
  return {
    rows: (response.data ?? []) as SearchResultRow[],
    total: response.count ?? 0,
    hasMore: (response.count ?? 0) > (params.pageNumber + 1) * PAGE_SIZE,
  };
}

async function runMemberDirectoryQuery(params: RunMemberDirectoryQueryParams) {
  const {
    pageNumber,
    city,
    profession,
    withPhoto,
    feed,
    sort,
    institution,
    relocation,
    gender,
    diet,
    maritalStatus,
    residency,
    tongue,
    religion,
    rashi,
    manglik,
    minHeight,
    ageBand,
    debouncedQ,
    signal,
  } = params;
  const ageBounds =
    ageBand === "20s"
      ? { min: year - 29, max: year - 21 }
      : ageBand === "30s"
        ? { min: year - 39, max: year - 30 }
        : ageBand === "40plus"
          ? { min: undefined, max: year - 40 }
          : { min: undefined, max: undefined };
  const result = supabase.rpc("discover_members", {
    _feed: feed,
    _page: pageNumber,
    _page_size: PAGE_SIZE,
    _city: city || null,
    _profession: profession || null,
    _with_photo: withPhoto,
    _sort: sort,
    _institution: institution || null,
    _relocation: relocation || null,
    _gender: gender || null,
    _diet: diet || null,
    _marital_status: maritalStatus || null,
    _residency: residency || null,
    _mother_tongue: tongue || null,
    _religion: religion || null,
    _rashi: rashi || null,
    _manglik: manglik || null,
    _min_height: minHeight ? Number(minHeight) : null,
    _min_birth_year: ageBounds.min ?? null,
    _max_birth_year: ageBounds.max ?? null,
    _search: debouncedQ.trim() || null,
  });
  const { data, error } = signal ? await result.abortSignal(signal) : await result;
  if (error) throw error;
  const rows = (data ?? []).map(({ total_count: _total, ...row }) => row) as SearchResultRow[];
  const total = data?.[0]?.total_count ?? 0;
  return { rows, total, hasMore: total > (pageNumber + 1) * PAGE_SIZE };
}

function Members() {
  const matchRoute = useMatchRoute();
  /**
   * `/members/$id` is a CHILD of this route in the file-based tree, so this
   * component is its parent and must hand rendering over to it. Without this,
   * opening a profile showed the search list under a "Member profile" title:
   * the child's head() applied, but its component was never mounted.
   */
  const onProfilePage = !!matchRoute({ to: "/members/$id" });
  const [q, setQ] = useState("");
  const [inst, setInst] = useState("");
  const [reloc, setReloc] = useState("");
  const [gender, setGender] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [diet, setDiet] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [residency, setResidency] = useState("");
  const [tongue, setTongue] = useState("");
  const [religion, setReligion] = useState("");
  const [rashi, setRashi] = useState("");
  const [manglik, setManglik] = useState("");
  const [minHeight, setMinHeight] = useState("");
  const [city, setCity] = useState("");
  const [profession, setProfession] = useState("");
  const [withPhoto, setWithPhoto] = useState(false);
  const [feed, setFeed] = useState<
    "all" | "mutual" | "looking_for_you" | "new" | "shortlisted" | "viewed_by_you" | "viewed_you"
  >("all");
  const [sort, setSort] = useState<"joined" | "youngest" | "active">("joined");
  const [page, setPage] = useState(0);
  const debouncedQ = useDebouncedValue(q);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const advancedCount = [
    profession,
    reloc,
    diet,
    maritalStatus,
    residency,
    tongue,
    religion,
    rashi,
    manglik,
    minHeight,
  ].filter(Boolean).length;

  const isFiltered = Boolean(
    q ||
    city ||
    profession ||
    withPhoto ||
    inst ||
    reloc ||
    gender ||
    ageBand ||
    diet ||
    maritalStatus ||
    residency ||
    tongue ||
    religion ||
    rashi ||
    manglik ||
    minHeight ||
    feed !== "all" ||
    sort !== "joined",
  );

  function clearAllFilters() {
    setQ("");
    setCity("");
    setProfession("");
    setWithPhoto(false);
    setInst("");
    setReloc("");
    setGender("");
    setAgeBand("");
    setDiet("");
    setMaritalStatus("");
    setResidency("");
    setTongue("");
    setReligion("");
    setRashi("");
    setManglik("");
    setMinHeight("");
    setFeed("all");
    setSort("joined");
    resetPage();
  }

  const activeFilters = useMemo(() => {
    const list: { key: string; label: string; onRemove: () => void }[] = [];
    if (debouncedQ)
      list.push({
        key: "q",
        label: `Search: "${debouncedQ}"`,
        onRemove: () => {
          setQ("");
          resetPage();
        },
      });
    if (city)
      list.push({
        key: "city",
        label: `City: ${city}`,
        onRemove: () => {
          setCity("");
          resetPage();
        },
      });
    if (inst)
      list.push({
        key: "inst",
        label: inst,
        onRemove: () => {
          setInst("");
          resetPage();
        },
      });
    if (gender)
      list.push({
        key: "gender",
        label: gender,
        onRemove: () => {
          setGender("");
          resetPage();
        },
      });
    if (ageBand)
      list.push({
        key: "ageBand",
        label: `Age: ${ageBand === "40plus" ? "40+" : ageBand}`,
        onRemove: () => {
          setAgeBand("");
          resetPage();
        },
      });
    if (profession)
      list.push({
        key: "profession",
        label: `Profession: ${profession}`,
        onRemove: () => {
          setProfession("");
          resetPage();
        },
      });
    if (withPhoto)
      list.push({
        key: "withPhoto",
        label: "With photo only",
        onRemove: () => {
          setWithPhoto(false);
          resetPage();
        },
      });
    if (reloc)
      list.push({
        key: "reloc",
        label: `Reloc: ${reloc}`,
        onRemove: () => {
          setReloc("");
          resetPage();
        },
      });
    if (diet)
      list.push({
        key: "diet",
        label: `Diet: ${diet}`,
        onRemove: () => {
          setDiet("");
          resetPage();
        },
      });
    if (maritalStatus)
      list.push({
        key: "maritalStatus",
        label: maritalStatus,
        onRemove: () => {
          setMaritalStatus("");
          resetPage();
        },
      });
    if (residency)
      list.push({
        key: "residency",
        label: residency,
        onRemove: () => {
          setResidency("");
          resetPage();
        },
      });
    if (tongue)
      list.push({
        key: "tongue",
        label: tongue,
        onRemove: () => {
          setTongue("");
          resetPage();
        },
      });
    if (religion)
      list.push({
        key: "religion",
        label: religion,
        onRemove: () => {
          setReligion("");
          resetPage();
        },
      });
    if (rashi)
      list.push({
        key: "rashi",
        label: `Rashi: ${rashi}`,
        onRemove: () => {
          setRashi("");
          resetPage();
        },
      });
    if (manglik)
      list.push({
        key: "manglik",
        label: `Manglik: ${manglik}`,
        onRemove: () => {
          setManglik("");
          resetPage();
        },
      });
    if (minHeight)
      list.push({
        key: "minHeight",
        label: `${formatHeight(Number(minHeight))}+`,
        onRemove: () => {
          setMinHeight("");
          resetPage();
        },
      });
    return list;
  }, [
    debouncedQ,
    city,
    inst,
    gender,
    ageBand,
    profession,
    withPhoto,
    reloc,
    diet,
    maritalStatus,
    residency,
    tongue,
    religion,
    rashi,
    manglik,
    minHeight,
  ]);

  const me = useMyProfile();
  const queryClient = useQueryClient();

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

  const activityTracking = useQuery({
    queryKey: ["activity-tracking", me.data?.id],
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("member_activity")
        .select("enabled")
        .maybeSingle();
      if (error) throw error;
      return data?.enabled ?? false;
    },
  });

  const blocked = useQuery({
    queryKey: ["my-reports"],
    enabled: !!me.data,
    queryFn: async () => {
      // Bounded: RLS scopes this to the member's own reports, but the set
      // grows over a lifetime and this query runs on every directory load.
      const { data, error } = await supabase
        .from("reports")
        .select("reported_profile_id")
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => r.reported_profile_id);
    },
  });

  // "Not for me" profiles. Deliberately not part of `enabled` below: a failed
  // dismissal read would otherwise block the directory entirely, which trades
  // search availability for a filter that can be wrong only in a transient way.
  const dismissed = useDismissedIds(!!me.data);

  const hidden = useMemo(
    () => [...new Set([...(blocked.data ?? []), ...(dismissed.data ?? [])])],
    [blocked.data, dismissed.data],
  );
  const blockedKey = useMemo(() => [...hidden].sort().join(","), [hidden]);
  const canUseVisitorFeed = me.data?.show_profile_views === true;
  const buildMembersQueryKey = useCallback(
    (targetPage: number) =>
      [
        "members",
        feed,
        targetPage,
        city,
        profession,
        withPhoto,
        inst,
        reloc,
        gender,
        ageBand,
        diet,
        maritalStatus,
        residency,
        tongue,
        religion,
        rashi,
        manglik,
        minHeight,
        debouncedQ,
        sort,
        me.data?.id,
        blockedKey,
        canUseVisitorFeed,
        isCopilot,
      ] as const,
    [
      feed,
      city,
      profession,
      withPhoto,
      inst,
      reloc,
      gender,
      ageBand,
      diet,
      maritalStatus,
      residency,
      tongue,
      religion,
      rashi,
      manglik,
      minHeight,
      debouncedQ,
      sort,
      me.data?.id,
      blockedKey,
      canUseVisitorFeed,
      isCopilot,
    ],
  );

  const results = useQuery({
    queryKey: buildMembersQueryKey(page),
    enabled:
      !onProfilePage &&
      !!me.data &&
      (me.data.verification_status === "verified" || (isCopilot && feed === "all")) &&
      blocked.isSuccess &&
      (feed !== "viewed_you" || canUseVisitorFeed),
    queryFn: async ({ signal }) => {
      const params: RunMemberDirectoryQueryParams = {
        pageNumber: page,
        city,
        profession,
        withPhoto,
        feed,
        sort,
        institution: inst,
        relocation: reloc,
        gender,
        diet,
        maritalStatus,
        residency,
        tongue,
        religion,
        rashi,
        manglik,
        minHeight,
        ageBand,
        debouncedQ,
        signal,
      };
      return isCopilot && me.data?.verification_status !== "verified"
        ? runCopilotDirectoryQuery(params)
        : runMemberDirectoryQuery(params);
    },
  });

  const myPrefs = useQuery({
    queryKey: ["partner-preferences"],
    enabled: !onProfilePage && !!me.data && me.data.verification_status === "verified",
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("partner_preferences")
        .select(
          "min_age, max_age, min_height_cm, max_height_cm, genders, marital_statuses, diets, religions, caste_preference, manglik_preference, institutions, cities, relocations, shield_employer",
        )
        .maybeSingle();
      if (error || !row) return { ...EMPTY_PREFERENCES };
      return {
        min_age: row.min_age,
        max_age: row.max_age,
        min_height_cm: row.min_height_cm,
        max_height_cm: row.max_height_cm,
        genders: row.genders ?? [],
        marital_statuses: row.marital_statuses ?? [],
        diets: row.diets ?? [],
        religions: row.religions ?? [],
        caste_preference: row.caste_preference ?? null,
        manglik_preference: row.manglik_preference ?? null,
        institutions: row.institutions ?? [],
        cities: row.cities ?? [],
        relocations: row.relocations ?? [],
        shield_employer: row.shield_employer ?? false,
      };
    },
  });

  // discover_members already computes mutual_match, matches_their_preferences,
  // matches_your_preferences, and activity_bucket server-side on every row.
  // Only fall back to directory_match_signals if rows came without those fields.
  const rowsLackSignals =
    (results.data?.rows.length ?? 0) > 0 && results.data?.rows[0]?.mutual_match === undefined;

  const matchSignalsQuery = useQuery({
    queryKey: [
      "directory-match-signals",
      me.data?.id,
      results.data?.rows.map((row) => row.id).join(","),
    ],
    enabled: !!me.data && me.data.verification_status === "verified" && rowsLackSignals,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("directory_match_signals", {
        _candidate_ids: (results.data?.rows ?? []).map((row) => row.id),
      });
      if (error) throw error;
      type MatchSignal =
        Database["public"]["Functions"]["directory_match_signals"]["Returns"][number];
      return new Map<string, MatchSignal>(
        ((data ?? []) as MatchSignal[]).map((signal) => [signal.candidate_id, signal]),
      );
    },
  });

  // Professional prefetching: warm up the next page in cache using the exact same queryKey
  useEffect(() => {
    if (!results.data?.hasMore || onProfilePage) return;
    const nextPage = page + 1;
    void queryClient.prefetchQuery({
      queryKey: buildMembersQueryKey(nextPage),
      staleTime: 60_000,
      queryFn: async () => {
        const params: RunMemberDirectoryQueryParams = {
          pageNumber: nextPage,
          city,
          profession,
          withPhoto,
          feed,
          sort,
          institution: inst,
          relocation: reloc,
          gender,
          diet,
          maritalStatus,
          residency,
          tongue,
          religion,
          rashi,
          manglik,
          minHeight,
          ageBand,
          debouncedQ,
        };
        return isCopilot && me.data?.verification_status !== "verified"
          ? runCopilotDirectoryQuery(params)
          : runMemberDirectoryQuery(params);
      },
    });
  }, [
    results.data?.hasMore,
    page,
    debouncedQ,
    inst,
    reloc,
    gender,
    ageBand,
    diet,
    maritalStatus,
    residency,
    tongue,
    religion,
    rashi,
    manglik,
    minHeight,
    sort,
    city,
    profession,
    withPhoto,
    feed,
    // The primitive, not the row object. Depending on `me.data` meant that
    // every invalidation of the profile query produced a new object identity,
    // which re-ran this effect and re-issued the next-page prefetch even
    // though no page or filter input had changed.
    me.data?.verification_status,
    blockedKey,
    canUseVisitorFeed,
    isCopilot,
    onProfilePage,
    queryClient,
    buildMembersQueryKey,
  ]);

  function resetPage() {
    setPage(0);
  }

  // The profile route is this route's child: render it, don't draw the search
  // screen around it. Checked after every hook above so hook order is stable.
  if (onProfilePage) return <Outlet />;

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
  const withAlignment = rows.map((p) => {
    const sig = matchSignalsQuery.data?.get(p.id);
    const mutual = p.mutual_match ?? sig?.mutual_match ?? false;
    const theyFit = p.matches_their_preferences ?? sig?.matches_their_preferences ?? false;
    const bucket = p.activity_bucket ?? sig?.activity_bucket ?? null;
    const localAlign = me.data
      ? alignCandidate(
          myPrefs.data ?? EMPTY_PREFERENCES,
          { city: me.data.city ?? null, institution: me.data.institution ?? null },
          p,
        )
      : { score: 0, badges: [], reasons: [] };

    return {
      p,
      a: {
        score: localAlign.score,
        reasons: localAlign.reasons,
        badges: [
          ...(mutual
            ? [{ label: "Mutual match", detail: "Your stated preferences align both ways" }]
            : []),
          ...(theyFit && !mutual
            ? [{ label: "Looking for you", detail: "You match their stated preferences" }]
            : []),
          ...(bucket === "recently"
            ? [{ label: "Active recently", detail: "Activity sharing is enabled" }]
            : bucket === "this_week"
              ? [{ label: "Active this week", detail: "Activity sharing is enabled" }]
              : []),
          ...localAlign.badges,
        ],
      } satisfies Alignment,
    };
  });

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

      <div className="mt-8 border border-border bg-card p-4 shadow-paper">
        {/* Quick Alumni Cluster Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
            Alumni Cluster:
          </span>
          <button
            type="button"
            onClick={() => {
              if (inst || q === "IIT" || q === "IIM") {
                setInst("");
                if (q === "IIT" || q === "IIM") setQ("");
                resetPage();
              }
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
              !inst && q !== "IIT" && q !== "IIM"
                ? "border-brass bg-brass/10 font-semibold text-brass-strong"
                : "border-border bg-background text-muted-foreground hover:bg-secondary/40",
            )}
          >
            All Institutions
          </button>
          <button
            type="button"
            onClick={() => {
              setInst("");
              setQ("IIT");
              resetPage();
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
              q === "IIT"
                ? "border-brass bg-brass/10 font-semibold text-brass-strong"
                : "border-border bg-background text-muted-foreground hover:bg-secondary/40",
            )}
          >
            All IITs
          </button>
          <button
            type="button"
            onClick={() => {
              setInst("");
              setQ("IIM");
              resetPage();
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
              q === "IIM"
                ? "border-brass bg-brass/10 font-semibold text-brass-strong"
                : "border-border bg-background text-muted-foreground hover:bg-secondary/40",
            )}
          >
            All IIMs
          </button>
          <button
            type="button"
            onClick={() => {
              if (q === "IIT" || q === "IIM") setQ("");
              setInst("BITS Pilani");
              resetPage();
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
              inst === "BITS Pilani"
                ? "border-brass bg-brass/10 font-semibold text-brass-strong"
                : "border-border bg-background text-muted-foreground hover:bg-secondary/40",
            )}
          >
            BITS Pilani
          </button>
          <button
            type="button"
            onClick={() => {
              if (q === "IIT" || q === "IIM") setQ("");
              setInst("ISB (Indian School of Business)");
              resetPage();
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
              inst === "ISB (Indian School of Business)"
                ? "border-brass bg-brass/10 font-semibold text-brass-strong"
                : "border-border bg-background text-muted-foreground hover:bg-secondary/40",
            )}
          >
            ISB
          </button>
        </div>

        {/* Row 1: Search keyword, Feed selection, and Sort order */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative sm:col-span-2">
            <span className="sr-only">Search</span>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name, city, profession, degree"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                resetPage();
              }}
              maxLength={60}
            />
          </label>
          <select
            aria-label="Discovery feed"
            className={selectCls}
            value={feed}
            onChange={(event) => {
              setFeed(event.target.value as typeof feed);
              resetPage();
            }}
          >
            <option value="all">All verified members</option>
            <option
              value="mutual"
              disabled={isCopilot && me.data?.verification_status !== "verified"}
            >
              Mutual matches
            </option>
            <option
              value="looking_for_you"
              disabled={isCopilot && me.data?.verification_status !== "verified"}
            >
              Looking for you
            </option>
            <option value="new">Recently joined (last 30 days)</option>
            <option
              value="shortlisted"
              disabled={isCopilot && me.data?.verification_status !== "verified"}
            >
              Shortlisted by you
            </option>
            <option
              value="viewed_by_you"
              disabled={isCopilot && me.data?.verification_status !== "verified"}
            >
              Viewed by you
            </option>
            <option
              value="viewed_you"
              disabled={
                !canUseVisitorFeed || (isCopilot && me.data?.verification_status !== "verified")
              }
            >
              Viewed you (opt-in)
            </option>
          </select>
          <select
            aria-label="Sort"
            className={selectCls}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as typeof sort);
              resetPage();
            }}
          >
            <option value="joined">Sort: Recently joined</option>
            <option value="youngest">Sort: Youngest first</option>
            <option value="active" disabled={!activityTracking.data}>
              Sort: Recently active (opt-in)
            </option>
          </select>
        </div>

        {/* Row 2: Core discovery filters and progressive disclosure toggle */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 items-center">
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
            {INSTITUTION_GROUPS.map((group) => (
              <optgroup key={group.category} label={group.category}>
                {group.options.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </optgroup>
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

          <Input
            placeholder="Filter by city"
            value={city}
            maxLength={80}
            onChange={(event) => {
              setCity(event.target.value);
              resetPage();
            }}
          />

          <div className="flex items-center justify-between gap-2 sm:col-span-2 md:col-span-4 lg:col-span-1">
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brass)]"
                checked={withPhoto}
                onChange={(event) => {
                  setWithPhoto(event.target.checked);
                  resetPage();
                }}
              />
              With photo
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowMoreFilters((v) => !v)}
              className="text-xs font-semibold gap-1.5 h-9 px-2.5"
              aria-expanded={showMoreFilters}
            >
              <SlidersHorizontal className="size-3.5" />
              {showMoreFilters ? "Fewer" : "More"}
              {advancedCount > 0 && (
                <span className="size-4 rounded-full bg-brass text-brass-foreground text-[10px] font-bold grid place-items-center">
                  {advancedCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Collapsible secondary filters */}
        {showMoreFilters && (
          <div className="mt-4 border-t border-border/70 pt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <Input
              placeholder="Profession keyword"
              value={profession}
              maxLength={80}
              onChange={(event) => {
                setProfession(event.target.value);
                resetPage();
              }}
            />
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
              aria-label="Residency"
              className={selectCls}
              value={residency}
              onChange={(e) => {
                setResidency(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any residency</option>
              {RESIDENCY_STATUSES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select
              aria-label="Mother tongue"
              className={selectCls}
              value={tongue}
              onChange={(e) => {
                setTongue(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any mother tongue</option>
              {MOTHER_TONGUES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select
              aria-label="Religion"
              className={selectCls}
              value={religion}
              onChange={(e) => {
                setReligion(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any religion</option>
              {RELIGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              aria-label="Minimum height"
              className={selectCls}
              value={minHeight}
              onChange={(e) => {
                setMinHeight(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any height</option>
              {[150, 155, 160, 165, 170, 175, 180, 185].map((h) => (
                <option key={h} value={h}>
                  {formatHeight(h)} +
                </option>
              ))}
            </select>
            <select
              aria-label="Moon sign (Rashi)"
              className={selectCls}
              value={rashi}
              onChange={(e) => {
                setRashi(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any rashi</option>
              {RASHIS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              aria-label="Manglik"
              className={selectCls}
              value={manglik}
              onChange={(e) => {
                setManglik(e.target.value);
                resetPage();
              }}
            >
              <option value="">Any manglik status</option>
              {MANGALIK_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2.5">
            <span className="text-xs text-muted-foreground mr-1">Active filters:</span>
            {activeFilters.map((f) => (
              <span
                key={f.key}
                className="inline-flex items-center gap-1 border border-border bg-secondary/50 px-2 py-0.5 text-xs text-foreground"
              >
                <span>{f.label}</span>
                <button
                  type="button"
                  onClick={f.onRemove}
                  className="text-muted-foreground hover:text-foreground focus-visible:outline-none"
                  aria-label={`Remove filter ${f.label}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={clearAllFilters}
              className="ml-auto text-xs font-semibold text-brass-strong hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Mutual matches meet both members’ stated preferences. Activity labels are broad and opt-in;
        shortlists stay private.
      </p>

      {feed === "viewed_you" && !canUseVisitorFeed && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Enable both Show visitors and Coarse activity sharing in Settings to see this private
          feed. Visitor names and exact activity times remain hidden unless those controls are
          enabled.
        </p>
      )}
      {matchSignalsQuery.isError && rows.length > 0 && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Match signals could not be loaded. Profiles are still searchable; match badges are hidden.
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
              {feed === "shortlisted"
                ? "No shortlisted profiles yet"
                : feed === "mutual"
                  ? "No mutual matches yet"
                  : feed === "viewed_you"
                    ? "No opted-in profile visits yet"
                    : "No members match your criteria"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {feed === "shortlisted"
                ? "Shortlists are private and visible only to you."
                : feed === "mutual"
                  ? "Mutual matches require both members to meet each other's stated preferences."
                  : feed === "viewed_you"
                    ? "Members who visited your profile will appear here once visitors opt in."
                    : "Try broadening your filters or resetting search parameters."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {isFiltered && (
                <Button variant="default" size="sm" onClick={clearAllFilters}>
                  Clear all filters
                </Button>
              )}
              {feed !== "all" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFeed("all");
                    resetPage();
                  }}
                >
                  Browse all verified members
                </Button>
              )}
              {feed === "mutual" && (
                <Button asChild variant="outline" size="sm">
                  <Link to="/settings">Update partner preferences</Link>
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {withAlignment.map(({ p, a }) => (
                <MemberCard key={p.id} member={p} alignment={a} />
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
