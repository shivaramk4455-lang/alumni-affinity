import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { cloneElement, isValidElement, useId, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Check, CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useMyProfile, MY_PROFILE_KEY } from "@/hooks/use-my-profile";
import type { MyProfileRow } from "@/lib/profile-columns";
import { recordConsent } from "@/lib/consent";
import { supabase } from "@/integrations/supabase/client";
import {
  DEGREES,
  DIETS,
  GENDERS,
  HEIGHT_OPTIONS,
  INSTITUTIONS,
  MAJOR_CITIES_BY_STATE,
  MARITAL_STATUSES,
  MOTHER_TONGUES,
  RELOCATION,
  RESIDENCY_STATUSES,
  detectCountryAndStateFromCity,
  detectStateFromCity,
  getRegionsForCountry,
} from "@/lib/profile-options";
import { APPLY_DRAFT_KEY } from "@/routes/apply";

const prefillSchema = z.object({ prefill: z.string().optional() });

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: (s) => prefillSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Onboarding — The Merit Circle" },
      { name: "description", content: "Complete your verified member profile." },
      { property: "og:title", content: "Onboarding — The Merit Circle" },
      { property: "og:description", content: "Complete your verified member profile." },
    ],
  }),
  component: Onboarding,
});

type Form = {
  full_name: string;
  gender: string;
  birth_year: string;
  city: string;
  height_cm: string;
  marital_status: string;
  diet: string;
  mother_tongue: string;
  residency_status: string;
  institution: string;
  degree: string;
  grad_year: string;
  profession: string;
  employer: string;
  relocation: string;
  values_statement: string;
  bio: string;
  is_visible: boolean;
};
const empty: Form = {
  full_name: "",
  gender: "",
  birth_year: "",
  city: "",
  height_cm: "",
  marital_status: "",
  diet: "",
  mother_tongue: "",
  residency_status: "",
  institution: "",
  degree: "",
  grad_year: "",
  profession: "",
  employer: "",
  relocation: "",
  values_statement: "",
  bio: "",
  is_visible: true,
};

const steps = ["About you", "Education", "Career & life", "Values & privacy"];
const year = new Date().getFullYear();
const schemas = [
  z.object({
    full_name: z.string().trim().min(2, "Enter your name").max(100),
    gender: z.string().min(1, "Select gender"),
    birth_year: z.coerce
      .number()
      .int()
      .min(year - 70, "Check birth year")
      .max(year - 21, "Members must be 21+"),
    city: z.string().trim().min(2, "Enter your city").max(80),
    height_cm: z
      .string()
      .trim()
      .refine((v) => !v || (!Number.isNaN(Number(v)) && Number(v) >= 120 && Number(v) <= 240), {
        message: "Height should be between 120 and 240 cm",
      }),
    marital_status: z.string().optional(),
    diet: z.string().optional(),
    mother_tongue: z.string().optional(),
    residency_status: z.string().optional(),
  }),
  z.object({
    institution: z.string().min(1, "Select institution"),
    degree: z.string().trim().min(2, "Select or enter your degree").max(80),
    grad_year: z.coerce
      .number({ invalid_type_error: "Select graduation year" })
      .int()
      .min(1960, "Select graduation year")
      .max(year + 2, "Check graduation year"),
  }),
  z.object({
    profession: z.string().trim().min(2, "Enter profession").max(80),
    employer: z.string().trim().max(80),
    relocation: z.string().min(1, "Select relocation preference"),
  }),
  z.object({
    values_statement: z
      .string()
      .trim()
      .min(20, "Share at least a sentence (20+ characters)")
      .max(600),
    bio: z.string().trim().max(1000),
  }),
];

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";
const ONBOARDING_DRAFT_KEY = "alumni_onboarding_draft_v2";

function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { prefill } = Route.useSearch();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const submittedRef = useRef(false);
  const [dob, setDob] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const birthYears = Array.from({ length: 50 }, (_, i) => year - 21 - i);
  const graduationYears = Array.from({ length: year + 2 - 1960 + 1 }, (_, i) => year + 2 - i);
  const [customDegreeSelected, setCustomDegreeSelected] = useState(false);
  const isCustomDegree = Boolean(
    f.degree && !DEGREES.includes(f.degree as (typeof DEGREES)[number]),
  );
  /** Per-field validation messages, keyed by the schema path, for this step. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof Form, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }
  };
  const me = useMyProfile();
  const loaded = useRef(false);

  // Automatically persist in-progress onboarding state to localStorage so refresh never wipes data
  useEffect(() => {
    if (!loaded.current || submittedRef.current) return;
    if (!me.data?.onboarded) {
      try {
        localStorage.setItem(
          ONBOARDING_DRAFT_KEY,
          JSON.stringify({ step, f, dob, selectedState, customDegreeSelected }),
        );
      } catch {
        /* storage quota */
      }
    }
  }, [step, f, dob, selectedState, customDegreeSelected, me.data?.onboarded]);

  // Seed the form from the member's own row once (via the security-definer
  // view), then layer the application draft over it when prefill=1.
  useEffect(() => {
    if (loaded.current || me.isLoading) return;
    const data = me.data;
    let prefilled = false;

    // Check if there is an in-progress onboarding draft in localStorage (e.g. from page refresh)
    if (!data?.onboarded) {
      try {
        const rawSaved = localStorage.getItem(ONBOARDING_DRAFT_KEY);
        if (rawSaved) {
          const draft = JSON.parse(rawSaved) as {
            step?: number;
            f?: Partial<Form>;
            dob?: string;
            selectedState?: string;
            customDegreeSelected?: boolean;
          };
          if (draft && draft.f && typeof draft.f === "object") {
            setF((prev) => ({ ...prev, ...draft.f }));
            if (typeof draft.step === "number" && draft.step >= 0 && draft.step < steps.length) {
              setStep(draft.step);
            }
            if (draft.dob) setDob(draft.dob);
            if (draft.selectedState) setSelectedState(draft.selectedState);
            if (typeof draft.customDegreeSelected === "boolean") {
              setCustomDegreeSelected(draft.customDegreeSelected);
            }
            prefilled = true;
          }
        }
      } catch {
        /* start blank */
      }
    }
    if (prefill && !data?.onboarded) {
      try {
        const raw = localStorage.getItem(APPLY_DRAFT_KEY);
        if (raw) {
          const draft = JSON.parse(raw) as Record<string, string | boolean>;
          const str = (k: string) => (typeof draft[k] === "string" ? (draft[k] as string) : "");
          const thisYear = new Date().getFullYear();
          const signupName = data?.full_name ?? "";
          const dobYear = Number(str("dob").slice(0, 4));
          const age = Number.isFinite(dobYear) ? thisYear - dobYear : 30;
          const birthYear = str("dob") ? String(thisYear - Math.max(21, Math.min(70, age))) : "";
          const degreeYear = str("degree").match(/(19|20)\d{2}/)?.[0] ?? "";
          const degree =
            str("degree")
              .replace(/,?\s*(19|20)\d{2}\s*/g, "")
              .trim() || str("degree");
          setF((p) => ({
            ...p,
            full_name: str("name") || signupName,
            city: str("city"),
            institution: str("institution"),
            degree,
            grad_year: degreeYear,
            profession: str("profession"),
            relocation: str("relocation"),
            values_statement: str("values"),
            bio: str("chapter"),
            birth_year: birthYear,
            is_visible: draft["ghost"] === false,
          }));
          const dobStr = str("dob");
          if (dobStr) setDob(dobStr);
          else if (birthYear) setDob(`${birthYear}-01-01`);
          const draftCity = str("city");
          if (draftCity) {
            const detected = detectCountryAndStateFromCity(draftCity);
            if (detected.state) setSelectedState(detected.state);
            else setSelectedState(detectStateFromCity(draftCity));
            if (detected.country) {
              setF((p) => ({ ...p, residency_status: p.residency_status || detected.country }));
            }
          }
          // The alumni email cannot be recovered by re-running the wizard (it
          // drives verification), so a failed carry-over is reported rather than
          // bundled into the success claim.
          void (async () => {
            const email = str("alumniEmail").trim().toLowerCase();
            if (!email) return;
            const { data: u } = await supabase.auth.getUser();
            if (!u.user) return;
            const { error } = await supabase
              .from("profiles")
              .update({ alumni_email: email })
              .eq("id", u.user.id);
            if (error) {
              toast.warning(
                "Your application carried over, but the alumni email could not be saved — add it under Verification.",
                { duration: 8000 },
              );
            }
          })();
          toast.success("Your application carried over — review and finish.");
          prefilled = true;
        }
      } catch {
        /* start blank */
      }
    }
    if (!prefilled && data && (data.onboarded || data.full_name)) {
      setF({
        full_name: data.full_name ?? "",
        gender: data.gender ?? "",
        birth_year: data.birth_year?.toString() ?? "",
        city: data.city ?? "",
        height_cm: data.height_cm?.toString() ?? "",
        marital_status: data.marital_status ?? "",
        diet: data.diet ?? "",
        mother_tongue: data.mother_tongue ?? "",
        residency_status: data.residency_status ?? "",
        institution: data.institution ?? "",
        degree: data.degree ?? "",
        grad_year: data.grad_year?.toString() ?? "",
        profession: data.profession ?? "",
        employer: data.employer ?? "",
        relocation: data.relocation ?? "",
        values_statement: data.values_statement ?? "",
        bio: data.bio ?? "",
        is_visible: data.is_visible,
      });
      if (data.birth_year) setDob(`${data.birth_year}-01-01`);
      if (data.city) {
        const detected = detectCountryAndStateFromCity(data.city);
        if (detected.state) setSelectedState(detected.state);
        else setSelectedState(detectStateFromCity(data.city));
        if (!data.residency_status && detected.country) {
          setF((p) => ({ ...p, residency_status: detected.country }));
        }
      }
    }
    loaded.current = true;
  }, [me.data, me.isLoading, prefill]);

  async function next() {
    const r = schemas[step]!.safeParse(f);
    if (!r.success) {
      // Surface all failures on the fields of this step
      const newErrors: Record<string, string> = {};
      for (const issue of r.error.issues) {
        const k = String(issue.path[0]);
        if (!newErrors[k]) newErrors[k] = issue.message;
      }
      setErrors(newErrors);
      // Move focus to the first offending control so keyboard and screen-reader
      // users are directed to the first issue to fix.
      setTimeout(() => {
        const node = document.querySelector<HTMLElement>(`[aria-invalid="true"]`);
        node?.focus();
        node?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 0);
      return;
    }
    setErrors({});
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }
    setSaving(true);
    // `getUser` and the update are both fallible and were previously outside
    // any try/finally, so a single expired session left the wizard stuck on
    // "Saving…" forever with an unhandled rejection and no feedback.
    const heightNum = f.height_cm.trim() ? Number(f.height_cm.trim()) : null;
    const profileUpdates = {
      full_name: f.full_name.trim(),
      gender: f.gender,
      birth_year: Number(f.birth_year),
      city: f.city.trim(),
      height_cm: heightNum,
      marital_status: f.marital_status || null,
      diet: f.diet || null,
      mother_tongue: f.mother_tongue || null,
      residency_status: f.residency_status || null,
      institution: f.institution,
      degree: f.degree.trim(),
      grad_year: Number(f.grad_year),
      profession: f.profession.trim(),
      employer: f.employer.trim() || null,
      relocation: f.relocation,
      values_statement: f.values_statement.trim(),
      bio: f.bio.trim() || null,
      is_visible: f.is_visible,
      onboarded: true,
    };

    try {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError || !u.user) throw new Error("Your session has expired. Please sign in again.");
      const { error } = await supabase.from("profiles").update(profileUpdates).eq("id", u.user.id);
      if (error) throw error;
      submittedRef.current = true;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not save your profile. Please try again.",
      );
      return;
    } finally {
      setSaving(false);
    }
    try {
      localStorage.removeItem(APPLY_DRAFT_KEY);
      localStorage.removeItem(ONBOARDING_DRAFT_KEY);
    } catch {
      /* ignore */
    }

    // Immediately reflect onboarded status and new fields in the query cache
    // so child and guarded routes never see stale `onboarded: false` data.
    queryClient.setQueryData(MY_PROFILE_KEY, (old: MyProfileRow | null | undefined) => {
      if (!old) return old;
      return {
        ...old,
        ...profileUpdates,
        onboarded: true,
      };
    });
    void queryClient.invalidateQueries({ queryKey: MY_PROFILE_KEY });

    // Onboarding is where the member accepts the membership terms, the privacy
    // notice and the use of their stated criteria for matching. The ledger row
    // is written once, on the transition to onboarded = true.
    if (!me.data?.onboarded) {
      const terms = await recordConsent(
        "terms_and_privacy",
        true,
        "Membership terms and privacy notice accepted at onboarding",
      );
      const criteria = await recordConsent(
        "partnership_criteria",
        true,
        "Partnership criteria and profile details may be used for matching",
      );
      // The DPDP receipt is the one row that must not go missing silently —
      // warn loudly rather than claim an acceptance that was never recorded.
      if (!terms.ok || !criteria.ok) {
        toast.warning(
          "Profile saved, but the consent receipt could not be written — retry from Settings.",
          { duration: 8000 },
        );
      }
    }
    const isEdit = me.data?.onboarded;
    toast.success(
      isEdit ? "Profile updated successfully." : "Profile saved. Welcome to the Circle.",
    );
    navigate({ to: "/dashboard" });
  }

  if (me.isError) {
    // Without this the wizard renders every field blank on a failed read, which
    // looks like a fresh profile rather than a load error.
    return (
      <main className="mx-auto max-w-3xl px-5 py-20 text-center">
        <CircleAlert className="mx-auto size-8 text-destructive" />
        <h1 className="mt-4 font-serif text-3xl font-semibold">Your profile could not be loaded</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The wizard needs your existing profile so it cannot overwrite it. This is a connection
          problem, not a missing account.
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

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
      {me.data?.onboarded && (
        <div className="mb-4">
          <Link
            to="/dashboard"
            className="inline-flex items-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to membership desk
          </Link>
        </div>
      )}
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        {me.data?.onboarded ? "Edit member profile" : "Member onboarding"}
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">{steps[step]}</h1>
      <ol className="mt-8 grid grid-cols-4 gap-2" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className="grid gap-2" aria-current={i === step ? "step" : undefined}>
            <span className={`h-1 ${i <= step ? "bg-primary" : "bg-border"}`} />
            <span
              className={`hidden text-xs sm:flex items-center gap-1 ${i === step ? "text-foreground" : "text-muted-foreground"}`}
            >
              {i < step && <Check className="size-3" />}
              {s}
            </span>
            {/* Step names are hidden on mobile; keep them announced there. */}
            <span className="sr-only sm:hidden">{i === step ? `${s} (current step)` : s}</span>
          </li>
        ))}
      </ol>

      {/* A real <form>, so Enter in any field advances the step — expected in
          a 4-step wizard, and previously a dead keypress. */}
      <form
        className="mt-10 grid gap-5 border border-border bg-card p-6 md:p-8"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void next();
        }}
      >
        {step === 0 && (
          <>
            <Field label="Full name" error={errors["full_name"]}>
              <Input
                autoComplete="name"
                value={f.full_name}
                onChange={(e) => set("full_name", e.target.value)}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Gender" error={errors["gender"]}>
                <select
                  className={selectCls}
                  value={f.gender}
                  onChange={(e) => set("gender", e.target.value)}
                >
                  <option value="">Select</option>
                  {GENDERS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Date of birth / Age (21+)"
                error={errors["birth_year"]}
                note={
                  f.birth_year &&
                  Number(f.birth_year) >= year - 70 &&
                  Number(f.birth_year) <= year - 21
                    ? `${year - Number(f.birth_year)} years old · Born ${f.birth_year}`
                    : "Membership is 21+"
                }
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    type="date"
                    className="cursor-pointer"
                    max={`${year - 21}-12-31`}
                    min={`${year - 70}-01-01`}
                    value={dob}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDob(val);
                      if (val) {
                        const yr = val.slice(0, 4);
                        set("birth_year", yr);
                      }
                    }}
                  />
                  <select
                    className={selectCls}
                    value={f.birth_year}
                    onChange={(e) => {
                      const yr = e.target.value;
                      set("birth_year", yr);
                      if (yr) setDob(`${yr}-01-01`);
                    }}
                  >
                    <option value="">Select birth year</option>
                    {birthYears.map((yr) => (
                      <option key={yr} value={String(yr)}>
                        {yr} ({year - yr} yrs)
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Country / Residency">
                <select
                  className={selectCls}
                  value={f.residency_status}
                  onChange={(e) => {
                    const country = e.target.value;
                    set("residency_status", country);
                    const validRegions = getRegionsForCountry(country);
                    if (selectedState && !validRegions.includes(selectedState)) {
                      setSelectedState("");
                    }
                  }}
                >
                  <option value="">Select country / residency</option>
                  {RESIDENCY_STATUSES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={
                  f.residency_status === "Canada"
                    ? "Province / Territory"
                    : f.residency_status?.startsWith("US")
                      ? "State"
                      : f.residency_status === "United Kingdom"
                        ? "Region / Country"
                        : "State / Province"
                }
              >
                <select
                  className={selectCls}
                  value={selectedState}
                  onChange={(e) => {
                    const st = e.target.value;
                    setSelectedState(st);
                  }}
                >
                  <option value="">
                    {f.residency_status === "Canada"
                      ? "Select Province"
                      : f.residency_status?.startsWith("US")
                        ? "Select State"
                        : "Select State / Province"}
                  </option>
                  {getRegionsForCountry(f.residency_status).map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Current city" error={errors["city"]}>
              <Input
                autoComplete="address-level2"
                placeholder={
                  f.residency_status === "Canada"
                    ? "e.g. Toronto, Vancouver, Montreal"
                    : f.residency_status?.startsWith("US")
                      ? "e.g. San Francisco, New York, Seattle"
                      : f.residency_status === "United Kingdom"
                        ? "e.g. London, Manchester"
                        : "e.g. Bhopal, Bengaluru, Mumbai"
                }
                value={f.city}
                onChange={(e) => {
                  const val = e.target.value;
                  set("city", val);
                  if (!f.residency_status || !selectedState) {
                    const detected = detectCountryAndStateFromCity(val);
                    if (detected.state && !selectedState) {
                      setSelectedState(detected.state);
                    }
                    if (detected.country && !f.residency_status) {
                      set("residency_status", detected.country);
                    }
                  }
                }}
              />
            </Field>
            {selectedState && MAJOR_CITIES_BY_STATE[selectedState] && (
              <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground font-medium">
                  Popular in {selectedState}:
                </span>
                {MAJOR_CITIES_BY_STATE[selectedState].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set("city", c)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      f.city === c
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary/50 text-foreground hover:bg-secondary"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Height (optional)">
                <select
                  className={selectCls}
                  value={f.height_cm}
                  onChange={(e) => set("height_cm", e.target.value)}
                >
                  <option value="">Select height</option>
                  {HEIGHT_OPTIONS.map((h) => (
                    <option key={h.cm} value={String(h.cm)}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Marital status (optional)">
                <select
                  className={selectCls}
                  value={f.marital_status}
                  onChange={(e) => set("marital_status", e.target.value)}
                >
                  <option value="">Select</option>
                  {MARITAL_STATUSES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Dietary preference (optional)">
                <select
                  className={selectCls}
                  value={f.diet}
                  onChange={(e) => set("diet", e.target.value)}
                >
                  <option value="">Select</option>
                  {DIETS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mother tongue (optional)">
                <select
                  className={selectCls}
                  value={f.mother_tongue}
                  onChange={(e) => set("mother_tongue", e.target.value)}
                >
                  <option value="">Select</option>
                  {MOTHER_TONGUES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Institution" error={errors["institution"]}>
              <select
                className={selectCls}
                value={f.institution}
                onChange={(e) => set("institution", e.target.value)}
              >
                <option value="">Select institution</option>
                {INSTITUTIONS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Degree" error={errors["degree"]}>
                <select
                  className={selectCls}
                  value={
                    isCustomDegree || customDegreeSelected
                      ? "Other"
                      : DEGREES.includes(f.degree as (typeof DEGREES)[number])
                        ? f.degree
                        : f.degree
                          ? "Other"
                          : ""
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "Other") {
                      setCustomDegreeSelected(true);
                      if (DEGREES.includes(f.degree as (typeof DEGREES)[number])) {
                        set("degree", "");
                      }
                    } else {
                      setCustomDegreeSelected(false);
                      set("degree", val);
                    }
                  }}
                >
                  <option value="">Select degree</option>
                  {DEGREES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Graduation year" error={errors["grad_year"]}>
                <select
                  className={selectCls}
                  value={f.grad_year}
                  onChange={(e) => set("grad_year", e.target.value)}
                >
                  <option value="">Select graduation year</option>
                  {graduationYears.map((yr) => (
                    <option key={yr} value={String(yr)}>
                      {yr}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {(isCustomDegree || customDegreeSelected) && (
              <Field label="Specify degree" error={errors["degree"]} note="Enter your degree name">
                <Input
                  autoFocus
                  placeholder="e.g. Master of Science, B.Pharm, M.Ch…"
                  value={f.degree}
                  onChange={(e) => set("degree", e.target.value)}
                />
              </Field>
            )}
            <p className="text-sm text-muted-foreground">
              Institution verification via alumni email or document review follows after onboarding.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Profession" error={errors["profession"]}>
                <Input
                  autoComplete="organization-title"
                  value={f.profession}
                  onChange={(e) => set("profession", e.target.value)}
                />
              </Field>
              <Field label="Organisation (optional)">
                <Input value={f.employer} onChange={(e) => set("employer", e.target.value)} />
              </Field>
            </div>
            <Field label="Relocation" error={errors["relocation"]}>
              <select
                className={selectCls}
                value={f.relocation}
                onChange={(e) => set("relocation", e.target.value)}
              >
                <option value="">Select</option>
                {RELOCATION.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        {step === 3 && (
          <>
            <Field label="What matters to you in a partnership" error={errors["values_statement"]}>
              <Textarea
                rows={4}
                maxLength={600}
                value={f.values_statement}
                onChange={(e) => set("values_statement", e.target.value)}
              />
            </Field>
            <Field label="A short introduction (optional)">
              <Textarea rows={4} value={f.bio} onChange={(e) => set("bio", e.target.value)} />
            </Field>
            <div className="flex items-start justify-between gap-4 border-t border-border pt-5">
              <div>
                <p className="text-sm font-medium">Visible to verified members</p>
                <p className="text-xs text-muted-foreground">
                  Turn off for ghost mode — you can browse, but won't appear in search.
                </p>
              </div>
              <Switch
                checked={f.is_visible}
                onCheckedChange={(v) => set("is_visible", v)}
                aria-label="Visible to members"
              />
            </div>
          </>
        )}

        <div className="mt-6 flex justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={step === 0}
            onClick={() => {
              setErrors({});
              setStep(step - 1);
            }}
          >
            Back
          </Button>
          <Button type="submit" disabled={saving} aria-busy={saving}>
            {step === steps.length - 1
              ? saving
                ? "Saving…"
                : me.data?.onboarded
                  ? "Save changes"
                  : "Finish"
              : "Continue"}
          </Button>
        </div>
      </form>
    </main>
  );
}

/**
 * A labelled form control.
 *
 * The label is wired to the control with a generated id (and the control
 * gets that same id), so clicking the text focuses the field and a screen
 * reader announces "Full name, edit text" instead of an unlabelled box.
 * Previously <Label> sat next to the input with no association at all.
 */
function Field({
  label,
  children,
  error,
  note,
}: {
  label: string;
  children: React.ReactNode;
  // `| undefined` (not just `?`) because the project sets exactOptionalPropertyTypes.
  error?: string | undefined;
  note?: string | undefined;
}) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(
        children as React.ReactElement<{
          id?: string;
          "aria-invalid"?: boolean | undefined;
          "aria-describedby"?: string | undefined;
        }>,
        {
          id,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error ? `${id}-error` : undefined,
        },
      )
    : children;
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {note && <span className="text-xs text-brass font-medium">{note}</span>}
      </div>
      {control}
      {error && (
        <span
          id={`${id}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-sm leading-6 text-destructive"
        >
          <CircleAlert className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}
