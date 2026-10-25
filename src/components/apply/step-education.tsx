import { useMemo, useState } from "react";
import { Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DEGREES, INSTITUTION_GROUPS, isRecognisedAlumniEmail } from "@/lib/profile-options";
import { FormField, FieldError, ApplyStepContainer } from "./form-field";
import type { ApplyDraft } from "./types";

export interface StepEducationProps {
  draft: ApplyDraft;
  onChange: <K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) => void;
  errors: Record<string, string>;
}

export function StepEducation({ draft, onChange, errors }: StepEducationProps) {
  const [customDegreeSelected, setCustomDegreeSelected] = useState(false);
  const isCustomDegree = Boolean(
    draft.degree &&
    (!DEGREES.includes(draft.degree as (typeof DEGREES)[number]) || draft.degree === "Other"),
  );

  const currentYear = new Date().getFullYear();
  const graduationYears = useMemo(() => {
    return Array.from({ length: currentYear + 2 - 1960 + 1 }, (_, i) => currentYear + 2 - i);
  }, [currentYear]);

  const alumniRecognised = draft.alumniEmail.trim()
    ? isRecognisedAlumniEmail(draft.alumniEmail.trim())
    : null;

  return (
    <ApplyStepContainer
      title="Confirm your academic record"
      note="We verify directly through alumni channels or a graduation document after signup."
    >
      <div className="grid gap-5">
        <FormField label="Institution">
          <select
            name="institution"
            required
            value={draft.institution}
            onChange={(e) => onChange("institution", e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
          >
            <option value="" disabled>
              Select institution
            </option>
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
          {errors["institution"] && <FieldError text={errors["institution"]} />}
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Degree">
            <select
              name="degree"
              required
              value={
                isCustomDegree || customDegreeSelected
                  ? "Other"
                  : DEGREES.includes(draft.degree as (typeof DEGREES)[number])
                    ? draft.degree
                    : draft.degree
                      ? "Other"
                      : ""
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === "Other") {
                  setCustomDegreeSelected(true);
                  if (DEGREES.includes(draft.degree as (typeof DEGREES)[number])) {
                    onChange("degree", "");
                  }
                } else {
                  setCustomDegreeSelected(false);
                  onChange("degree", val);
                }
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
            >
              <option value="" disabled>
                Select degree
              </option>
              {DEGREES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {errors["degree"] && <FieldError text={errors["degree"]} />}
          </FormField>

          <FormField label="Graduation year">
            <select
              name="gradYear"
              required
              value={draft.gradYear}
              onChange={(e) => onChange("gradYear", e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
            >
              <option value="" disabled>
                Select graduation year
              </option>
              {graduationYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  {yr}
                </option>
              ))}
            </select>
            {errors["gradYear"] && <FieldError text={errors["gradYear"]} />}
          </FormField>
        </div>

        {(isCustomDegree || customDegreeSelected) && (
          <FormField
            label="Specify degree"
            hint="Enter your degree title (e.g. B.Arch, MBBS, LL.B)"
          >
            <Input
              name="custom-degree"
              required
              maxLength={100}
              placeholder="e.g. MBBS, B.Arch, LL.B…"
              value={draft.degree}
              onChange={(e) => onChange("degree", e.target.value)}
            />
            {errors["custom-degree"] && <FieldError text={errors["custom-degree"]} />}
          </FormField>
        )}

        <div className="mt-2">
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
      </div>

      <div className="mt-6 border border-border bg-secondary/35 p-4 text-sm leading-6 text-muted-foreground">
        <Mail className="mr-2 inline size-4 text-forest-ink" />
        Degree documents are uploaded privately in verification, after you create an account — never
        shown to members.
      </div>
    </ApplyStepContainer>
  );
}
