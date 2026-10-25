import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MAJOR_CITIES_BY_STATE,
  PROFESSION_GROUPS,
  PROFESSIONS,
  RELOCATION,
  RESIDENCY_STATUSES,
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
  const [customCitySelected, setCustomCitySelected] = useState(false);

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
          : draft.country === "Australia"
            ? "State / Territory"
            : draft.country === "Europe"
              ? "Country / Region"
              : "State / Province";

  const regions = getRegionsForCountry(draft.country);
  const availableCities = draft.state ? (MAJOR_CITIES_BY_STATE[draft.state] ?? []) : [];
  const isCustomCity = Boolean(
    draft.city && availableCities.length > 0 && !availableCities.includes(draft.city),
  );

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
                onChange("city", "");
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
            onChange={(e) => {
              const st = e.target.value;
              onChange("state", st);
              const newCities = MAJOR_CITIES_BY_STATE[st] ?? [];
              if (draft.city && !newCities.includes(draft.city) && !customCitySelected) {
                onChange("city", "");
              }
            }}
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

        <FormField label="Current city">
          {availableCities.length > 0 || !draft.state ? (
            <select
              name="city"
              required
              disabled={!draft.state}
              value={
                isCustomCity || customCitySelected
                  ? "Other"
                  : availableCities.includes(draft.city)
                    ? draft.city
                    : draft.city
                      ? "Other"
                      : ""
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === "Other") {
                  setCustomCitySelected(true);
                  if (availableCities.includes(draft.city)) {
                    onChange("city", "");
                  }
                } else {
                  setCustomCitySelected(false);
                  onChange("city", val);
                }
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:focus:ring-destructive"
            >
              <option value="" disabled>
                {!draft.state ? "Select state / region first" : "Select city"}
              </option>
              {availableCities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="Other">Other (specify)</option>
            </select>
          ) : (
            <Input
              name="city"
              required
              maxLength={80}
              placeholder="Enter your city"
              className="h-10"
              value={draft.city}
              onChange={(e) => onChange("city", e.target.value)}
            />
          )}
          {errors["city"] && <FieldError text={errors["city"]} />}
        </FormField>

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

        {(isCustomCity || customCitySelected) && availableCities.length > 0 && (
          <div className="sm:col-span-2">
            <FormField label="Specify city">
              <Input
                name="custom-city"
                required
                maxLength={80}
                placeholder="e.g. Mysuru, Udupi, Hobart, Cork, Limoges…"
                className="h-10"
                value={draft.city}
                onChange={(e) => onChange("city", e.target.value)}
              />
              {errors["custom-city"] && <FieldError text={errors["custom-city"]} />}
            </FormField>
          </div>
        )}

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
