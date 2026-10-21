import { createFileRoute, Link } from "@tanstack/react-router";

import { canonical, ogUrl } from "@/lib/seo";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of membership — The Merit Circle" },
      {
        name: "description",
        content: "Eligibility, conduct and membership terms for The Merit Circle.",
      },
      ogUrl("/terms"),
    ],
    links: [canonical("/terms")],
  }),
  component: Terms,
});

function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">Legal</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold">Terms of membership</h1>
      <p className="mt-3 text-sm text-muted-foreground">Last updated September 2026.</p>
      <div className="mt-8 grid gap-6 text-sm leading-7 text-muted-foreground">
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Eligibility</h2>
          <p className="mt-2">
            Membership is open to adults (21+) who are alumni of qualifying premier institutions or
            leading global universities, seeking committed partnership. Every application is
            reviewed individually by the membership desk.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Candidate agency</h2>
          <p className="mt-2">
            Only the candidate may accept or decline introductions, reveal photographs, or share
            contact details. Co-pilots may suggest and discuss — never act in the candidate’s name.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Accurate information</h2>
          <p className="mt-2">
            You confirm that identity, education, and profile details are accurate.
            Misrepresentation may lead to suspension after review.
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Respectful conduct</h2>
          <p className="mt-2">
            Harassment, screenshots or redistribution of private photographs, and contact outside
            accepted introductions are prohibited — see{" "}
            <Link
              to="/standards"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              community standards
            </Link>
            .
          </p>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Withdrawal</h2>
          <p className="mt-2">
            You may withdraw from discovery at any time in{" "}
            <Link
              to="/settings"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              settings
            </Link>
            . Verification decisions rest with the membership desk.
          </p>
        </section>
      </div>
    </main>
  );
}
