import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PROFESSION_GROUPS, PROFESSIONS, RELOCATION } from "@/lib/profile-options";
import { FormField, FieldError, ApplyStepContainer } from "./form-field";
import type { ApplyDraft } from "./types";

export interface StepTrajectoryProps {
  draft: ApplyDraft;
  onChange: <K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) => void;
  errors: Record<string, string>;
}

export function StepTrajectory({ draft, onChange, errors }: StepTrajectoryProps) {
  const [customSelected, setCustomSelected] = useState(false);
  const isCustom = Boolean(
    draft.profession &&
    !PROFESSIONS.includes(draft.profession as (typeof PROFESSIONS)[number]) &&
    draft.profession !== "Other",
  );

  return (
    <ApplyStepContainer
      title="Life & profession"
      note="Give context beyond credentials — your current path and values."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Current profession">
          <select
            name="profession"
            required
            value={isCustom || customSelected ? "Other" : draft.profession}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "Other") {
                setCustomSelected(true);
                if (!isCustom) onChange("profession", "");
              } else {
                setCustomSelected(false);
                onChange("profession", val);
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
          {errors["profession"] && <FieldError text={errors["profession"]} />}
        </FormField>

        {(isCustom || customSelected) && (
          <FormField label="Specify profession">
            <Input
              name="custom-profession"
              required
              maxLength={100}
              placeholder="e.g. Quantitative Researcher, Surgeon…"
              value={draft.profession}
              onChange={(e) => onChange("profession", e.target.value)}
            />
          </FormField>
        )}

        <FormField label="Current city">
          <Input
            name="city"
            required
            maxLength={80}
            placeholder="e.g. Bengaluru, Mumbai, London"
            value={draft.city}
            onChange={(e) => onChange("city", e.target.value)}
          />
          {errors["city"] && <FieldError text={errors["city"]} />}
        </FormField>

        <FormField label="Relocation outlook">
          <select
            name="relocation"
            required
            value={draft.relocation}
            onChange={(e) => onChange("relocation", e.target.value)}
            className="h-10 w-full border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="" disabled>
              Select preference
            </option>
            {RELOCATION.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          {errors["relocation"] && <FieldError text={errors["relocation"]} />}
        </FormField>

        <FormField label="Career chapter">
          <Input
            name="chapter"
            required
            maxLength={120}
            placeholder="e.g. Building, leading, clinical research…"
            value={draft.chapter}
            onChange={(e) => onChange("chapter", e.target.value)}
          />
          {errors["chapter"] && <FieldError text={errors["chapter"]} />}
        </FormField>
      </div>

      <div className="mt-5">
        <FormField
          label="What matters in the life you are building?"
          hint="A thoughtful response helps verified members understand your vision. Maximum 600 characters."
        >
          <Textarea
            name="values"
            required
            maxLength={600}
            className="min-h-32"
            placeholder="The values, rhythms, and ambitions you hope to share…"
            value={draft.values}
            onChange={(e) => onChange("values", e.target.value)}
          />
          {errors["values"] && <FieldError text={errors["values"]} />}
        </FormField>
      </div>
    </ApplyStepContainer>
  );
}
