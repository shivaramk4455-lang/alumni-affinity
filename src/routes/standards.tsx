import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/standards")({
  head: () => ({
    meta: [
      { title: "Community standards — The Merit Circle" },
      {
        name: "description",
        content: "Safety and respectful-conduct standards for members and co-pilots.",
      },
    ],
    links: [{ rel: "canonical", href: "https://themeritcircle.in/standards" }],
  }),
  component: Standards,
});

function Standards() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">Legal</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold">Community standards</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The conduct expected of every member and co-pilot.
      </p>
      <div className="mt-8 grid gap-6 text-sm leading-7 text-muted-foreground">
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Consent first</h2>
          <p className="mt-2">
            Write only through introductions you have been invited into. Never pursue contact after
            a decline or withdrawal.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">
            Photographs stay private
          </h2>
          <p className="mt-2">
            Every view shows your identity as an on-screen overlay — a deterrent, not a mark in the
            file itself. Screenshots, downloads for redistribution, or sharing outside the Circle
            lead to removal.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Honesty</h2>
          <p className="mt-2">
            No impersonation, no inflated credentials, no hidden marital status. Report anything
            that feels wrong from the member profile page — reports go to the desk privately.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Family boundaries</h2>
          <p className="mt-2">
            Co-pilots suggest; candidates decide. A co-pilot who pressures or oversteps loses access
            at the candidate’s word.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Enforcement</h2>
          <p className="mt-2">
            Violations are reviewed by the membership team and may result in warning, suspension, or
            permanent removal. Appeal via{" "}
            <Link
              to="/grievance"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              grievance redressal
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
