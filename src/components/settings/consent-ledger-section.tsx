import { ScrollText } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { CONSENT_LABELS, useConsentLog, type ConsentPurpose } from "@/lib/consent";

export function ConsentLedgerSection() {
  const consentLog = useConsentLog();

  return (
    <section className="mt-6 border border-border bg-card p-6 md:p-8">
      <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
        <ScrollText className="size-5 text-brass" /> Consent & privacy ledger
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Under the Digital Personal Data Protection Act 2023, every consent you grant or revoke forms
        an immutable receipt. This record is private to you and the grievance desk.
      </p>

      <div className="mt-6 divide-y divide-border border border-border">
        {consentLog.isLoading ? (
          <div className="grid gap-2 p-4" aria-busy="true">
            <span className="sr-only">Loading consent trail…</span>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : consentLog.isError ? (
          <p role="alert" className="p-4 text-sm leading-6 text-destructive">
            Your consent trail could not be loaded — this is not the same as having no entries.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void consentLog.refetch()}
              disabled={consentLog.isFetching}
            >
              {consentLog.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        ) : !consentLog.data?.length ? (
          <p className="p-4 text-sm text-muted-foreground">
            No ledger entries yet. Actions like saving preferences or contact details write here.
          </p>
        ) : (
          consentLog.data.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {CONSENT_LABELS[c.purpose as ConsentPurpose] || c.purpose}
                </p>
                {c.note && (
                  <p className="break-words text-sm leading-5 text-muted-foreground">{c.note}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span
                  className={`font-semibold ${c.granted ? "text-success" : "text-destructive"}`}
                >
                  {c.granted ? "Granted" : "Revoked"}
                </span>
                <span>v{c.policy_version}</span>
                <span className="shrink-0">
                  {new Date(c.recorded_at).toLocaleDateString("en-IN", {
                    dateStyle: "medium",
                  })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
