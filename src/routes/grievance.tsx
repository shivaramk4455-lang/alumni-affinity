import { createFileRoute, Link } from "@tanstack/react-router";

import {
  GRIEVANCE_OFFICER,
  GRIEVANCE_PLACEHOLDER_NOTICE,
  NODAL_OFFICER,
} from "@/lib/legal-identity";

export const Route = createFileRoute("/grievance")({
  head: () => ({
    meta: [
      { title: "Grievance redressal — The Merit Circle" },
      {
        name: "description",
        content:
          "How to raise a complaint, the statutory timelines, the Nodal Officer, and how to appeal under Rule 3A of the IT Rules, 2021.",
      },
      { property: "og:title", content: "Grievance redressal — The Merit Circle" },
      {
        property: "og:description",
        content:
          "Grievance Officer, Nodal Officer and the appeal mechanism — published as Rule 3(2), 3A and 4 of the IT Rules, 2021 require.",
      },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: "https://themeritcircle.in/grievance" }],
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
        <section className="border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Nodal Officer</h2>
          <p className="mt-2 text-sm leading-6">
            Rule 4(1) of the Information Technology (Intermediary Guidelines and Digital Media
            Ethics Code) Rules, 2021 requires a nodal contact person with published contact details,
            who coordinates with law-enforcement and government authorities. We appoint that role
            here, and use it as the escalation point above the Grievance Officer: if a complaint is
            not resolved to your satisfaction, write to the Nodal Officer with the reference you
            were given.
          </p>
          <p className="mt-3 text-sm leading-6">
            <span className="font-semibold text-foreground">Nodal Officer:</span>{" "}
            {NODAL_OFFICER.officer}
            <br />
            <span className="font-semibold text-foreground">Escalation email:</span>{" "}
            <a
              href={`mailto:${NODAL_OFFICER.email}`}
              className="text-foreground underline underline-offset-4"
            >
              {NODAL_OFFICER.email}
            </a>
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">
            Appeal mechanism (Rule 3A)
          </h2>
          <p className="mt-2">
            If the Grievance Officer resolves a complaint and you remain aggrieved, Rule 3A of the
            IT Rules, 2021 entitles you to prefer an appeal to the Grievance Appellate Committee(s)
            established by the Central Government. The appeal window opens when the Grievance
            Officer's decision is communicated and runs for <strong>30 days</strong> from that date.
            The Committee hears appeals online and the intermediary concerned complies with its
            orders. Nothing here takes away your separate right to approach the Data Protection
            Board under Section 13 of the DPDP Act, 2023, or a court of law.
          </p>
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
