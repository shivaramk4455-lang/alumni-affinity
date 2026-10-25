import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { UserRoundPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RELATIONS } from "@/lib/profile-options";
import { FormField, FieldError, ApplyStepContainer } from "./form-field";
import type { ApplyDraft } from "./types";

export interface StepCopilotProps {
  draft: ApplyDraft;
  onChange: <K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) => void;
  errors: Record<string, string>;
}

export function StepCopilot({ draft, onChange, errors }: StepCopilotProps) {
  const [customRelationSelected, setCustomRelationSelected] = useState(false);
  const isCustomRelation = Boolean(
    draft.copilotName &&
    !RELATIONS.includes(draft.copilotName as (typeof RELATIONS)[number]) &&
    draft.copilotName !== "Other",
  );

  return (
    <ApplyStepContainer
      title="Family co-pilot (optional)"
      note="You remain in control. A co-pilot can suggest profiles and discuss, but cannot message or accept introductions on your behalf."
    >
      <div className="flex items-start justify-between gap-5 border border-border bg-secondary/35 p-5">
        <div className="flex gap-3">
          <UserRoundPlus className="mt-0.5 size-5 shrink-0 text-brass" />
          <div>
            <p className="font-semibold text-foreground">Add a co-pilot now</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              You can invite a parent or trusted family member now, or add them later from your
              account settings.
            </p>
          </div>
        </div>
        <Switch
          checked={draft.invite}
          onCheckedChange={(v) => onChange("invite", v)}
          aria-label="Invite co-pilot"
        />
      </div>

      {draft.invite && (
        <div className="mt-5 grid items-start gap-5 sm:grid-cols-2">
          <FormField label="Co-pilot relationship">
            <select
              name="copilot-name"
              value={
                isCustomRelation || customRelationSelected
                  ? "Other"
                  : RELATIONS.includes(draft.copilotName as (typeof RELATIONS)[number])
                    ? draft.copilotName
                    : draft.copilotName
                      ? "Other"
                      : ""
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === "Other") {
                  setCustomRelationSelected(true);
                  if (RELATIONS.includes(draft.copilotName as (typeof RELATIONS)[number])) {
                    onChange("copilotName", "");
                  }
                } else {
                  setCustomRelationSelected(false);
                  onChange("copilotName", val);
                }
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
            >
              <option value="" disabled>
                Select relationship
              </option>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {errors["copilot-name"] && <FieldError text={errors["copilot-name"]} />}
          </FormField>

          <FormField label="Co-pilot email">
            <Input
              name="copilot-email"
              type="email"
              maxLength={255}
              placeholder="family@example.com"
              className="h-10"
              value={draft.copilotEmail}
              onChange={(e) => onChange("copilotEmail", e.target.value)}
            />
            {errors["copilot-email"] && <FieldError text={errors["copilot-email"]} />}
          </FormField>

          {(isCustomRelation || customRelationSelected) && (
            <div className="sm:col-span-2">
              <FormField label="Specify name or relation">
                <Input
                  name="custom-copilot-name"
                  maxLength={100}
                  placeholder="e.g. Elder Brother, Family Mentor, Meera…"
                  className="h-10"
                  value={draft.copilotName}
                  onChange={(e) => onChange("copilotName", e.target.value)}
                />
                {errors["custom-copilot-name"] && (
                  <FieldError text={errors["custom-copilot-name"]} />
                )}
              </FormField>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-3 border border-border bg-secondary/30 p-4">
        <div className="flex items-start gap-3">
          <input
            id="adult-attestation"
            name="adult"
            type="checkbox"
            className="mt-0.5 size-6 shrink-0 accent-[var(--brass-strong)]"
            checked={draft.adult}
            onChange={(e) => onChange("adult", e.target.checked)}
            aria-required="true"
            aria-invalid={errors["adult"] ? true : undefined}
            aria-describedby={errors["adult"] ? "adult-attestation-error" : undefined}
          />
          <label
            htmlFor="adult-attestation"
            className="text-sm font-semibold leading-6 text-foreground"
          >
            I confirm I am 21 years of age or older and the information I have given is accurate.
          </label>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Membership is open to adults aged 21 and above. Your date of birth is verified against
          official identity documents during desk review.
        </p>
        {errors["adult"] && (
          <p id="adult-attestation-error" role="alert" className="text-sm text-destructive">
            {errors["adult"]}
          </p>
        )}
      </div>

      <div className="mt-6 text-sm leading-6 text-muted-foreground">
        By continuing, you confirm that the information provided is accurate and agree to our{" "}
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
    </ApplyStepContainer>
  );
}
