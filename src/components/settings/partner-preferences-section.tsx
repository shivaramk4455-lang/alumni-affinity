import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { EMPTY_PREFERENCES, hasAnyPreferences } from "@/lib/alignment";
import { recordConsent } from "@/lib/consent";
import {
  CASTES,
  DIETS,
  GENDERS,
  HEIGHT_OPTIONS,
  INSTITUTIONS,
  MANGALIK_OPTIONS,
  MARITAL_STATUSES,
  RELIGIONS,
  RELOCATION,
} from "@/lib/profile-options";

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";

const CONSENT_RECEIPT_WARNING =
  "Saved, but the consent receipt could not be written — retry from Settings.";

interface PartnerPreferencesSectionProps {
  employer?: string | null | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

export function PartnerPreferencesSection({
  employer,
  onDirtyChange,
}: PartnerPreferencesSectionProps) {
  const qc = useQueryClient();
  const [clearOpen, setClearOpen] = useState(false);
  const [prefSeeded, setPrefSeeded] = useState(false);

  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [minHeight, setMinHeight] = useState("");
  const [maxHeight, setMaxHeight] = useState("");
  const [prefGenders, setPrefGenders] = useState<string[]>([]);
  const [prefMaritalStatuses, setPrefMaritalStatuses] = useState<string[]>([]);
  const [prefDiets, setPrefDiets] = useState<string[]>([]);
  const [prefReligions, setPrefReligions] = useState<string[]>([]);
  const [prefCaste, setPrefCaste] = useState<string>("");
  const [prefManglik, setPrefManglik] = useState<string>("");
  const [prefInstitutions, setPrefInstitutions] = useState<string[]>([]);
  const [prefCities, setPrefCities] = useState("");
  const [prefRelocations, setPrefRelocations] = useState<string[]>([]);
  const [prefShieldEmployer, setPrefShieldEmployer] = useState(false);

  const prefs = useQuery({
    queryKey: ["partner-preferences"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not-signed-in");
      const { data, error } = await supabase
        .from("partner_preferences")
        .select("*")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return EMPTY_PREFERENCES;
      return {
        min_age: data.min_age,
        max_age: data.max_age,
        min_height_cm: data.min_height_cm,
        max_height_cm: data.max_height_cm,
        genders: data.genders ?? [],
        marital_statuses: data.marital_statuses ?? [],
        diets: data.diets ?? [],
        religions: data.religions ?? [],
        caste_preference: data.caste_preference ?? null,
        manglik_preference: data.manglik_preference ?? null,
        institutions: data.institutions ?? [],
        cities: data.cities ?? [],
        relocations: data.relocations ?? [],
        shield_employer: data.shield_employer ?? false,
      };
    },
  });

  useEffect(() => {
    if (prefs.data && !prefSeeded) {
      setPrefSeeded(true);
      setMinAge(prefs.data.min_age?.toString() ?? "");
      setMaxAge(prefs.data.max_age?.toString() ?? "");
      setMinHeight(prefs.data.min_height_cm?.toString() ?? "");
      setMaxHeight(prefs.data.max_height_cm?.toString() ?? "");
      setPrefGenders(prefs.data.genders);
      setPrefMaritalStatuses(prefs.data.marital_statuses ?? []);
      setPrefDiets(prefs.data.diets ?? []);
      setPrefReligions(prefs.data.religions ?? []);
      setPrefCaste(prefs.data.caste_preference ?? "");
      setPrefManglik(prefs.data.manglik_preference ?? "");
      setPrefInstitutions(prefs.data.institutions);
      setPrefCities(prefs.data.cities.join(", "));
      setPrefRelocations(prefs.data.relocations);
      setPrefShieldEmployer(prefs.data.shield_employer);
    }
  }, [prefs.data, prefSeeded]);

  const isDirty =
    Boolean(prefs.data) &&
    (minAge !== (prefs.data?.min_age?.toString() ?? "") ||
      maxAge !== (prefs.data?.max_age?.toString() ?? "") ||
      minHeight !== (prefs.data?.min_height_cm?.toString() ?? "") ||
      maxHeight !== (prefs.data?.max_height_cm?.toString() ?? "") ||
      prefGenders.join() !== (prefs.data?.genders ?? []).join() ||
      prefMaritalStatuses.join() !== (prefs.data?.marital_statuses ?? []).join() ||
      prefDiets.join() !== (prefs.data?.diets ?? []).join() ||
      prefReligions.join() !== (prefs.data?.religions ?? []).join() ||
      prefCaste !== (prefs.data?.caste_preference ?? "") ||
      prefManglik !== (prefs.data?.manglik_preference ?? "") ||
      prefInstitutions.join() !== (prefs.data?.institutions ?? []).join() ||
      prefCities !== (prefs.data?.cities ?? []).join(", ") ||
      prefRelocations.join() !== (prefs.data?.relocations ?? []).join() ||
      prefShieldEmployer !== (prefs.data?.shield_employer ?? false));

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const savePrefs = useMutation({
    mutationFn: async (patch: {
      min_age: number | null;
      max_age: number | null;
      min_height_cm: number | null;
      max_height_cm: number | null;
      genders: string[];
      marital_statuses: string[];
      diets: string[];
      religions: string[];
      caste_preference: string | null;
      manglik_preference: string | null;
      institutions: string[];
      cities: string[];
      relocations: string[];
      shield_employer: boolean;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not-signed-in");
      const { error } = await supabase.from("partner_preferences").upsert(
        {
          user_id: u.user.id,
          ...patch,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      const anySet =
        patch.min_age !== null ||
        patch.max_age !== null ||
        patch.min_height_cm !== null ||
        patch.max_height_cm !== null ||
        patch.genders.length > 0 ||
        patch.marital_statuses.length > 0 ||
        patch.diets.length > 0 ||
        patch.religions.length > 0 ||
        patch.caste_preference !== null ||
        patch.manglik_preference !== null ||
        patch.institutions.length > 0 ||
        patch.cities.length > 0 ||
        patch.relocations.length > 0;
      return recordConsent(
        "partnership_criteria",
        anySet,
        anySet ? "Partner criteria updated" : "Partner criteria cleared",
      );
    },
    onSuccess: (consent) => {
      qc.invalidateQueries({ queryKey: ["partner-preferences"] });
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["consent-events"] });
      if (consent.ok) toast.success("Partner preferences saved.");
      else toast.warning(CONSENT_RECEIPT_WARNING, { duration: 8000 });
    },
    onError: () => toast.error("Could not save your preferences. Please try again."),
  });

  function savePreferences() {
    const lo = minAge.trim() === "" ? null : Number(minAge);
    const hi = maxAge.trim() === "" ? null : Number(maxAge);
    if (lo !== null && (!Number.isInteger(lo) || lo < 21 || lo > 80)) {
      toast.error("Minimum age must be between 21 and 80.");
      return;
    }
    if (hi !== null && (!Number.isInteger(hi) || hi < 21 || hi > 80)) {
      toast.error("Maximum age must be between 21 and 80.");
      return;
    }
    if (lo !== null && hi !== null && lo > hi) {
      toast.error("Minimum age cannot be greater than maximum age.");
      return;
    }
    const minH = minHeight.trim() === "" ? null : Number(minHeight);
    const maxH = maxHeight.trim() === "" ? null : Number(maxHeight);
    if (minH !== null && maxH !== null && minH > maxH) {
      toast.error("Minimum height cannot be greater than maximum height.");
      return;
    }
    const cities = [
      ...new Set(
        prefCities
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
      ),
    ].slice(0, 20);
    savePrefs.mutate({
      min_age: lo,
      max_age: hi,
      min_height_cm: minH,
      max_height_cm: maxH,
      genders: prefGenders.slice(0, 5),
      marital_statuses: prefMaritalStatuses.slice(0, 5),
      diets: prefDiets.slice(0, 5),
      religions: prefReligions.slice(0, 15),
      caste_preference: prefCaste.trim() || null,
      manglik_preference: prefManglik.trim() || null,
      institutions: prefInstitutions.slice(0, 20),
      cities,
      relocations: prefRelocations.slice(0, 5),
      shield_employer: prefShieldEmployer,
    });
  }

  function clearPreferences() {
    setMinAge("");
    setMaxAge("");
    setMinHeight("");
    setMaxHeight("");
    setPrefGenders([]);
    setPrefMaritalStatuses([]);
    setPrefDiets([]);
    setPrefReligions([]);
    setPrefCaste("");
    setPrefManglik("");
    setPrefInstitutions([]);
    setPrefCities("");
    setPrefRelocations([]);
    savePrefs.mutate({
      min_age: null,
      max_age: null,
      min_height_cm: null,
      max_height_cm: null,
      genders: [],
      marital_statuses: [],
      diets: [],
      religions: [],
      caste_preference: null,
      manglik_preference: null,
      institutions: [],
      cities: [],
      relocations: [],
      shield_employer: prefShieldEmployer,
    });
  }

  return (
    <section className="mt-6 border border-border bg-card p-6 md:p-8">
      <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
        <SlidersHorizontal className="size-5 text-brass" /> Partner preferences
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        What you are looking for in a partner. When your profile is visible in the directory,
        verified members see these stated criteria in the “Looking for in a partner” section on your
        profile, and they power mutual preference badges across search. Your Employer Shield setting
        below remains strictly private and is never shown to other members.
      </p>

      {prefs.isError ? (
        <p
          role="alert"
          className="mt-6 border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
        >
          Your partner preferences could not be loaded, so they are hidden rather than shown as
          empty — saving now would erase them.{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => void prefs.refetch()}
            disabled={prefs.isFetching}
          >
            {prefs.isFetching ? "Retrying…" : "Retry"}
          </button>
        </p>
      ) : prefs.isLoading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-busy="true">
          <span className="sr-only">Loading your partner preferences…</span>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full sm:col-span-2" />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pref-min-age">Minimum age</Label>
              <Input
                id="pref-min-age"
                inputMode="numeric"
                placeholder="21"
                value={minAge}
                onChange={(e) => setMinAge(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pref-max-age">Maximum age</Label>
              <Input
                id="pref-max-age"
                inputMode="numeric"
                placeholder="40"
                value={maxAge}
                onChange={(e) => setMaxAge(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pref-min-height">Minimum height</Label>
              <select
                id="pref-min-height"
                className={selectCls}
                value={minHeight}
                onChange={(e) => setMinHeight(e.target.value)}
              >
                <option value="">Any height</option>
                {HEIGHT_OPTIONS.map((h) => (
                  <option key={h.cm} value={String(h.cm)}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pref-max-height">Maximum height</Label>
              <select
                id="pref-max-height"
                className={selectCls}
                value={maxHeight}
                onChange={(e) => setMaxHeight(e.target.value)}
              >
                <option value="">Any height</option>
                {HEIGHT_OPTIONS.map((h) => (
                  <option key={h.cm} value={String(h.cm)}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold">Preferred marital status</legend>
            <div className="mt-3 flex flex-wrap gap-4">
              {MARITAL_STATUSES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-6 accent-[var(--brass)]"
                    checked={prefMaritalStatuses.includes(m)}
                    onChange={(e) =>
                      setPrefMaritalStatuses((prev) =>
                        e.target.checked ? [...prev, m] : prev.filter((x) => x !== m),
                      )
                    }
                  />
                  {m}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold">Preferred dietary habit</legend>
            <div className="mt-3 flex flex-wrap gap-4">
              {DIETS.map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-6 accent-[var(--brass)]"
                    checked={prefDiets.includes(d)}
                    onChange={(e) =>
                      setPrefDiets((prev) =>
                        e.target.checked ? [...prev, d] : prev.filter((x) => x !== d),
                      )
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold">Preferred religion</legend>
            <div className="mt-3 flex flex-wrap gap-4">
              {RELIGIONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-6 accent-[var(--brass)]"
                    checked={prefReligions.includes(r)}
                    onChange={(e) =>
                      setPrefReligions((prev) =>
                        e.target.checked ? [...prev, r] : prev.filter((x) => x !== r),
                      )
                    }
                  />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pref-caste">Preferred community / caste</Label>
              <select
                id="pref-caste"
                className={selectCls}
                value={prefCaste}
                onChange={(e) => setPrefCaste(e.target.value)}
              >
                <option value="">Any community / no constraint</option>
                {CASTES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pref-manglik">Preferred Manglik status</Label>
              <select
                id="pref-manglik"
                className={selectCls}
                value={prefManglik}
                onChange={(e) => setPrefManglik(e.target.value)}
              >
                <option value="">Any / no constraint</option>
                {MANGALIK_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold">Preferred gender</legend>
            <div className="mt-3 flex flex-wrap gap-4">
              {GENDERS.map((g) => (
                <label key={g} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-6 accent-[var(--brass)]"
                    checked={prefGenders.includes(g)}
                    onChange={(e) =>
                      setPrefGenders((prev) =>
                        e.target.checked ? [...prev, g] : prev.filter((x) => x !== g),
                      )
                    }
                  />
                  {g}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold">Preferred relocation stance</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {RELOCATION.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-6 accent-[var(--brass)]"
                    checked={prefRelocations.includes(r)}
                    onChange={(e) =>
                      setPrefRelocations((prev) =>
                        e.target.checked ? [...prev, r] : prev.filter((x) => x !== r),
                      )
                    }
                  />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6 grid gap-2">
            <Label htmlFor="pref-institutions">Preferred institutions (select any)</Label>
            <select
              id="pref-institutions"
              multiple
              size={6}
              className="w-full border border-input bg-background px-3 py-2 text-sm"
              value={prefInstitutions}
              onChange={(e) =>
                setPrefInstitutions(Array.from(e.target.selectedOptions).map((o) => o.value))
              }
            >
              {INSTITUTIONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal leading-5 text-muted-foreground">
              Hold ⌘/Ctrl to select more than one. Leave unselected to keep the whole directory
              open.
            </span>
          </div>

          <div className="mt-6 grid gap-2">
            <Label htmlFor="pref-cities">Preferred cities</Label>
            <Input
              id="pref-cities"
              placeholder="Mumbai, Bengaluru, London"
              value={prefCities}
              onChange={(e) => setPrefCities(e.target.value)}
            />
            <span className="text-xs font-normal leading-5 text-muted-foreground">
              Comma separated. Matched against the member&rsquo;s current city.
            </span>
          </div>

          <div className="mt-6 border-t border-border pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldAlert className="size-4 text-brass" /> Employer shield
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Hide profiles of members who currently work at the same organisation as you.
                  Applied server-side, so it also applies to counts and pagination.
                </p>
                {!employer && (
                  <p className="mt-2 text-xs text-destructive">
                    Add your organisation under onboarding before this can take effect.
                  </p>
                )}
              </div>
              <Switch
                checked={prefShieldEmployer}
                disabled={!employer}
                onCheckedChange={setPrefShieldEmployer}
                aria-label="Employer shield"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              onClick={savePreferences}
              disabled={savePrefs.isPending}
              aria-busy={savePrefs.isPending}
            >
              {savePrefs.isPending ? "Saving…" : "Save preferences"}
            </Button>
            {clearOpen ? (
              <div
                role="group"
                aria-label="Confirm clearing partner preferences"
                className="flex basis-full flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
              >
                <p className="text-sm leading-6 text-destructive">
                  Clear every partner preference? Your age range, institutions, cities and
                  relocation choices will all be reset.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={savePrefs.isPending}
                  onClick={() => {
                    clearPreferences();
                    setClearOpen(false);
                  }}
                >
                  {savePrefs.isPending ? "Clearing…" : "Yes, clear all"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setClearOpen(false)}>
                  Keep them
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setClearOpen(true)}
                disabled={savePrefs.isPending}
              >
                Clear all
              </Button>
            )}
            {prefs.data && !hasAnyPreferences(prefs.data) && (
              <span className="text-sm text-muted-foreground">No criteria set yet.</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
