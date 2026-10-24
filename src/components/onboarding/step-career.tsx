import { Input } from "@/components/ui/input";
import { FormField } from "./form-field";
import type { Form, SetFormField } from "./types";
import { PROFESSION_GROUPS, PROFESSIONS, RELOCATION } from "@/lib/profile-options";

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";

interface StepCareerProps {
  f: Form;
  set: SetFormField;
  errors: Record<string, string>;
  customProfessionSelected: boolean;
  setCustomProfessionSelected: (val: boolean) => void;
}

export function StepCareer({
  f,
  set,
  errors,
  customProfessionSelected,
  setCustomProfessionSelected,
}: StepCareerProps) {
  const isCustomProfession = Boolean(
    f.profession &&
    !PROFESSIONS.includes(f.profession as (typeof PROFESSIONS)[number]) &&
    f.profession !== "Other",
  );

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Profession" error={errors["profession"]}>
          <select
            id="onboard-profession"
            className={selectCls}
            value={isCustomProfession || customProfessionSelected ? "Other" : f.profession}
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
          >
            <option value="">Select profession</option>
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
        </FormField>
        <FormField label="Organisation (optional)">
          <Input
            id="onboard-employer"
            placeholder="e.g. Google, McKinsey, Tata, Startup…"
            value={f.employer}
            onChange={(e) => set("employer", e.target.value)}
          />
        </FormField>
      </div>
      {(isCustomProfession || customProfessionSelected) && (
        <FormField
          label="Specify profession"
          error={errors["profession"]}
          note="Enter your specific profession, role or title"
        >
          <Input
            id="onboard-custom-profession"
            autoFocus
            placeholder="e.g. Quantitative Researcher, Aerospace Engineer, Surgeon…"
            value={f.profession}
            onChange={(e) => set("profession", e.target.value)}
          />
        </FormField>
      )}
      <FormField label="Relocation" error={errors["relocation"]}>
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
      </FormField>
    </>
  );
}
