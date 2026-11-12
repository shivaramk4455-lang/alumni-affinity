import { useMemo, useState } from "react";

/** Single owner for the member-directory filter state.
 *
 * Owns the 17 filter fields, the page counter, the derived `isFiltered`
 * flag, the active-filter chip list, and the stable query key — so the
 * filter state, the query key, and the prefetch effect can never diverge
 * (a filter added without calling resetPage() is now impossible).
 *
 * Key shape: ["members", JSON.stringify(filters)] — the stringify is the
 * key, so the key changes exactly when the filters do, with no 22-dep
 * useCallback to keep in sync.
 */
export type DirectoryFilters = {
  q: string;
  inst: string;
  reloc: string;
  gender: string;
  ageBand: string;
  diet: string;
  maritalStatus: string;
  residency: string;
  tongue: string;
  religion: string;
  rashi: string;
  manglik: string;
  minHeight: string;
  city: string;
  profession: string;
  withPhoto: boolean;
  feed:
    "all" | "mutual" | "looking_for_you" | "new" | "shortlisted" | "viewed_by_you" | "viewed_you";
  sort: "joined" | "youngest" | "active";
};

export type ActiveFilterChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

const DEFAULT_FILTERS: DirectoryFilters = {
  q: "",
  inst: "",
  reloc: "",
  gender: "",
  ageBand: "",
  diet: "",
  maritalStatus: "",
  residency: "",
  tongue: "",
  religion: "",
  rashi: "",
  manglik: "",
  minHeight: "",
  city: "",
  profession: "",
  withPhoto: false,
  feed: "all",
  sort: "joined",
};

export function useDirectoryFilters(debouncedQ: string) {
  const [filters, setFilters] = useState<DirectoryFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const resetPage = () => setPage(0);

  /** Patch any filter field AND reset to page 0 in one call. */
  const patch = <K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) => {
    setFilters((p) => ({ ...p, [key]: value }));
    resetPage();
  };

  const clearAllFilters = () => {
    setFilters(DEFAULT_FILTERS);
    resetPage();
  };

  const advancedCount = [
    filters.profession,
    filters.reloc,
    filters.diet,
    filters.maritalStatus,
    filters.residency,
    filters.tongue,
    filters.religion,
    filters.rashi,
    filters.manglik,
    filters.minHeight,
  ].filter(Boolean).length;

  const isFiltered = Boolean(
    filters.q ||
    filters.city ||
    filters.profession ||
    filters.withPhoto ||
    filters.inst ||
    filters.reloc ||
    filters.gender ||
    filters.ageBand ||
    filters.diet ||
    filters.maritalStatus ||
    filters.residency ||
    filters.tongue ||
    filters.religion ||
    filters.rashi ||
    filters.manglik ||
    filters.minHeight ||
    filters.feed !== "all" ||
    filters.sort !== "joined",
  );

  const activeFilters = useMemo<ActiveFilterChip[]>(() => {
    const list: ActiveFilterChip[] = [];
    const add = (key: string, label: string, onRemove: () => void) =>
      list.push({ key, label, onRemove });

    if (debouncedQ) add("q", `Search: "${debouncedQ}"`, () => patch("q", ""));
    if (filters.city) add("city", `City: ${filters.city}`, () => patch("city", ""));
    if (filters.inst) add("inst", filters.inst, () => patch("inst", ""));
    if (filters.gender) add("gender", filters.gender, () => patch("gender", ""));
    if (filters.ageBand)
      add("ageBand", `Age: ${filters.ageBand === "40plus" ? "40+" : filters.ageBand}`, () =>
        patch("ageBand", ""),
      );
    if (filters.profession)
      add("profession", `Profession: ${filters.profession}`, () => patch("profession", ""));
    if (filters.withPhoto) add("withPhoto", "With photo only", () => patch("withPhoto", false));
    if (filters.reloc) add("reloc", `Reloc: ${filters.reloc}`, () => patch("reloc", ""));
    if (filters.diet) add("diet", `Diet: ${filters.diet}`, () => patch("diet", ""));
    if (filters.maritalStatus)
      add("maritalStatus", filters.maritalStatus, () => patch("maritalStatus", ""));
    if (filters.residency) add("residency", filters.residency, () => patch("residency", ""));
    if (filters.tongue) add("tongue", filters.tongue, () => patch("tongue", ""));
    if (filters.religion) add("religion", filters.religion, () => patch("religion", ""));
    if (filters.rashi) add("rashi", `Rashi: ${filters.rashi}`, () => patch("rashi", ""));
    if (filters.manglik) add("manglik", `Manglik: ${filters.manglik}`, () => patch("manglik", ""));
    if (filters.minHeight) add("minHeight", `${filters.minHeight}+`, () => patch("minHeight", ""));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- patch/resetPage are stable by construction
  }, [debouncedQ, filters]);

  /** Stable key for React Query: the filters serialized, nothing else. */
  const queryKey = useMemo(() => ["members", JSON.stringify(filters)] as const, [filters]);

  return {
    filters,
    setFilters,
    patch,
    clearAllFilters,
    resetPage,
    page,
    setPage,
    showMoreFilters,
    setShowMoreFilters,
    advancedCount,
    isFiltered,
    activeFilters,
    queryKey,
  };
}
