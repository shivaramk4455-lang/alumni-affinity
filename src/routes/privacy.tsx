import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy — The Merit Circle" },
      {
        name: "description",
        content: "How The Merit Circle collects, uses and protects member information.",
      },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">Legal</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold">Privacy policy</h1>
      <p className="mt-3 text-sm text-muted-foreground">Last updated September 2026.</p>
      <div className="mt-8 grid gap-6 text-sm leading-7 text-muted-foreground">
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">
            Private by architecture
          </h2>
          <p className="mt-2">
            There is no public directory. Profiles are visible only to signed-in, verified members —
            never indexed, listed, or sold. Photographs are stored privately and every view shows a
            viewer-identity overlay with the time. The overlay is a visible deterrent on screen, not
            a mark baked into the file — a saved copy will not carry it, so treat every photograph
            as shareable and report misuse.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">What we collect</h2>
          <p className="mt-2">
            Account details, profile information you provide during onboarding, verification
            credentials (institutional email or documents), photographs, introductions and messages
            you send, and co-pilot invitations. Documents are visible only to you and the membership
            desk — never to other members.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">How we use it</h2>
          <p className="mt-2">
            To verify membership, operate discovery and introductions, prevent misuse, and
            communicate about your account. Contact details are shared only after you accept an
            introduction.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Your control</h2>
          <p className="mt-2">
            Ghost mode hides you from discovery. Photograph visibility is yours to set. You may
            withdraw from discovery at any time in{" "}
            <Link
              to="/settings"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              settings
            </Link>
            . For correction or full deletion, write to the grievance desk — see{" "}
            <Link
              to="/grievance"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              grievance redressal
            </Link>
            .
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Retention</h2>
          <p className="mt-2">
            We keep information only while your membership is active or as required by law.
            Withdrawn profiles are excluded from discovery immediately.
          </p>
        </section>
      </div>
    </main>
  );
}
