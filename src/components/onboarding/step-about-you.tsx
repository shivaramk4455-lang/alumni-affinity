import { Input } from "@/components/ui/input";
import { DobPicker } from "@/components/ui/dob-picker";
import { FormField } from "./form-field";
import type { Form, SetFormField } from "./types";
import {
  CASTES,
  DIETS,
  GENDERS,
  GOTRAS,
  HEIGHT_OPTIONS,
  MAJOR_CITIES_BY_STATE,
  MANGALIK_OPTIONS,
  MARITAL_STATUSES,
  MOTHER_TONGUES,
  NAKSHATRAS,
  NAKSHATRA_PADAS,
  PROFILE_CREATED_BY,
  RASHIS,
  RELIGIONS,
  RESIDENCY_STATUSES,
  detectCountryAndStateFromCity,
  getRegionsForCountry,
} from "@/lib/profile-options";
import { starRashi } from "@/lib/guna-milan";

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";

interface StepAboutYouProps {
  f: Form;
  set: SetFormField;
  errors: Record<string, string>;
  dob: string;
  setDob: (val: string) => void;
  selectedState: string;
  setSelectedState: (val: string) => void;
  customCasteSelected: boolean;
  setCustomCasteSelected: (val: boolean) => void;
  customGotraSelected: boolean;
  setCustomGotraSelected: (val: boolean) => void;
  year: number;
  birthYears: number[];
}

export function StepAboutYou({
  f,
  set,
  errors,
  dob,
  setDob,
  selectedState,
  setSelectedState,
  customCasteSelected,
  setCustomCasteSelected,
  customGotraSelected,
  setCustomGotraSelected,
  year,
  birthYears,
}: StepAboutYouProps) {
  const isCustomCaste = Boolean(
    f.caste && !CASTES.includes(f.caste as (typeof CASTES)[number]) && f.caste !== "Other",
  );
  const isCustomGotra = Boolean(
    f.gotra && !GOTRAS.includes(f.gotra as (typeof GOTRAS)[number]) && f.gotra !== "Other",
  );

  return (
    <>
      <FormField label="Full name" error={errors["full_name"]}>
        <Input
          autoComplete="name"
          value={f.full_name}
          onChange={(e) => set("full_name", e.target.value)}
        />
      </FormField>
      <FormField
        label="Profile created by"
        note="You still own and control this profile — this is just a label for who filled it in."
      >
        <select
          className={selectCls}
          value={f.created_by}
          onChange={(e) => set("created_by", e.target.value)}
        >
          {PROFILE_CREATED_BY.map((c) => (
            <option key={c} value={c}>
              {c === "Self" ? "Myself" : c}
            </option>
          ))}
        </select>
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Gender" error={errors["gender"]}>
          <select
            className={selectCls}
            value={f.gender}
            onChange={(e) => set("gender", e.target.value)}
          >
            <option value="">Select</option>
            {GENDERS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Date of birth / Age (21+)"
          error={errors["birth_year"]}
          note={
            f.birth_year && Number(f.birth_year) >= year - 70 && Number(f.birth_year) <= year - 21
              ? `${year - Number(f.birth_year)} years old · Born ${f.birth_year}`
              : "Membership is 21+"
          }
        >
          <DobPicker
            id="onboarding-dob"
            value={dob}
            onChange={(val) => {
              setDob(val);
              if (val) {
                const yr = val.slice(0, 4);
                set("birth_year", yr);
              } else {
                set("birth_year", "");
              }
            }}
            aria-invalid={Boolean(errors["birth_year"])}
          />
        </FormField>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Country / Residency">
          <select
            className={selectCls}
            value={f.residency_status}
            onChange={(e) => {
              const country = e.target.value;
              set("residency_status", country);
              const validRegions = getRegionsForCountry(country);
              if (selectedState && !validRegions.includes(selectedState)) {
                setSelectedState("");
              }
            }}
          >
            <option value="">Select country / residency</option>
            {RESIDENCY_STATUSES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label={
            f.residency_status === "Canada"
              ? "Province / Territory"
              : f.residency_status?.startsWith("US")
                ? "State"
                : f.residency_status === "United Kingdom"
                  ? "Region / Country"
                  : "State / Province"
          }
        >
          <select
            className={selectCls}
            value={selectedState}
            onChange={(e) => {
              const st = e.target.value;
              setSelectedState(st);
            }}
          >
            <option value="">
              {f.residency_status === "Canada"
                ? "Select Province"
                : f.residency_status?.startsWith("US")
                  ? "Select State"
                  : "Select State / Province"}
            </option>
            {getRegionsForCountry(f.residency_status).map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Current city" error={errors["city"]}>
        <Input
          autoComplete="address-level2"
          placeholder={
            f.residency_status === "Canada"
              ? "e.g. Toronto, Vancouver, Montreal"
              : f.residency_status?.startsWith("US")
                ? "e.g. San Francisco, New York, Seattle"
                : f.residency_status === "United Kingdom"
                  ? "e.g. London, Manchester"
                  : "e.g. Bhopal, Bengaluru, Mumbai"
          }
          value={f.city}
          onChange={(e) => {
            const val = e.target.value;
            set("city", val);
            if (!f.residency_status || !selectedState) {
              const detected = detectCountryAndStateFromCity(val);
              if (detected.state && !selectedState) {
                setSelectedState(detected.state);
              }
              if (detected.country && !f.residency_status) {
                set("residency_status", detected.country);
              }
            }
          }}
        />
      </FormField>
      {selectedState && MAJOR_CITIES_BY_STATE[selectedState] && (
        <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground font-medium">Popular in {selectedState}:</span>
          {MAJOR_CITIES_BY_STATE[selectedState]?.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set("city", c)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                f.city === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary/50 text-foreground hover:bg-secondary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Height (optional)">
          <select
            className={selectCls}
            value={f.height_cm}
            onChange={(e) => set("height_cm", e.target.value)}
          >
            <option value="">Select height</option>
            {HEIGHT_OPTIONS.map((h) => (
              <option key={h.cm} value={String(h.cm)}>
                {h.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Marital status (optional)">
          <select
            className={selectCls}
            value={f.marital_status}
            onChange={(e) => set("marital_status", e.target.value)}
          >
            <option value="">Select</option>
            {MARITAL_STATUSES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </FormField>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Dietary preference (optional)">
          <select
            className={selectCls}
            value={f.diet}
            onChange={(e) => set("diet", e.target.value)}
          >
            <option value="">Select</option>
            {DIETS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Mother tongue (optional)">
          <select
            className={selectCls}
            value={f.mother_tongue}
            onChange={(e) => set("mother_tongue", e.target.value)}
          >
            <option value="">Select</option>
            {MOTHER_TONGUES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </FormField>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <FormField label="Religion (optional)">
          <select
            className={selectCls}
            value={f.religion}
            onChange={(e) => set("religion", e.target.value)}
          >
            <option value="">Select religion</option>
            {RELIGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Caste / Community (optional)">
          <select
            className={selectCls}
            value={isCustomCaste || customCasteSelected ? "Other" : f.caste}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "Other") {
                setCustomCasteSelected(true);
                if (CASTES.includes(f.caste as (typeof CASTES)[number])) {
                  set("caste", "");
                }
              } else {
                setCustomCasteSelected(false);
                set("caste", val);
              }
            }}
          >
            <option value="">Select caste / community</option>
            {CASTES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {(isCustomCaste || customCasteSelected) && (
            <Input
              className="mt-2"
              placeholder="Specify caste or community"
              value={f.caste}
              onChange={(e) => set("caste", e.target.value)}
              maxLength={80}
              autoFocus
            />
          )}
        </FormField>
        <FormField label="Gotra (optional)">
          <select
            className={selectCls}
            value={isCustomGotra || customGotraSelected ? "Other" : f.gotra}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "Other") {
                setCustomGotraSelected(true);
                if (GOTRAS.includes(f.gotra as (typeof GOTRAS)[number])) {
                  set("gotra", "");
                }
              } else {
                setCustomGotraSelected(false);
                set("gotra", val);
              }
            }}
          >
            <option value="">Select gotra</option>
            {GOTRAS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {(isCustomGotra || customGotraSelected) && (
            <Input
              className="mt-2"
              placeholder="Specify gotra"
              value={f.gotra}
              onChange={(e) => set("gotra", e.target.value)}
              maxLength={80}
              autoFocus
            />
          )}
        </FormField>
      </div>

      <div className="mt-2 border-t border-border/60 pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
          Horoscope (optional)
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          If you share your birth star, we can show a Guna Milan (Ashtakoota) compatibility score
          with other members who have done the same. Everything here is optional.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <FormField label="Birth star (Nakshatra)" note="Drives the match score">
            <select
              className={selectCls}
              value={f.nakshatra}
              onChange={(e) => {
                const star = e.target.value;
                set("nakshatra", star);
                if (star) {
                  const derived = RASHIS.find((r) => r.split(" ")[0] === starRashi(star));
                  if (derived) set("rashi", derived);
                }
              }}
            >
              <option value="">Select birth star</option>
              {NAKSHATRAS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Birth star quarter (Pada / Charan)">
            <select
              className={selectCls}
              value={f.nakshatra_pada}
              onChange={(e) => set("nakshatra_pada", e.target.value)}
            >
              <option value="">Select pada</option>
              {NAKSHATRA_PADAS.map((p) => (
                <option key={p} value={String(p)}>
                  Pada {p}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <FormField label="Moon sign (Rashi)" note="Filled in from your birth star">
            <select
              className={selectCls}
              value={f.rashi}
              onChange={(e) => set("rashi", e.target.value)}
            >
              <option value="">Select moon sign</option>
              {RASHIS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Manglik / Mangal Dosha">
            <select
              className={selectCls}
              value={f.manglik}
              onChange={(e) => set("manglik", e.target.value)}
            >
              <option value="">Select</option>
              {MANGALIK_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <FormField label="Time of birth">
            <Input
              type="time"
              value={f.birth_time}
              onChange={(e) => set("birth_time", e.target.value)}
            />
          </FormField>
          <FormField label="Place of birth">
            <Input
              autoComplete="off"
              placeholder="e.g. Pune, Maharashtra"
              value={f.birth_place}
              onChange={(e) => set("birth_place", e.target.value)}
              maxLength={120}
            />
          </FormField>
        </div>
      </div>
    </>
  );
}
