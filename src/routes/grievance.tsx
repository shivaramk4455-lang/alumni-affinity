import { createFileRoute, Link } from "@tanstack/react-router";

import { GRIEVANCE_OFFICER, GRIEVANCE_PLACEHOLDER_NOTICE } from "@/lib/legal-identity";

export const Route = createFileRoute("/grievance")({
  head: () => ({
    meta: [
      { title: "Grievance redressal — The Merit Circle" },
      {
        name: "description",
        content: "How to raise a complaint under the Information Technology Act, 2000.",
      },
    ],
  }),
  component: Grievance,
});

function Grievance() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">Legal</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold">Grievance redressal</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        In accordance with the Information Technology Act, 2000 and applicable Indian data
        protection law.
      </p>
      <div className="mt-8 grid gap-6 text-sm leading-7 text-muted-foreground">
        <section className="border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Grievance Officer</h2>
          <p className="mt-2 text-sm leading-6">
            <span className="font-semibold text-foreground">Designated Grievance Officer:</span>{" "}
            {GRIEVANCE_OFFICER.officer}
            <br />
            <span className="font-semibold text-foreground">Entity:</span>{" "}
            {GRIEVANCE_OFFICER.entity}
            <br />
            <span className="font-semibold text-foreground">Registered Office:</span>{" "}
            {GRIEVANCE_OFFICER.registeredAddress}
            <br />
            <span className="font-semibold text-foreground">Direct Redressal Email:</span>{" "}
            <a
              href={`mailto:${GRIEVANCE_OFFICER.email}`}
              className="text-foreground underline underline-offset-4"
            >
              {GRIEVANCE_OFFICER.email}
            </a>
          </p>
          {!GRIEVANCE_OFFICER.published && (
            <p className="mt-3 border-l-2 border-brass bg-secondary/40 px-4 py-3 text-xs leading-5">
              {GRIEVANCE_PLACEHOLDER_NOTICE}
            </p>
          )}
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">What to include</h2>
          <p className="mt-2">
            Your registered email address, a concise statement of the grievance, relevant profile
            identifiers, and supporting documentation where applicable. Photograph misuse,
            non-consensual recording, or harassment reports are afforded immediate priority.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Statutory Timelines</h2>
          <p className="mt-2">
            In compliance with Rule 3(2) of the Information Technology (Intermediary Guidelines and
            Digital Media Ethics Code) Rules, 2021:
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
            <li>
              Acknowledgment of complaint: within <strong>24 hours</strong>.
            </li>
            <li>
              Safety, impersonation, or dignity-related reports: expedited review within{" "}
              <strong>24 hours</strong>.
            </li>
            <li>
              Complete grievance resolution: within <strong>15 days</strong> from receipt.
            </li>
          </ul>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Data requests</h2>
          <p className="mt-2">
            For access, correction, or deletion of your information, write to the same address. You
            can also withdraw from discovery immediately in{" "}
            <Link
              to="/settings"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              settings
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
