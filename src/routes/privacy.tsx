import { createFileRoute, Link } from "@tanstack/react-router";

import {
  DPO_CONTACT,
  GRIEVANCE_OFFICER,
  isLegalIdentityComplete,
  NODAL_OFFICER,
  SITE_NAME,
} from "@/lib/legal-identity";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy — The Merit Circle" },
      {
        name: "description",
        content:
          "How The Merit Circle collects, uses, stores and protects member information, and the rights you hold under India's Digital Personal Data Protection Act, 2023.",
      },
      { property: "og:title", content: "Privacy policy — The Merit Circle" },
      {
        property: "og:description",
        content:
          "Your data, your rights: the DPDP Act 2023 notice for members of The Merit Circle.",
      },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: "https://themeritcircle.in/privacy" }],
  }),
  component: Privacy,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-xl font-semibold text-foreground">{title}</h2>
      <div className="mt-2 grid gap-3">{children}</div>
    </section>
  );
}

/**
 * DPDP Act 2023 notice. Section references are to the Digital Personal Data
 * Protection Act, 2023 as enacted (11 August 2023). Controller details come
 * from src/lib/legal-identity.ts so this page, /grievance and the CI release
 * gate can never drift apart.
 */
function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">Legal</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold">Privacy policy</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Last updated September 2026. This notice is given under Section 5 of the Digital Personal
        Data Protection Act, 2023 (DPDP Act) and explains how your personal data is processed.
      </p>

      {!isLegalIdentityComplete() && (
        <p className="mt-6 border-l-2 border-brass bg-secondary/40 px-4 py-3 text-xs leading-5">
          The controller and contact details below are placeholders pending appointment of the Data
          Protection Officer and grievance officers. They are not monitored yet — do not send
          personal data to them. This notice cannot be relied upon for a launch until they are
          replaced with real details.
        </p>
      )}

      <div className="mt-8 grid gap-8 text-sm leading-7 text-muted-foreground">
        <Section title="Who controls your data">
          <p>
            The data controller (Data Fiduciary under the DPDP Act) is{" "}
            <span className="font-semibold text-foreground">{GRIEVANCE_OFFICER.entity}</span>,
            registered at {GRIEVANCE_OFFICER.registeredAddress}. The service is {SITE_NAME}.
          </p>
          <p>
            Contact points, each reachable at the address below:
            <br />
            <span className="font-semibold text-foreground">Data Protection Officer</span>:{" "}
            <a
              href={`mailto:${DPO_CONTACT.email}`}
              className="text-foreground underline underline-offset-4"
            >
              {DPO_CONTACT.email}
            </a>
            <br />
            <span className="font-semibold text-foreground">Grievance Officer</span>:{" "}
            <a
              href={`mailto:${GRIEVANCE_OFFICER.email}`}
              className="text-foreground underline underline-offset-4"
            >
              {GRIEVANCE_OFFICER.email}
            </a>{" "}
            (full details on the{" "}
            <Link to="/grievance" className="text-foreground underline underline-offset-4">
              grievance redressal
            </Link>{" "}
            page)
            <br />
            <span className="font-semibold text-foreground">Nodal Officer</span>:{" "}
            <a
              href={`mailto:${NODAL_OFFICER.email}`}
              className="text-foreground underline underline-offset-4"
            >
              {NODAL_OFFICER.email}
            </a>
          </p>
        </Section>

        <Section title="What we collect, and why">
          <p>
            <span className="font-semibold text-foreground">Account & profile.</span> Your name,
            email, institutional credentials, photographs, education, career, city, partnership
            preferences and application answers. Used to verify membership, run search and
            introductions, and personalise your experience — processed for the purposes you
            consented to at signup (Sections 6 and 7).
          </p>
          <p>
            <span className="font-semibold text-foreground">Verification documents.</span>{" "}
            Institutional email proof or identity documents, used only to confirm status. Visible
            only to you and the membership desk — never to other members.
          </p>
          <p>
            <span className="font-semibold text-foreground">Introductions & messages.</span>{" "}
            Interests you send or receive, notes, messages and co-pilot invitations, used to run the
            flow you initiated and to keep a safety record.
          </p>
          <p>
            <span className="font-semibold text-foreground">Safety & compliance.</span> Access logs,
            reports you file, and consent records — used to prevent misuse, respond to complaints
            and meet legal obligations, including processing without consent where the DPDP Act
            permits (Section 7).
          </p>
          <p>
            We do <span className="font-semibold text-foreground">not</span> sell personal data, run
            behavioural advertising, or track you across other apps and websites. There is no public
            directory: profiles are visible only to signed-in, verified members, photographs are
            stored privately behind a viewer-identity watermark overlay, and contact coordinates
            move only after you accept an introduction.
          </p>
        </Section>

        <Section title="Consent, and withdrawing it">
          <p>
            Consent is freely given, specific, informed, unconditional and unambiguous — a clear
            affirmative action (Section 6) — and we keep an append-only ledger recording what you
            consented to, when, and under which version of this notice. You may withdraw any consent
            at any time in settings or by writing to the DPO: withdrawal must be as easy as giving
            consent, and never affects processing already lawfully carried out. Data we must process
            to deliver the service you asked for, or because law requires it, rests on Section 7
            rather than on consent.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Only as long as the purpose requires, or as law requires (Section 8 — storage
            limitation). In practice: your profile while membership is active; consent and access
            records for as long as we must keep them as evidence; messages while the conversation
            exists; verification documents until verification completes. Account deletion purges
            storage before the row is removed, so credentials never outlive the account, and
            withdrawn profiles leave discovery immediately.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p>
            Other members, and only what the product shows them — contact coordinates move solely
            after you accept an introduction. Our processors (hosting, email, payments) act under
            contract on documented instructions and may not use your data for themselves. The
            membership desk sees verification documents and reports where it must. Disclosure to the
            State or anyone else happens only where Section 7 permits or law requires.
          </p>
        </Section>

        <Section title="Transfers outside India">
          <p>
            Personal data may be stored and accessed in jurisdictions outside India, since our
            infrastructure providers operate globally. Such transfers remain subject to Section 16
            of the DPDP Act and any restrictions the Central Government notifies under it — where a
            destination is restricted, we will not send your data there.
          </p>
        </Section>

        <Section title="Security and data breaches">
          <p>
            We apply access control, database row-level security, encrypted transport, watermarking
            of photographs and least-privilege credentials — the security safeguards Section 8
            requires. If a personal data breach occurs, we will notify the Data Protection Board of
            India and every affected Data Principal as Section 8 provides, with what happened, what
            was affected, and what we are doing about it.
          </p>
        </Section>

        <Section title="Your rights">
          <p>You have the right to:</p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              <span className="font-semibold text-foreground">Access</span> a summary of your
              personal data and how it has been processed (Section 11);
            </li>
            <li>
              <span className="font-semibold text-foreground">Correction and erasure</span> of data
              that is inaccurate, incomplete, or no longer needed (Section 12) — correction of
              profile details is also available in{" "}
              <Link to="/settings" className="text-foreground underline underline-offset-4">
                settings
              </Link>
              ;
            </li>
            <li>
              <span className="font-semibold text-foreground">Grievance redressal</span> from us
              first, then the Data Protection Board (Section 13) — see{" "}
              <Link to="/grievance" className="text-foreground underline underline-offset-4">
                grievance redressal
              </Link>
              ;
            </li>
            <li>
              <span className="font-semibold text-foreground">Nominate</span> another person to
              exercise your rights after your death or in case of incapacity (Section 14).
            </li>
          </ul>
          <p>
            To exercise a right, write to the Data Protection Officer at the address above; we
            respond within the time the DPDP Rules prescribe. Ghost mode, photograph visibility and
            discovery pause in{" "}
            <Link to="/settings" className="text-foreground underline underline-offset-4">
              settings
            </Link>{" "}
            exercise the same control directly in-product.
          </p>
        </Section>

        <Section title="Children's data (Section 9)">
          <p>
            {SITE_NAME} is a membership service for adults aged 21 and over. It is not directed at
            children, and we do not knowingly process a child's personal data: signup carries an
            adult attestation, and at onboarding the database itself rejects a birth year under 18
            (Section 9 requires verifiable parental consent for a child's data, and we do not seek
            it because children are not accepted at all). If you believe a child has provided
            personal data, write to the DPO and we will erase it.
          </p>
        </Section>

        <Section title="Grievances and appeals">
          <p>
            Complaints go to our Grievance Officer — acknowledged within 24 hours, resolved within
            15 days — with escalation to the Nodal Officer. If you remain aggrieved by the Grievance
            Officer's decision you may prefer an appeal to the Grievance Appellate Committee
            constituted under Rule 3A of the Information Technology (Intermediary Guidelines and
            Digital Media Ethics Code) Rules, 2021, within 30 days of receiving that decision; you
            may also file before the Data Protection Board under Section 13 of the DPDP Act. The
            full mechanism is set out on the{" "}
            <Link to="/grievance" className="text-foreground underline underline-offset-4">
              grievance redressal
            </Link>{" "}
            page.
          </p>
        </Section>

        <Section title="Changes to this notice">
          <p>
            Material changes will appear here with an updated date, and where they affect a purpose
            you consented to we will ask for consent again before the changed processing begins.
          </p>
        </Section>

        <section>
          <p className="text-sm leading-7 text-muted-foreground">
            Prefer the short version?{" "}
            <Link
              to="/standards"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              Community standards
            </Link>{" "}
            and{" "}
            <Link
              to="/terms"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              terms of membership
            </Link>{" "}
            state the same rules in plain language.
          </p>
        </section>
      </div>
    </main>
  );
}
