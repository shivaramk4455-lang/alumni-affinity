import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface InterestNotePanelProps {
  note: string;
  onNoteChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
}

export function InterestNotePanel({
  note,
  onNoteChange,
  onSubmit,
  onCancel,
  isPending,
}: InterestNotePanelProps) {
  return (
    <div
      id="interest-note-panel"
      className="mt-4 grid gap-3 border border-border bg-secondary/15 p-4"
    >
      <label htmlFor="interest-note" className="text-sm font-semibold">
        A short note (optional)
      </label>
      <Textarea
        id="interest-note"
        rows={4}
        maxLength={600}
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Say something specific about why you are writing."
      />
      <div className="flex flex-wrap gap-3">
        <Button onClick={onSubmit} disabled={isPending}>
          {isPending ? "Sending…" : "Send interest"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export interface CopilotLink {
  id: string;
  candidate_id: string;
  copilot_name?: string | null | undefined;
  copilot_email?: string | null | undefined;
}

export interface FamilySuggestPanelProps {
  familyNote: string;
  onFamilyNoteChange: (val: string) => void;
  copilotLinks: CopilotLink[];
  onSuggest: (copilot: CopilotLink) => void;
  onCancel: () => void;
  isPending: boolean;
}

export function FamilySuggestPanel({
  familyNote,
  onFamilyNoteChange,
  copilotLinks,
  onSuggest,
  onCancel,
  isPending,
}: FamilySuggestPanelProps) {
  return (
    <div
      id="family-note-panel"
      role="group"
      aria-label="Suggest this profile to a family co-pilot"
      className="mt-4 grid gap-3 border border-border bg-secondary/15 p-4"
    >
      <label htmlFor="family-note" className="text-sm font-semibold">
        Suggest to your family member
      </label>
      <Textarea
        id="family-note"
        rows={3}
        maxLength={600}
        value={familyNote}
        onChange={(e) => onFamilyNoteChange(e.target.value)}
        placeholder="Why you think this profile is worth a look."
      />
      <div className="flex flex-wrap gap-3">
        {copilotLinks.map((c) => (
          <Button
            key={c.id}
            variant="outline"
            onClick={() => onSuggest(c)}
            disabled={isPending}
            aria-label={`Share this suggestion with ${c.copilot_name || c.copilot_email || "your family member"}`}
          >
            Share with {c.copilot_name || c.copilot_email || "family"}
          </Button>
        ))}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export interface ReportProfilePanelProps {
  reportReason: string;
  onReportReasonChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  isError: boolean;
}

export function ReportProfilePanel({
  reportReason,
  onReportReasonChange,
  onSubmit,
  onCancel,
  isPending,
  isError,
}: ReportProfilePanelProps) {
  return (
    <div
      id="report-reason-panel"
      role="group"
      aria-label="Report this profile"
      className="mt-4 grid gap-3 border border-border bg-secondary/15 p-4"
    >
      <label htmlFor="report-reason" className="text-sm font-semibold">
        Report this profile
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        Tell the membership desk what felt wrong. Reports are private, and the profile is hidden
        from your search immediately.
      </p>
      <Input
        id="report-reason"
        maxLength={300}
        value={reportReason}
        onChange={(e) => onReportReasonChange(e.target.value)}
        placeholder="A sentence or two about the concern"
        aria-required="true"
        aria-invalid={isError ? true : undefined}
        aria-describedby="report-reason-hint"
      />
      <p id="report-reason-hint" className="sr-only">
        At least ten characters.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="destructive" onClick={onSubmit} disabled={isPending}>
          {isPending ? "Submitting…" : "Submit report"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
