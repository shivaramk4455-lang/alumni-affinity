import { Input } from "@/components/ui/input";
import { FormField } from "./form-field";
import type { Form, SetFormField } from "./types";
import { DEGREES, INSTITUTIONS } from "@/lib/profile-options";

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";

interface StepEducationProps {
  f: Form;
  set: SetFormField;
  errors: Record<string, string>;
  customDegreeSelected: boolean;
  setCustomDegreeSelected: (val: boolean) => void;
  graduationYears: number[];
}

export function StepEducation({
  f,
  set,
  errors,
  customDegreeSelected,
  setCustomDegreeSelected,
  graduationYears,
}: StepEducationProps) {
  const isCustomDegree = Boolean(
    f.degree && !DEGREES.includes(f.degree as (typeof DEGREES)[number]),
  );

  return (
    <>
      <FormField label="Institution" error={errors["institution"]}>
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
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Degree" error={errors["degree"]}>
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
        </FormField>
        <FormField label="Graduation year" error={errors["grad_year"]}>
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
        </FormField>
      </div>
      {(isCustomDegree || customDegreeSelected) && (
        <FormField label="Specify degree" error={errors["degree"]} note="Enter your degree name">
          <Input
            autoFocus
            placeholder="e.g. Master of Science, B.Pharm, M.Ch…"
            value={f.degree}
            onChange={(e) => set("degree", e.target.value)}
          />
        </FormField>
      )}
      <p className="text-sm text-muted-foreground">
        Institution verification via alumni email or document review follows after onboarding.
      </p>
    </>
  );
}
