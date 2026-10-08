import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  FileCheck2,
  LockKeyhole,
  Mail,
  Upload,
  UserRoundPlus,
} from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  INSTITUTIONS,
  PROFESSION_GROUPS,
  PROFESSIONS,
  RELOCATION,
  isRecognisedAlumniEmail,
} from "@/lib/profile-options";

export const Route = createFileRoute("/apply")({
  head: () => ({
    meta: [
      { title: "Membership Application — The Merit Circle" },
      {
        name: "description",
        content: "Apply for private, verified membership in The Merit Circle.",
      },
      { property: "og:title", content: "Membership Application — The Merit Circle" },
      {
        property: "og:description",
        content: "A discreet, candidate-led application for premier-institute alumni.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://themeritcircle.in/apply" }],
  }),
  component: ApplyPage,
});

const steps = ["Identity", "Education", "Trajectory", "Profile", "Co-pilot"];
export const APPLY_DRAFT_KEY = "merit-circle-apply-draft";

type Draft = {
  name: string;
  dob: string;
  email: string;
  phone: string;
  institution: string;
  degree: string;
  alumniEmail: string;
  profession: string;
  city: string;
  relocation: string;
  chapter: string;
  values: string;
  ghost: boolean;
  photosAfterInterest: boolean;
  invite: boolean;
  copilotName: string;
  copilotEmail: string;
  /** Adult age attestation: required before the application can finish. */
  adult: boolean;
};

const emptyDraft: Draft = {
  name: "",
  dob: "",
  email: "",
  phone: "",
  institution: "",
  degree: "",
  alumniEmail: "",
  profession: "",
  city: "",
  relocation: "",
  chapter: "",
  values: "",
  ghost: true,
  photosAfterInterest: true,
  invite: true,
  copilotName: "",
  copilotEmail: "",
  adult: false,
};

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(APPLY_DRAFT_KEY);
    if (raw) return { ...emptyDraft, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* fresh draft */
  }
  return emptyDraft;
}

/**
 * A form field: label text, one control, an optional hint and an optional
 * inline error.
 *
 * The label is explicitly associated with the control via a generated id
 * (`htmlFor`/`id`), and the hint/error are linked with `aria-describedby` and
 * announced with `role="alert"` — rather than being extra children inside a
 * wrapping `<label>`, which both failed to associate them (no ids) and made
 * the error text part of the control's *accessible name*, so a screen reader
 * would announce "Full legal name Please complete this field." on focus.
 */
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  const errId = `${id}-error`;
  const hintId = `${id}-hint`;

  const items = Children.toArray(children);
  const errorNode = items.find((c) => isValidElement(c) && c.type === Error);
  const control = items.find((c) => !(isValidElement(c) && c.type === Error));
  const hasError = Boolean(errorNode);

  const describedBy = [hint ? hintId : null, hasError ? errId : null].filter(Boolean).join(" ");

  const wired = isValidElement(control)
    ? cloneElement(control as ReactElement<Record<string, unknown>>, {
        id,
        "aria-invalid": hasError ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })
    : control;

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      {wired}
      {hint && (
        <span id={hintId} className="text-sm font-normal leading-6 text-muted-foreground">
          {hint}
        </span>
      )}
      {isValidElement(errorNode)
        ? cloneElement(errorNode as ReactElement<Record<string, unknown>>, { id: errId })
        : null}
    </div>
  );
}

function ApplyPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [d, setD] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customProfessionSelected, setCustomProfessionSelected] = useState(false);
  const isCustomProfession = Boolean(
    d.profession &&
    !PROFESSIONS.includes(d.profession as (typeof PROFESSIONS)[number]) &&
    d.profession !== "Other",
  );

  useEffect(() => {
    setD(loadDraft());
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* storage unavailable */
    }
  }, [d]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  function validate(form: HTMLFormElement) {
    const required = [
      ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "[required]",
      ),
    ];
    const nextErrors: Record<string, string> = {};
    required.forEach((field) => {
      if (!field.value.trim()) nextErrors[field.name] = "Please complete this field.";
    });
    if (
      step === 1 &&
      d.alumniEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.alumniEmail.trim())
    ) {
      nextErrors["alumniEmail"] =
        "Enter a valid institutional email, or leave it blank and verify with a document later.";
    }
    if (
      step === 4 &&
      d.invite &&
      d.copilotEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.copilotEmail.trim())
    ) {
      nextErrors["copilot-email"] = "Enter a valid email for your co-pilot.";
    }
    // Server-enforced age gate has a client-side twin: membership is for
    // adults 21+ (terms of membership), matching the database CHECK on
    // profiles.birth_year and the onboarding schema. A date of birth implying
    // someone younger cannot proceed, and can never satisfy the draft.
    if (step === 0 && d.dob.trim()) {
      const dob = new Date(`${d.dob.trim()}T00:00:00`);
      if (Number.isNaN(dob.getTime())) {
        nextErrors["dob"] = "Enter your date of birth as a calendar date.";
      } else {
        const now = new Date();
        let age = now.getFullYear() - dob.getFullYear();
        if (
          now.getMonth() < dob.getMonth() ||
          (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())
        ) {
          age -= 1;
        }
        if (age < 21) nextErrors["dob"] = "Membership is open to members aged 21 or over.";
      }
    }
    if (step === steps.length - 1 && !d.adult) {
      nextErrors["adult"] = "Please confirm the adult attestation to finish your application.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate(event.currentTarget)) {
      // Focus stays on the Continue button after a failed step, so the user has
      // to hunt for the red text. Move focus to the first offending field.
      const first = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (step < steps.length - 1) {
      setStep((value) => value + 1);
      setErrors({});
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else setCompleted(true);
  }

  function continueToSignup() {
    navigate({ to: "/auth", search: { redirect: "/onboarding?prefill=1" } });
  }

  const alumniRecognised = d.alumniEmail.trim()
    ? isRecognisedAlumniEmail(d.alumniEmail.trim())
    : null;

  if (completed)
    return (
      <main className="min-h-[75vh] bg-background px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl border border-border bg-card p-7 text-center shadow-paper md:p-12">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success/10 text-success">
            <Check className="size-6" />
          </span>
          <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-brass">
            Application ready
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold text-foreground md:text-5xl">
            Your answers are saved on this device.
          </h1>
          <p className="mx-auto mt-5 max-w-lg leading-7 text-muted-foreground">
            Create your account next — your application carries over into onboarding automatically,
            and document verification happens privately after signup.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" onClick={continueToSignup}>
              Create account & continue <ArrowRight />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setCompleted(false);
                setStep(0);
                window.scrollTo({ top: 0 });
              }}
            >
              Review answers
            </Button>
          </div>
        </div>
      </main>
    );

  return (
    <main className="min-h-dvh bg-background">
      <section className="border-b border-border bg-secondary/45 px-5 py-10 md:px-8 md:py-14">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass">
            Private membership application
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <h1 className="font-serif text-4xl font-semibold text-foreground md:text-5xl">
                Begin with your own voice.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Approximately 8 minutes. Your answers are kept on this device until you create an
                account.
              </p>
            </div>
            <span className="flex items-center gap-2 text-sm font-semibold text-forest-ink">
              <LockKeyhole className="size-4" /> Encrypted & never publicly listed
            </span>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5 py-8 md:px-8 md:py-12">
        <ol
          className="grid grid-cols-5 border-y border-border py-4"
          aria-label="Application progress"
        >
          {steps.map((label, index) => (
            <li
              key={label}
              className="min-w-0 text-center"
              aria-current={index === step ? "step" : undefined}
            >
              <div
                className={`mx-auto grid size-7 place-items-center rounded-full border text-xs font-bold ${index < step ? "border-success bg-success text-success-foreground" : index === step ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}
              >
                {index < step ? <Check className="size-3.5" /> : index + 1}
              </div>
              <span
                className={`mt-2 hidden text-xs font-semibold sm:block ${index === step ? "text-foreground" : "text-muted-foreground"}`}
              >
                {label}
              </span>
              {/* The visible label is hidden on mobile; keep the step name (and
                  the current-step marker) available to assistive tech there. */}
              <span className="sr-only sm:hidden">
                {index === step ? `${label} (current step)` : label}
              </span>
            </li>
          ))}
        </ol>

        <form onSubmit={submit} noValidate className="mx-auto mt-10 max-w-3xl">
          {step === 0 && (
            <Step
              title="Let’s verify who you are"
              note="Use the details that appear on your government-issued identity document."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Full legal name">
                  <Input
                    name="name"
                    required
                    maxLength={100}
                    placeholder="As shown on your ID"
                    value={d.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                  {errors["name"] && <Error text={errors["name"]} />}
                </Field>
                <Field label="Date of birth">
                  <Input
                    name="dob"
                    type="date"
                    required
                    value={d.dob}
                    onChange={(e) => set("dob", e.target.value)}
                  />
                  {errors["dob"] && <Error text={errors["dob"]} />}
                </Field>
                <Field label="Email address">
                  <Input
                    name="email"
                    type="email"
                    required
                    maxLength={255}
                    placeholder="you@example.com"
                    value={d.email}
                    onChange={(e) => set("email", e.target.value)}
                  />
                  {errors["email"] && <Error text={errors["email"]} />}
                </Field>
                <Field label="Mobile number">
                  <Input
                    name="phone"
                    type="tel"
                    required
                    maxLength={15}
                    placeholder="+91 98765 43210"
                    value={d.phone}
                    onChange={(e) => set("phone", e.target.value)}
                  />
                  {errors["phone"] && <Error text={errors["phone"]} />}
                </Field>
              </div>
              <div className="mt-6 border border-border bg-secondary/35 p-4 text-sm leading-6 text-muted-foreground">
                <FileCheck2 className="mr-2 inline size-4 text-brass" />
                Identity verification is handled independently and your document is never shown to
                members.
              </div>
            </Step>
          )}

          {step === 1 && (
            <Step
              title="Confirm your academic record"
              note="We verify directly through alumni channels or a graduation document after signup."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Institution">
                  <select
                    name="institution"
                    required
                    value={d.institution}
                    onChange={(e) => set("institution", e.target.value)}
                    className="h-10 w-full border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="" disabled>
                      Select institution
                    </option>
                    {INSTITUTIONS.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                  {errors["institution"] && <Error text={errors["institution"]} />}
                </Field>
                <Field label="Degree & graduation year">
                  <Input
                    name="degree"
                    required
                    maxLength={100}
                    placeholder="B.Tech, 2017"
                    value={d.degree}
                    onChange={(e) => set("degree", e.target.value)}
                  />
                  {errors["degree"] && <Error text={errors["degree"]} />}
                </Field>
              </div>
              <div className="mt-6">
                <Field
                  label="Institutional email (optional)"
                  hint={
                    alumniRecognised === true
                      ? "Domain recognised — the desk will fast-track this."
                      : alumniRecognised === false
                        ? "Domain not recognised — you can verify with a document after signup."
                        : "Fastest verification, when your institution address is active. Otherwise verify with a document after signup."
                  }
                >
                  <Input
                    name="alumniEmail"
                    type="email"
                    maxLength={255}
                    placeholder="name@alumni.iitb.ac.in"
                    value={d.alumniEmail}
                    onChange={(e) => set("alumniEmail", e.target.value)}
                  />
                  {errors["alumniEmail"] && <Error text={errors["alumniEmail"]} />}
                </Field>
              </div>
              <div className="mt-6 grid gap-4 border border-border bg-secondary/35 p-4 text-sm leading-6 text-muted-foreground">
                <span>
                  <Mail className="mr-2 inline size-4 text-forest-ink" />
                  Degree documents are uploaded privately in verification, after you create an
                  account — never shown to members.
                </span>
              </div>
            </Step>
          )}

          {step === 2 && (
            <Step
              title="Share your life trajectory"
              note="Give members context beyond titles and credentials."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Current profession">
                  <select
                    name="profession"
                    required
                    value={isCustomProfession || customProfessionSelected ? "Other" : d.profession}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "Other") {
                        setCustomProfessionSelected(true);
                        if (!isCustomProfession) set("profession", "");
                      } else {
                        setCustomProfessionSelected(false);
                        set("profession", val);
                      }
                    }}
                    className="h-10 w-full border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="" disabled>
                      Select profession
                    </option>
                    {PROFESSION_GROUPS.map((group) => (
                      <optgroup key={group.category} label={group.category}>
                        {group.options.map((prof) => (
                          <option key={prof} value={prof}>
                            {prof}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="Other">Other (specify)</option>
                  </select>
                  {errors["profession"] && <Error text={errors["profession"]} />}
                </Field>
                {(isCustomProfession || customProfessionSelected) && (
                  <Field label="Specify profession">
                    <Input
                      name="custom-profession"
                      required
                      maxLength={100}
                      placeholder="e.g. Quantitative Researcher, Aerospace Engineer, Surgeon…"
                      value={d.profession}
                      onChange={(e) => set("profession", e.target.value)}
                    />
                  </Field>
                )}
                <Field label="Current city">
                  <Input
                    name="city"
                    required
                    maxLength={80}
                    placeholder="Bengaluru"
                    value={d.city}
                    onChange={(e) => set("city", e.target.value)}
                  />
                  {errors["city"] && <Error text={errors["city"]} />}
                </Field>
                <Field label="Relocation outlook">
                  <select
                    name="relocation"
                    required
                    value={d.relocation}
                    onChange={(e) => set("relocation", e.target.value)}
                    className="h-10 w-full border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="" disabled>
                      Select preference
                    </option>
                    {RELOCATION.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  {errors["relocation"] && <Error text={errors["relocation"]} />}
                </Field>
                <Field label="Career chapter">
                  <Input
                    name="chapter"
                    required
                    maxLength={120}
                    placeholder="Building, leading, studying…"
                    value={d.chapter}
                    onChange={(e) => set("chapter", e.target.value)}
                  />
                  {errors["chapter"] && <Error text={errors["chapter"]} />}
                </Field>
              </div>
              <div className="mt-5">
                <Field
                  label="What matters in the life you are building?"
                  hint="A thoughtful, specific response works best. Maximum 600 characters."
                >
                  <Textarea
                    name="values"
                    required
                    maxLength={600}
                    className="min-h-32"
                    placeholder="The values, rhythms and ambitions you hope to share…"
                    value={d.values}
                    onChange={(e) => set("values", e.target.value)}
                  />
                  {errors["values"] && <Error text={errors["values"]} />}
                </Field>
              </div>
            </Step>
          )}

          {step === 3 && (
            <Step
              title="Choose how you are seen"
              note="Every profile photo is watermarked. You retain control over who can view it."
            >
              {/* Informational, not interactive: a dashed border plus an
                  upload icon reads as a file picker, but there is no file
                  input here — the upload genuinely happens after signup. Style
                  it as guidance so it does not promise a click. */}
              <div className="flex items-start gap-4 border border-border bg-secondary/40 p-5">
                <Upload className="mt-0.5 size-5 shrink-0 text-brass" />
                <div>
                  <p className="text-sm font-semibold">Add your photograph after signup</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    We take no uploads during application so your document stays private until you
                    have an account. Upload a recent JPG or PNG, portrait preferred.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex items-start justify-between gap-5 border border-border p-5">
                <div>
                  <p className="font-semibold">Ghost mode</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Hide your profile from general discovery. Appear only to people you choose or
                    accept.
                  </p>
                </div>
                <Switch
                  checked={d.ghost}
                  onCheckedChange={(v) => set("ghost", v)}
                  aria-label="Ghost mode"
                />
              </div>
              <div className="mt-3 flex items-start justify-between gap-5 border border-border p-5">
                <div>
                  <p className="font-semibold">Photos after interest</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Keep photos obscured until you approve an interest request.
                  </p>
                </div>
                <Switch
                  checked={d.photosAfterInterest}
                  onCheckedChange={(v) => set("photosAfterInterest", v)}
                  aria-label="Photos after interest"
                />
              </div>
            </Step>
          )}

          {step === 4 && (
            <Step
              title="Invite a family co-pilot"
              note="You remain in control. A co-pilot can suggest and discuss, but cannot message or accept on your behalf."
            >
              <div className="flex items-start justify-between gap-5 border border-border bg-secondary/35 p-5">
                <div className="flex gap-3">
                  <UserRoundPlus className="mt-0.5 size-5 shrink-0 text-brass" />
                  <div>
                    <p className="font-semibold">Add a co-pilot now</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      You can send the invitation after signup, or skip for now.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={d.invite}
                  onCheckedChange={(v) => set("invite", v)}
                  aria-label="Invite co-pilot"
                />
              </div>
              {d.invite && (
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <Field label="Co-pilot name">
                    <Input
                      name="copilot-name"
                      maxLength={100}
                      placeholder="Parent or trusted family member"
                      value={d.copilotName}
                      onChange={(e) => set("copilotName", e.target.value)}
                    />
                  </Field>
                  <Field label="Co-pilot email">
                    <Input
                      name="copilot-email"
                      type="email"
                      maxLength={255}
                      placeholder="family@example.com"
                      value={d.copilotEmail}
                      onChange={(e) => set("copilotEmail", e.target.value)}
                    />
                    {errors["copilot-email"] && <Error text={errors["copilot-email"]} />}
                  </Field>
                </div>
              )}
              <div className="mt-6 grid gap-3 border border-border bg-secondary/30 p-4">
                <div className="flex items-start gap-3">
                  <input
                    id="adult-attestation"
                    name="adult"
                    type="checkbox"
                    className="mt-0.5 size-6 shrink-0 accent-[var(--brass-strong)]"
                    checked={d.adult}
                    onChange={(e) => set("adult", e.target.checked)}
                    aria-required="true"
                    aria-invalid={errors["adult"] ? true : undefined}
                    aria-describedby={errors["adult"] ? "adult-attestation-error" : undefined}
                  />
                  <label htmlFor="adult-attestation" className="text-sm font-semibold leading-6">
                    I confirm I am 21 years of age or older and the information I have given is
                    accurate.
                  </label>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Membership is open to adults only. Your date of birth is checked against this
                  attestation, and the platform refuses an age below 21 independently of what is
                  typed here.
                </p>
                {errors["adult"] && (
                  <p id="adult-attestation-error" role="alert" className="text-sm text-destructive">
                    {errors["adult"]}
                  </p>
                )}
              </div>
              <div className="mt-6 text-sm leading-6 text-muted-foreground">
                By continuing, you confirm that the information provided is accurate and agree to
                our{" "}
                <Link
                  to="/terms"
                  className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
                >
                  membership, privacy, and verification terms
                </Link>{" "}
                and the{" "}
                <Link
                  to="/privacy"
                  className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
                >
                  privacy notice
                </Link>
                .
              </div>
            </Step>
          )}

          {/* `grid-cols-[auto_1fr]` forced two wide lg buttons onto one 320px
              row, scrolling the primary submit control off screen. Stack on
              mobile; the primary action stays last in the tab order. */}
          <div className="mt-9 flex flex-col-reverse gap-4 border-t border-border pt-6 sm:grid sm:grid-cols-[auto_1fr] sm:items-center">
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => {
                  setStep((v) => v - 1);
                  setErrors({});
                }}
              >
                <ArrowLeft /> Back
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            <Button type="submit" size="lg" className="sm:justify-self-end">
              {step === steps.length - 1 ? "Save & create account" : "Continue"}
              <ArrowRight />
            </Button>
          </div>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Saved automatically on this device as you type — nothing leaves your browser until
            signup. The draft is stored in plain text in this browser's storage, so use a shared or
            public computer with care.
          </p>
        </form>
      </div>
    </main>
  );
}

function Step({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brass">Step in confidence</p>
      <h2 className="mt-2 font-serif text-3xl font-semibold md:text-4xl">{title}</h2>
      <p className="mt-3 mb-8 text-sm leading-6 text-muted-foreground">{note}</p>
      {children}
    </section>
  );
}
/**
 * Inline validation message.
 *
 * `role="alert"` makes a screen reader announce it the moment it renders,
 * without the user having to re-focus the field. `id` is injected by Field so
 * the control's `aria-describedby` resolves to it.
 */
function Error({ text, id }: { text: string; id?: string }) {
  return (
    // Validation copy is the text a user most needs to read, so it is not set
    // below the size of the fields it sits under. The icon keeps the failure
    // from being signalled by colour alone.
    <span
      id={id}
      role="alert"
      className="flex items-start gap-1.5 text-sm leading-6 text-destructive"
    >
      <CircleAlert className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </span>
  );
}
