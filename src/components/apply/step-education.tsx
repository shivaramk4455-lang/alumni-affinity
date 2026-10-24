import { Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { INSTITUTIONS, isRecognisedAlumniEmail } from "@/lib/profile-options";
import { FormField, FieldError, ApplyStepContainer } from "./form-field";
import type { ApplyDraft } from "./types";

export interface StepEducationProps {
  draft: ApplyDraft;
  onChange: <K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) => void;
  errors: Record<string, string>;
}

export function StepEducation({ draft, onChange, errors }: StepEducationProps) {
  const alumniRecognised = draft.alumniEmail.trim()
    ? isRecognisedAlumniEmail(draft.alumniEmail.trim())
    : null;

  return (
    <ApplyStepContainer
      title="Confirm your academic record"
      note="We verify directly through alumni channels or a graduation document after signup."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Institution">
          <select
            name="institution"
            required
            value={draft.institution}
            onChange={(e) => onChange("institution", e.target.value)}
            className="h-10 w-full border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="" disabled>
              Select institution
            </option>
            {INSTITUTIONS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          {errors["institution"] && <FieldError text={errors["institution"]} />}
        </FormField>
        <FormField label="Degree & graduation year">
          <Input
            name="degree"
            required
            maxLength={100}
            placeholder="B.Tech, 2017"
            value={draft.degree}
            onChange={(e) => onChange("degree", e.target.value)}
          />
          {errors["degree"] && <FieldError text={errors["degree"]} />}
        </FormField>
      </div>
      <div className="mt-6">
        <FormField
          label="Institutional email (optional)"
          hint={
            alumniRecognised === true
              ? "Domain recognised — fast-tracks your academic verification."
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
            value={draft.alumniEmail}
            onChange={(e) => onChange("alumniEmail", e.target.value)}
          />
          {errors["alumniEmail"] && <FieldError text={errors["alumniEmail"]} />}
        </FormField>
      </div>
      <div className="mt-6 border border-border bg-secondary/35 p-4 text-sm leading-6 text-muted-foreground">
        <Mail className="mr-2 inline size-4 text-forest-ink" />
        Degree documents are uploaded privately in verification, after you create an account — never
        shown to members.
      </div>
    </ApplyStepContainer>
  );
}
