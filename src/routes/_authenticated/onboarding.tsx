import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Check, CircleAlert, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMyProfile, MY_PROFILE_KEY } from "@/hooks/use-my-profile";
import type { MyProfileRow } from "@/lib/profile-columns";
import type { Database } from "@/integrations/supabase/types";
import { recordConsent } from "@/lib/consent";
import { supabase } from "@/integrations/supabase/client";
import {
  CASTES,
  DEGREES,
  GOTRAS,
  MAJOR_CITIES_BY_STATE,
  PROFESSIONS,
  detectStateFromCity,
} from "@/lib/profile-options";
import { APPLY_DRAFT_KEY } from "@/routes/apply";

import { emptyForm, type Form } from "@/components/onboarding/types";
import { StepAboutYou } from "@/components/onboarding/step-about-you";
import { StepEducation } from "@/components/onboarding/step-education";
import { StepCareer } from "@/components/onboarding/step-career";
import { StepValues } from "@/components/onboarding/step-values";

const prefillSchema = z.object({ prefill: z.string().optional() });

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: (s) => prefillSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Onboarding — The Merit Circle" },
      { name: "description", content: "Complete your verified member profile." },
      { property: "og:title", content: "Onboarding — The Merit Circle" },
      { property: "og:description", content: "Complete your verified member profile." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Onboarding,
});

const steps = ["About you", "Education", "Career & life", "Values & privacy"];
const year = new Date().getFullYear();
const schemas = [
  z.object({
    full_name: z.string().trim().min(2, "Enter your name").max(100),
    created_by: z.string().optional(),
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
    religion: z.string().optional(),
    caste: z.string().optional(),
    gotra: z.string().optional(),
    birth_time: z
      .string()
      .trim()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Enter a valid time (HH:MM)")
      .optional()
      .or(z.literal("")),
    birth_place: z.string().trim().max(120).optional().or(z.literal("")),
    rashi: z.string().optional(),
    nakshatra: z.string().optional(),
    nakshatra_pada: z.string().optional(),
    manglik: z.string().optional(),
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
    profession: z.string().trim().min(2, "Select or enter your profession").max(80),
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
    pref_min_age: z.string().optional(),
    pref_max_age: z.string().optional(),
    pref_min_height: z.string().optional(),
    pref_max_height: z.string().optional(),
    pref_marital_status: z.string().optional(),
    pref_diet: z.string().optional(),
    pref_relocation: z.string().optional(),
  }),
];

const ONBOARDING_DRAFT_KEY = "alumni_onboarding_draft_v2";

function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { prefill } = Route.useSearch();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const submittedRef = useRef(false);
  const [dob, setDob] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const birthYears = Array.from({ length: 50 }, (_, i) => year - 21 - i);
  const graduationYears = Array.from({ length: year + 2 - 1960 + 1 }, (_, i) => year + 2 - i);
  const [customDegreeSelected, setCustomDegreeSelected] = useState(false);
  const [customProfessionSelected, setCustomProfessionSelected] = useState(false);
  const [customCitySelected, setCustomCitySelected] = useState(false);
  const [customCasteSelected, setCustomCasteSelected] = useState(false);
  const [customGotraSelected, setCustomGotraSelected] = useState(false);

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
          JSON.stringify({
            step,
            f,
            dob,
            selectedState,
            customCitySelected,
            customDegreeSelected,
            customProfessionSelected,
            customCasteSelected,
            customGotraSelected,
          }),
        );
      } catch {
        /* storage quota */
      }
    }
  }, [
    step,
    f,
    dob,
    selectedState,
    customCitySelected,
    customDegreeSelected,
    customProfessionSelected,
    customCasteSelected,
    customGotraSelected,
    me.data?.onboarded,
  ]);

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
            customCitySelected?: boolean;
            customDegreeSelected?: boolean;
            customProfessionSelected?: boolean;
            customCasteSelected?: boolean;
            customGotraSelected?: boolean;
          };
          if (draft && typeof draft === "object" && draft.f) {
            setF((prev) => ({ ...prev, ...draft.f }));
            if (typeof draft.step === "number" && draft.step >= 0 && draft.step < steps.length) {
              setStep(draft.step);
            }
            if (draft.dob) setDob(draft.dob);
            if (draft.selectedState) setSelectedState(draft.selectedState);
            if (typeof draft.customCitySelected === "boolean") {
              setCustomCitySelected(draft.customCitySelected);
            }
            if (typeof draft.customDegreeSelected === "boolean") {
              setCustomDegreeSelected(draft.customDegreeSelected);
            }
            if (typeof draft.customProfessionSelected === "boolean") {
              setCustomProfessionSelected(draft.customProfessionSelected);
            }
            if (typeof draft.customCasteSelected === "boolean") {
              setCustomCasteSelected(draft.customCasteSelected);
            }
            if (typeof draft.customGotraSelected === "boolean") {
              setCustomGotraSelected(draft.customGotraSelected);
            }
            loaded.current = true;
            return;
          }
        }
      } catch {
        /* ignore invalid draft */
      }
    }

    if (prefill === "1") {
      try {
        const raw = localStorage.getItem(APPLY_DRAFT_KEY);
        if (raw) {
          const draft = JSON.parse(raw) as Partial<Form> & {
            name?: string;
            selectedState?: string;
            dob?: string;
            gradYear?: string;
            country?: string;
            state?: string;
            values?: string;
          };
          const derivedBirthYear = draft.birth_year
            ? String(draft.birth_year)
            : draft.dob
              ? draft.dob.split("-")[0]
              : "";
          setF((prev) => ({
            ...prev,
            full_name: draft.full_name ?? draft.name ?? prev.full_name,
            gender: draft.gender ?? prev.gender,
            birth_year: derivedBirthYear || prev.birth_year,
            city: draft.city ?? prev.city,
            institution: draft.institution ?? prev.institution,
            degree: draft.degree ?? prev.degree,
            grad_year: draft.grad_year
              ? String(draft.grad_year)
              : draft.gradYear
                ? String(draft.gradYear)
                : prev.grad_year,
            profession: draft.profession ?? prev.profession,
            relocation: draft.relocation ?? prev.relocation,
            values_statement: draft.values_statement ?? draft.values ?? prev.values_statement,
            created_by: draft.created_by ?? prev.created_by,
            marital_status: draft.marital_status ?? prev.marital_status,
            diet: draft.diet ?? prev.diet,
            mother_tongue: draft.mother_tongue ?? prev.mother_tongue,
            residency_status: draft.country ?? draft.residency_status ?? prev.residency_status,
            religion: draft.religion ?? prev.religion,
            caste: draft.caste ?? prev.caste,
            gotra: draft.gotra ?? prev.gotra,
            height_cm: draft.height_cm ? String(draft.height_cm) : prev.height_cm,
            employer: draft.employer ?? prev.employer,
            bio: draft.bio ?? prev.bio,
            birth_time: draft.birth_time ?? prev.birth_time,
            birth_place: draft.birth_place ?? prev.birth_place,
            rashi: draft.rashi ?? prev.rashi,
            nakshatra: draft.nakshatra ?? prev.nakshatra,
            nakshatra_pada: draft.nakshatra_pada
              ? String(draft.nakshatra_pada)
              : prev.nakshatra_pada,
            manglik: draft.manglik ?? prev.manglik,
          }));
          if (draft.dob) {
            setDob(draft.dob);
          } else if (draft.birth_year) {
            setDob(`${draft.birth_year}-01-01`);
          }
          const draftCity = draft.city;
          const resolvedState =
            draft.state ?? draft.selectedState ?? (draftCity ? detectStateFromCity(draftCity) : "");
          if (resolvedState) {
            setSelectedState(resolvedState);
            const cities = MAJOR_CITIES_BY_STATE[resolvedState] ?? [];
            if (draftCity && !cities.includes(draftCity)) {
              setCustomCitySelected(true);
            }
          }

          if (draft.degree && !DEGREES.includes(draft.degree as (typeof DEGREES)[number])) {
            setCustomDegreeSelected(true);
          }
          if (
            draft.profession &&
            !PROFESSIONS.includes(draft.profession as (typeof PROFESSIONS)[number]) &&
            draft.profession !== "Other"
          ) {
            setCustomProfessionSelected(true);
          }
          if (
            draft.caste &&
            !CASTES.includes(draft.caste as (typeof CASTES)[number]) &&
            draft.caste !== "Other"
          ) {
            setCustomCasteSelected(true);
          }
          if (
            draft.gotra &&
            !GOTRAS.includes(draft.gotra as (typeof GOTRAS)[number]) &&
            draft.gotra !== "Other"
          ) {
            setCustomGotraSelected(true);
          }
          prefilled = true;
        }
      } catch {
        /* storage unreadable */
      }
    }

    if (!prefilled && data) {
      setF({
        full_name: data.full_name ?? "",
        created_by: data.created_by ?? "Self",
        gender: data.gender ?? "",
        birth_year: data.birth_year ? String(data.birth_year) : "",
        city: data.city ?? "",
        height_cm: data.height_cm ? String(data.height_cm) : "",
        marital_status: data.marital_status ?? "",
        diet: data.diet ?? "",
        mother_tongue: data.mother_tongue ?? "",
        residency_status: data.residency_status ?? "",
        religion: data.religion ?? "",
        caste: data.caste ?? "",
        gotra: data.gotra ?? "",
        birth_time: data.birth_time ?? "",
        birth_place: data.birth_place ?? "",
        rashi: data.rashi ?? "",
        nakshatra: data.nakshatra ?? "",
        nakshatra_pada: data.nakshatra_pada ? String(data.nakshatra_pada) : "",
        manglik: data.manglik ?? "",
        institution: data.institution ?? "",
        degree: data.degree ?? "",
        grad_year: data.grad_year ? String(data.grad_year) : "",
        profession: data.profession ?? "",
        employer: data.employer ?? "",
        relocation: data.relocation ?? "",
        values_statement: data.values_statement ?? "",
        bio: data.bio ?? "",
        is_visible: data.is_visible ?? true,
        pref_min_age: "",
        pref_max_age: "",
        pref_min_height: "",
        pref_max_height: "",
        pref_marital_status: "",
        pref_diet: "",
        pref_relocation: "",
      });
      if (data.birth_year) setDob(`${data.birth_year}-01-01`);
      if (data.city) setSelectedState(detectStateFromCity(data.city));

      if (data.degree && !DEGREES.includes(data.degree as (typeof DEGREES)[number])) {
        setCustomDegreeSelected(true);
      }
      if (
        data.profession &&
        !PROFESSIONS.includes(data.profession as (typeof PROFESSIONS)[number]) &&
        data.profession !== "Other"
      ) {
        setCustomProfessionSelected(true);
      }
      if (
        data.caste &&
        !CASTES.includes(data.caste as (typeof CASTES)[number]) &&
        data.caste !== "Other"
      ) {
        setCustomCasteSelected(true);
      }
      if (
        data.gotra &&
        !GOTRAS.includes(data.gotra as (typeof GOTRAS)[number]) &&
        data.gotra !== "Other"
      ) {
        setCustomGotraSelected(true);
      }
    }
    loaded.current = true;
  }, [me.data, me.isLoading, prefill]);

  async function next() {
    setErrors({});
    const schema = schemas[step];
    if (!schema) return;
    const res = schema.safeParse(f);
    if (!res.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of res.error.issues) {
        const path = issue.path[0];
        if (typeof path === "string" && !fieldErrors[path]) {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      const first = res.error.issues[0]?.message ?? "Please check the form.";
      toast.error(first);
      return;
    }
    if (step < steps.length - 1) {
      setStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    await finish();
  }

  async function finish() {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Please sign in first.");

      const profileUpdates: Database["public"]["Tables"]["profiles"]["Update"] = {
        full_name: f.full_name,
        created_by: f.created_by || "Self",
        gender: f.gender,
        birth_year: Number(f.birth_year),
        city: f.city,
        height_cm: f.height_cm ? Number(f.height_cm) : null,
        marital_status: f.marital_status || null,
        diet: f.diet || null,
        mother_tongue: f.mother_tongue || null,
        residency_status: f.residency_status || null,
        religion: f.religion || null,
        caste: f.caste || null,
        gotra: f.gotra || null,
        birth_time: f.birth_time || null,
        birth_place: f.birth_place || null,
        rashi: f.rashi || null,
        nakshatra: f.nakshatra || null,
        nakshatra_pada: f.nakshatra_pada ? Number(f.nakshatra_pada) : null,
        manglik: f.manglik || null,
        institution: f.institution,
        degree: f.degree,
        grad_year: Number(f.grad_year),
        profession: f.profession,
        employer: f.employer,
        relocation: f.relocation,
        values_statement: f.values_statement,
        bio: f.bio,
        is_visible: f.is_visible,
        onboarded: true,
      };

      const { error } = await supabase.from("profiles").update(profileUpdates).eq("id", u.user.id);

      if (error && error.message?.includes("column")) {
        console.warn("Retrying profile save without community/horoscope columns:", error.message);
        const {
          religion,
          caste,
          gotra,
          created_by,
          birth_time,
          birth_place,
          rashi,
          nakshatra,
          nakshatra_pada,
          manglik,
          ...safeUpdates
        } = profileUpdates;
        const retry = await supabase.from("profiles").update(safeUpdates).eq("id", u.user.id);
        if (retry.error) throw retry.error;
      } else if (error) {
        throw error;
      }

      // Save partner preferences if any were set
      const minAgeNum = f.pref_min_age ? Number(f.pref_min_age) : null;
      const maxAgeNum = f.pref_max_age ? Number(f.pref_max_age) : null;
      const minHNum = f.pref_min_height ? Number(f.pref_min_height) : null;
      const maxHNum = f.pref_max_height ? Number(f.pref_max_height) : null;
      const maritalArr = f.pref_marital_status ? [f.pref_marital_status] : [];
      const dietArr = f.pref_diet ? [f.pref_diet] : [];
      const relocArr = f.pref_relocation ? [f.pref_relocation] : [];

      if (
        minAgeNum ||
        maxAgeNum ||
        minHNum ||
        maxHNum ||
        maritalArr.length ||
        dietArr.length ||
        relocArr.length
      ) {
        const { error: prefErr } = await supabase.from("partner_preferences").upsert(
          {
            user_id: u.user.id,
            min_age: minAgeNum,
            max_age: maxAgeNum,
            min_height_cm: minHNum,
            max_height_cm: maxHNum,
            marital_statuses: maritalArr,
            diets: dietArr,
            relocations: relocArr,
          },
          { onConflict: "user_id" },
        );
        if (prefErr) throw prefErr;
        void queryClient.invalidateQueries({ queryKey: ["partner-preferences"] });
      }

      submittedRef.current = true;

      try {
        localStorage.removeItem(APPLY_DRAFT_KEY);
        localStorage.removeItem(ONBOARDING_DRAFT_KEY);
      } catch {
        /* ignore */
      }

      queryClient.setQueryData(MY_PROFILE_KEY, (old: MyProfileRow | null | undefined) => {
        if (!old) return old;
        return {
          ...old,
          ...profileUpdates,
          onboarded: true,
        };
      });
      void queryClient.invalidateQueries({ queryKey: MY_PROFILE_KEY });

      if (!me.data?.onboarded) {
        void Promise.all([
          recordConsent(
            "terms_and_privacy",
            true,
            "Membership terms and privacy notice accepted at onboarding",
          ),
          recordConsent(
            "partnership_criteria",
            true,
            "Partnership criteria and profile details may be used for matching",
          ),
        ]).then((results) => {
          if (results.some((r) => !r.ok)) {
            toast.error(
              "Your profile was saved, but we could not record your consent receipt. Please contact the membership desk.",
            );
          }
        });
      }

      const isEdit = me.data?.onboarded;
      toast.success(
        isEdit ? "Profile updated successfully." : "Profile saved. Welcome to the Circle.",
      );
      navigate({ to: "/dashboard" });
    } catch (e) {
      setSaving(false);
      toast.error(
        e instanceof Error ? e.message : "Could not save your profile. Please try again.",
      );
    }
  }

  if (me.isError) {
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
        <div className="mb-4 flex items-center justify-between">
          <Link
            to="/dashboard"
            className="inline-flex items-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to membership desk
          </Link>
          {me.data?.id && (
            <Link
              to="/members/$id"
              params={{ id: me.data.id }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brass hover:text-brass-strong transition-colors"
            >
              <Eye className="size-3.5" />
              Preview My Profile
            </Link>
          )}
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
            <span className="sr-only sm:hidden">{i === step ? `${s} (current step)` : s}</span>
          </li>
        ))}
      </ol>

      <form
        className="mt-10 grid gap-5 border border-border bg-card p-6 md:p-8"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void next();
        }}
      >
        {step === 0 && (
          <StepAboutYou
            f={f}
            set={set}
            errors={errors}
            dob={dob}
            setDob={setDob}
            selectedState={selectedState}
            setSelectedState={setSelectedState}
            customCitySelected={customCitySelected}
            setCustomCitySelected={setCustomCitySelected}
            customCasteSelected={customCasteSelected}
            setCustomCasteSelected={setCustomCasteSelected}
            customGotraSelected={customGotraSelected}
            setCustomGotraSelected={setCustomGotraSelected}
            year={year}
            birthYears={birthYears}
          />
        )}
        {step === 1 && (
          <StepEducation
            f={f}
            set={set}
            errors={errors}
            customDegreeSelected={customDegreeSelected}
            setCustomDegreeSelected={setCustomDegreeSelected}
            graduationYears={graduationYears}
          />
        )}
        {step === 2 && (
          <StepCareer
            f={f}
            set={set}
            errors={errors}
            customProfessionSelected={customProfessionSelected}
            setCustomProfessionSelected={setCustomProfessionSelected}
          />
        )}
        {step === 3 && <StepValues f={f} set={set} errors={errors} />}

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
