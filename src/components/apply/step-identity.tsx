import { FileCheck2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormField, FieldError, ApplyStepContainer } from "./form-field";
import type { ApplyDraft } from "./types";

export interface StepIdentityProps {
  draft: ApplyDraft;
  onChange: <K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) => void;
  errors: Record<string, string>;
}

export function StepIdentity({ draft, onChange, errors }: StepIdentityProps) {
  const currentYear = new Date().getFullYear();

  return (
    <ApplyStepContainer
      title="Verify who you are"
      note="Use the details that appear on your government-issued identity document."
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_220px]">
        <FormField label="Full legal name">
          <Input
            name="name"
            required
            maxLength={100}
            placeholder="As shown on your ID"
            value={draft.name}
            onChange={(e) => onChange("name", e.target.value)}
          />
          {errors["name"] && <FieldError text={errors["name"]} />}
        </FormField>
        <FormField label="Date of birth">
          <Input
            name="dob"
            type="date"
            required
            max={`${currentYear - 21}-12-31`}
            min={`${currentYear - 75}-01-01`}
            className="w-full max-w-[220px] cursor-pointer"
            value={draft.dob}
            onChange={(e) => onChange("dob", e.target.value)}
          />
          {errors["dob"] && <FieldError text={errors["dob"]} />}
        </FormField>
        <FormField label="Email address">
          <Input
            name="email"
            type="email"
            required
            maxLength={255}
            placeholder="you@example.com"
            value={draft.email}
            onChange={(e) => onChange("email", e.target.value)}
          />
          {errors["email"] && <FieldError text={errors["email"]} />}
        </FormField>
        <FormField label="Mobile number">
          <Input
            name="phone"
            type="tel"
            required
            maxLength={15}
            placeholder="+91 98765 43210"
            className="w-full sm:max-w-[220px]"
            value={draft.phone}
            onChange={(e) => onChange("phone", e.target.value)}
          />
          {errors["phone"] && <FieldError text={errors["phone"]} />}
        </FormField>
      </div>
      <div className="mt-6 border border-border bg-secondary/35 p-4 text-sm leading-6 text-muted-foreground">
        <FileCheck2 className="mr-2 inline size-4 text-brass" />
        Identity verification is handled independently and your document is never shown to members.
      </div>
    </ApplyStepContainer>
  );
}
