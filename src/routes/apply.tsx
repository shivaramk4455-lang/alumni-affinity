import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { canonical, ogUrl } from "@/lib/seo";
import {
  APPLY_DRAFT_KEY,
  APPLY_STEPS,
  loadApplyDraft,
  type ApplyDraft,
} from "@/components/apply/types";

export { APPLY_DRAFT_KEY };
import { StepIdentity } from "@/components/apply/step-identity";
import { StepEducation } from "@/components/apply/step-education";
import { StepTrajectory } from "@/components/apply/step-trajectory";
import { StepVisibility } from "@/components/apply/step-visibility";
import { StepCopilot } from "@/components/apply/step-copilot";
import { validateApplyStep } from "@/lib/apply-validation";

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
      ogUrl("/apply"),
    ],
    links: [canonical("/apply")],
  }),
  component: ApplyPage,
});

function ApplyPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [draft, setDraft] = useState<ApplyDraft>(loadApplyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      localStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage unavailable */
    }
  }, [draft]);

  const handleChange = <K extends keyof ApplyDraft>(k: K, v: ApplyDraft[K]) => {
    setDraft((p) => ({ ...p, [k]: v }));
    setErrors((prev) => {
      const keyStr = String(k);
      const toRemove = [keyStr];
      if (k === "copilotEmail") toRemove.push("copilot-email");
      if (k === "copilotName") toRemove.push("copilot-name", "custom-copilot-name");
      if (k === "city") toRemove.push("custom-city");
      if (k === "profession") toRemove.push("custom-profession");
      if (k === "degree") toRemove.push("custom-degree");

      let hasMatch = false;
      for (const r of toRemove) {
        if (prev[r]) {
          hasMatch = true;
          break;
        }
      }
      if (!hasMatch) return prev;

      const next = { ...prev };
      for (const r of toRemove) {
        delete next[r];
      }
      return next;
    });
  };

  function validate(form: HTMLFormElement) {
    const required = [
      ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "[required]",
      ),
    ];
    const requiredFieldValues: Record<string, string> = {};
    required.forEach((f) => {
      requiredFieldValues[f.name] = f.value;
    });

    const nextErrors = validateApplyStep(step, draft, requiredFieldValues);
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate(event.currentTarget)) {
      const first = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (step < APPLY_STEPS.length - 1) {
      setStep((val) => val + 1);
      setErrors({});
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setCompleted(true);
    }
  }

  function continueToSignup() {
    navigate({ to: "/auth", search: { redirect: "/onboarding?prefill=1" } });
  }

  if (completed) {
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
  }

  return (
    <main className="min-h-dvh bg-background">
      <section className="border-b border-border bg-secondary/45 px-5 py-10 md:px-8 md:py-14">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass">
            The Merit Circle
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <h1 className="font-serif text-4xl font-semibold text-foreground md:text-5xl">
                Membership Application
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Takes approximately 8 minutes. Your draft is securely kept on this device until you
                create an account.
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
          {APPLY_STEPS.map((label, index) => (
            <li
              key={label}
              className="min-w-0 text-center"
              aria-current={index === step ? "step" : undefined}
            >
              <div
                className={`mx-auto grid size-7 place-items-center rounded-full border text-xs font-bold ${
                  index < step
                    ? "border-success bg-success text-success-foreground"
                    : index === step
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground"
                }`}
              >
                {index < step ? <Check className="size-3.5" /> : index + 1}
              </div>
              <span
                className={`mt-2 hidden text-xs font-semibold sm:block ${
                  index === step ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
              <span className="sr-only sm:hidden">
                {index === step ? `${label} (current step)` : label}
              </span>
            </li>
          ))}
        </ol>

        <form onSubmit={submit} noValidate className="mx-auto mt-10 max-w-3xl">
          {step === 0 && <StepIdentity draft={draft} onChange={handleChange} errors={errors} />}
          {step === 1 && <StepEducation draft={draft} onChange={handleChange} errors={errors} />}
          {step === 2 && <StepTrajectory draft={draft} onChange={handleChange} errors={errors} />}
          {step === 3 && <StepVisibility draft={draft} onChange={handleChange} />}
          {step === 4 && <StepCopilot draft={draft} onChange={handleChange} errors={errors} />}

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
              {step === APPLY_STEPS.length - 1 ? "Save & create account" : "Continue"}
              <ArrowRight />
            </Button>
          </div>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Saved automatically on this device as you type — nothing leaves your browser until
            signup.
          </p>
        </form>
      </div>
    </main>
  );
}
