import { Upload } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ApplyStepContainer } from "./form-field";
import type { ApplyDraft } from "./types";

export interface StepVisibilityProps {
  draft: ApplyDraft;
  onChange: <K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) => void;
}

export function StepVisibility({ draft, onChange }: StepVisibilityProps) {
  return (
    <ApplyStepContainer
      title="Privacy & profile controls"
      note="Every profile photograph is watermarked and you retain strict control over who can view it."
    >
      <div className="flex items-start gap-4 border border-border bg-secondary/40 p-5">
        <Upload className="mt-0.5 size-5 shrink-0 text-brass" />
        <div>
          <p className="text-sm font-semibold text-foreground">Add your photograph after signup</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            We take no uploads during application so your documents stay private until you have an
            account. You will be able to upload a recent portrait in your verification dashboard.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-start justify-between gap-5 border border-border p-5">
        <div>
          <p className="font-semibold text-foreground">Ghost mode</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Hide your profile from general directory discovery. You will appear only to people you
            explicitly choose or whose introduction you accept.
          </p>
        </div>
        <Switch
          checked={draft.ghost}
          onCheckedChange={(v) => onChange("ghost", v)}
          aria-label="Ghost mode"
        />
      </div>

      <div className="mt-3 flex items-start justify-between gap-5 border border-border p-5">
        <div>
          <p className="font-semibold text-foreground">Photos after interest</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Keep photographs obscured until an introduction request is approved by both parties.
          </p>
        </div>
        <Switch
          checked={draft.photosAfterInterest}
          onCheckedChange={(v) => onChange("photosAfterInterest", v)}
          aria-label="Photos after interest"
        />
      </div>
    </ApplyStepContainer>
  );
}
