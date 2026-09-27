import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useMyProfile } from "@/hooks/use-my-profile";
import { recordConsent } from "@/lib/consent";
import { supabase } from "@/integrations/supabase/client";
import {
  DIETS,
  GENDERS,
  INSTITUTIONS,
  MARITAL_STATUSES,
  MOTHER_TONGUES,
  RELOCATION,
  RESIDENCY_STATUSES,
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
    degree: z.string().trim().min(2, "Enter degree").max(80),
    grad_year: z.coerce
      .number()
      .int()
      .min(1960)
      .max(year + 2),
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

function Onboarding() {
  const navigate = useNavigate();
  const { prefill } = Route.useSearch();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Form, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const me = useMyProfile();
  const loaded = useRef(false);

  // Seed the form from the member's own row once (via the security-definer
  // view), then layer the application draft over it when prefill=1.
  useEffect(() => {
    if (loaded.current || me.isLoading) return;
    const data = me.data;
    let prefilled = false;
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
          void (async () => {
            if (!str("alumniEmail")) return;
            const { data: u } = await supabase.auth.getUser();
            if (!u.user) return;
            await supabase
              .from("profiles")
              .update({ alumni_email: str("alumniEmail").trim().toLowerCase() })
              .eq("id", u.user.id);
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
    }
    loaded.current = true;
  }, [me.data, me.isLoading, prefill]);

  async function next() {
    const r = schemas[step]!.safeParse(f);
    if (!r.success) {
      toast.error(r.error.issues[0]?.message ?? "Check your details");
      return;
    }
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const heightNum = f.height_cm.trim() ? Number(f.height_cm.trim()) : null;
    const { error } = await supabase
      .from("profiles")
      .update({
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
      })
      .eq("id", u.user!.id);
    setSaving(false);
    if (error) {
      toast.error("Could not save your profile. Please try again.");
      return;
    }
    try {
      localStorage.removeItem(APPLY_DRAFT_KEY);
    } catch {
      /* ignore */
    }
    // Onboarding is where the member accepts the membership terms, the privacy
    // notice and the use of their stated criteria for matching. The ledger row
    // is written once, on the transition to onboarded = true.
    if (!me.data?.onboarded) {
      await recordConsent(
        "terms_and_privacy",
        true,
        "Membership terms and privacy notice accepted at onboarding",
      );
      await recordConsent(
        "partnership_criteria",
        true,
        "Partnership criteria and profile details may be used for matching",
      );
    }
    const isEdit = me.data?.onboarded;
    toast.success(
      isEdit ? "Profile updated successfully." : "Profile saved. Welcome to the Circle.",
    );
    navigate({ to: isEdit ? "/dashboard" : "/members" });
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        {me.data?.onboarded ? "Edit member profile" : "Member onboarding"}
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">{steps[step]}</h1>
      <ol className="mt-8 grid grid-cols-4 gap-2" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className="grid gap-2">
            <span className={`h-1 ${i <= step ? "bg-primary" : "bg-border"}`} />
            <span
              className={`hidden text-xs sm:flex items-center gap-1 ${i === step ? "text-foreground" : "text-muted-foreground"}`}
            >
              {i < step && <Check className="size-3" />}
              {s}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-5 border border-border bg-card p-6 md:p-8">
        {step === 0 && (
          <>
            <Field label="Full name">
              <Input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Gender">
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
              <Field label="Birth year">
                <Input
                  inputMode="numeric"
                  value={f.birth_year}
                  onChange={(e) => set("birth_year", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Current city">
                <Input value={f.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="Height (cm, optional)">
                <Input
                  inputMode="numeric"
                  placeholder="e.g. 175"
                  value={f.height_cm}
                  onChange={(e) => set("height_cm", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
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
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
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
              <Field label="Residency / Nationality (optional)">
                <select
                  className={selectCls}
                  value={f.residency_status}
                  onChange={(e) => set("residency_status", e.target.value)}
                >
                  <option value="">Select</option>
                  {RESIDENCY_STATUSES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Institution">
              <select
                className={selectCls}
                value={f.institution}
                onChange={(e) => set("institution", e.target.value)}
              >
                <option value="">Select</option>
                {INSTITUTIONS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Degree">
                <Input
                  placeholder="B.Tech, MBA…"
                  value={f.degree}
                  onChange={(e) => set("degree", e.target.value)}
                />
              </Field>
              <Field label="Graduation year">
                <Input
                  inputMode="numeric"
                  value={f.grad_year}
                  onChange={(e) => set("grad_year", e.target.value)}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Institution verification via alumni email or document review follows after onboarding.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Profession">
                <Input value={f.profession} onChange={(e) => set("profession", e.target.value)} />
              </Field>
              <Field label="Organisation (optional)">
                <Input value={f.employer} onChange={(e) => set("employer", e.target.value)} />
              </Field>
            </div>
            <Field label="Relocation">
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
            <Field label="What matters to you in a partnership">
              <Textarea
                rows={4}
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
      </div>

      <div className="mt-6 flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </Button>
        <Button onClick={next} disabled={saving}>
          {step === steps.length - 1
            ? saving
              ? "Saving…"
              : me.data?.onboarded
                ? "Save changes"
                : "Finish"
            : "Continue"}
        </Button>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
