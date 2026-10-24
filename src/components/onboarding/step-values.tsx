import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FormField } from "./form-field";
import type { Form, SetFormField } from "./types";
import { HEIGHT_OPTIONS, MARITAL_STATUSES, DIETS, RELOCATION } from "@/lib/profile-options";

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";

interface StepValuesProps {
  f: Form;
  set: SetFormField;
  errors: Record<string, string>;
}

export function StepValues({ f, set, errors }: StepValuesProps) {
  return (
    <>
      <div className="border border-border bg-card p-5">
        <h3 className="font-serif text-lg font-semibold">
          What you are looking for (Partner preferences)
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Set preferred criteria for your partner. These power your compatibility badges and search
          matching.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Partner age: Minimum age" error={errors["pref_min_age"]}>
            <Input
              type="number"
              min={21}
              max={75}
              placeholder="e.g. 24"
              value={f.pref_min_age}
              onChange={(e) => set("pref_min_age", e.target.value)}
            />
          </FormField>
          <FormField label="Partner age: Maximum age" error={errors["pref_max_age"]}>
            <Input
              type="number"
              min={21}
              max={75}
              placeholder="e.g. 32"
              value={f.pref_max_age}
              onChange={(e) => set("pref_max_age", e.target.value)}
            />
          </FormField>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Partner height: Minimum (optional)">
            <select
              className={selectCls}
              value={f.pref_min_height}
              onChange={(e) => set("pref_min_height", e.target.value)}
            >
              <option value="">Any height</option>
              {HEIGHT_OPTIONS.map((h) => (
                <option key={h.cm} value={String(h.cm)}>
                  {h.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Partner height: Maximum (optional)">
            <select
              className={selectCls}
              value={f.pref_max_height}
              onChange={(e) => set("pref_max_height", e.target.value)}
            >
              <option value="">Any height</option>
              {HEIGHT_OPTIONS.map((h) => (
                <option key={h.cm} value={String(h.cm)}>
                  {h.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FormField label="Preferred marital status (optional)">
            <select
              className={selectCls}
              value={f.pref_marital_status}
              onChange={(e) => set("pref_marital_status", e.target.value)}
            >
              <option value="">Open to all</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Preferred diet (optional)">
            <select
              className={selectCls}
              value={f.pref_diet}
              onChange={(e) => set("pref_diet", e.target.value)}
            >
              <option value="">Open to all diets</option>
              {DIETS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Preferred relocation (optional)">
            <select
              className={selectCls}
              value={f.pref_relocation}
              onChange={(e) => set("pref_relocation", e.target.value)}
            >
              <option value="">Open to all</option>
              {RELOCATION.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </div>

      <FormField label="What matters to you in a partnership" error={errors["values_statement"]}>
        <Textarea
          rows={4}
          maxLength={600}
          value={f.values_statement}
          onChange={(e) => set("values_statement", e.target.value)}
        />
      </FormField>
      <FormField label="A short introduction (optional)">
        <Textarea rows={4} value={f.bio} onChange={(e) => set("bio", e.target.value)} />
      </FormField>
      <div className="flex items-start justify-between gap-4 border-t border-border pt-5">
        <div>
          <p className="text-sm font-medium">Visible to verified members</p>
          <p className="text-xs text-muted-foreground">
            Turn off for ghost mode — you can browse, but won't appear in search.
          </p>
        </div>
        <Switch
          checked={f.is_visible}
          onCheckedChange={(v) => set("is_visible", v)}
          aria-label="Visible to members"
        />
      </div>
      <div className="border border-border/80 bg-secondary/30 p-4 text-xs leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">Next step after onboarding:</span> Profile
        photographs and institutional verification documents can be uploaded directly under
        Verification on your Membership Desk.
      </div>
    </>
  );
}
