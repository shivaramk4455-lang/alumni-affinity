import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MAJOR_CITIES_BY_STATE,
  PROFESSION_GROUPS,
  PROFESSIONS,
  RELOCATION,
  RESIDENCY_STATUSES,
  detectCountryAndStateFromCity,
  getRegionsForCountry,
} from "@/lib/profile-options";
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

  const regionLabel =
    draft.country === "Canada"
      ? "Province / Territory"
      : draft.country?.startsWith("US")
        ? "State"
        : draft.country === "United Kingdom"
          ? "Region / County"
          : draft.country === "Europe"
            ? "Country / Region"
            : "State / Province";

  const regions = getRegionsForCountry(draft.country);

  return (
    <ApplyStepContainer
      title="Life & profession"
      note="Give context beyond credentials — your current path and values."
    >
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <FormField label="Country / Residency">
          <select
            name="country"
            required
            value={draft.country}
            onChange={(e) => {
              const country = e.target.value;
              onChange("country", country);
              const validRegions = getRegionsForCountry(country);
              if (draft.state && !validRegions.includes(draft.state)) {
                onChange("state", "");
              }
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
          >
            <option value="" disabled>
              Select country
            </option>
            {RESIDENCY_STATUSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {errors["country"] && <FieldError text={errors["country"]} />}
        </FormField>

        <FormField label={regionLabel}>
          <select
            name="state"
            required
            value={draft.state}
            onChange={(e) => onChange("state", e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
          >
            <option value="" disabled>
              Select {regionLabel.toLowerCase()}
            </option>
            {regions.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          {errors["state"] && <FieldError text={errors["state"]} />}
        </FormField>

        <div className="grid gap-2">
          <FormField label="Current city">
            <Input
              name="city"
              required
              maxLength={80}
              placeholder={
                draft.country === "Canada"
                  ? "e.g. Toronto, Vancouver, Montreal"
                  : draft.country?.startsWith("US")
                    ? "e.g. New York, San Francisco, Seattle"
                    : draft.country === "United Kingdom"
                      ? "e.g. London, Manchester, Cambridge"
                      : "e.g. Bengaluru, Mumbai, Delhi NCR"
              }
              className="h-10"
              value={draft.city}
              onChange={(e) => {
                const val = e.target.value;
                onChange("city", val);
                if (!draft.country || !draft.state) {
                  const detected = detectCountryAndStateFromCity(val);
                  if (detected.state && !draft.state) onChange("state", detected.state);
                  if (detected.country && !draft.country) onChange("country", detected.country);
                }
              }}
            />
            {errors["city"] && <FieldError text={errors["city"]} />}
          </FormField>
          {draft.state && MAJOR_CITIES_BY_STATE[draft.state] && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium text-muted-foreground">Popular:</span>
              {MAJOR_CITIES_BY_STATE[draft.state]?.slice(0, 4).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange("city", c)}
                  className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                    draft.city === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-secondary/50 text-foreground hover:bg-secondary"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        <FormField label="Relocation outlook">
          <select
            name="relocation"
            required
            value={draft.relocation}
            onChange={(e) => onChange("relocation", e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
          >
            <option value="" disabled>
              Select preference
            </option>
            {RELOCATION.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {errors["relocation"] && <FieldError text={errors["relocation"]} />}
        </FormField>

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
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
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

        {isCustom || customSelected ? (
          <FormField label="Specify profession">
            <Input
              name="custom-profession"
              required
              maxLength={100}
              placeholder="e.g. Quantitative Researcher, Surgeon…"
              className="h-10"
              value={draft.profession}
              onChange={(e) => onChange("profession", e.target.value)}
            />
            {errors["custom-profession"] && <FieldError text={errors["custom-profession"]} />}
          </FormField>
        ) : (
          <div className="hidden sm:block" aria-hidden="true" />
        )}
      </div>

      <div className="mt-6">
        <FormField
          label="What are you looking for in a partner?"
          hint="Describe the qualities, values, and the life you aspire to build together. Maximum 600 characters."
        >
          <Textarea
            name="values"
            required
            maxLength={600}
            className="min-h-32 text-sm leading-6"
            placeholder="The qualities you value most, your outlook on life, and the partnership you hope to create together…"
            value={draft.values}
            onChange={(e) => onChange("values", e.target.value)}
          />
          {errors["values"] && <FieldError text={errors["values"]} />}
        </FormField>
      </div>
    </ApplyStepContainer>
  );
}
