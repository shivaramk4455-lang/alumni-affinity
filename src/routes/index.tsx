import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  EyeOff,
  FileCheck2,
  Fingerprint,
  GraduationCap,
  LockKeyhole,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { canonical, ORGANIZATION_JSON_LD } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Merit Circle — Private Introductions for Premier Alumni" },
      {
        name: "description",
        content:
          "A private, candidate-led matrimonial membership for alumni of India’s premier institutions and leading global universities.",
      },
      {
        property: "og:title",
        content: "The Merit Circle — Private Introductions for Premier Alumni",
      },
      {
        property: "og:description",
        content: "Verified people. Considered introductions. Family involved by invitation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      // Structured data: what this organisation is and where it operates.
      // Only the landing page carries it, so the entity is declared once.
      { "script:ld+json": ORGANIZATION_JSON_LD },
    ],
    links: [canonical("/")],
  }),
  component: Index,
});

function Index() {
  return (
    <main>
      <section className="relative overflow-hidden border-b border-border bg-background px-5 pb-10 pt-12 md:px-8 md:pb-16 md:pt-16">
        <div className="absolute inset-x-0 top-0 h-px bg-brass" />
        <div className="mx-auto grid max-w-7xl items-end gap-12 lg:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-brass">
              <span className="h-px w-9 bg-brass" /> Membership by verification
            </div>
            <h1 className="mt-5 max-w-[16ch] font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.25rem] xl:text-[3.75rem]">
              For people who built their own lives—and wish to choose their own partner.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
              A discreet matrimonial membership for premier-institute alumni. Candidates lead every
              decision. Families contribute with permission.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link to="/apply">
                  Request membership <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/auth">Sign in to the Circle</Link>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-muted-foreground">
              <span className="flex items-center gap-2">
                <Check className="size-4 text-success" /> No public directory
              </span>
              <span className="flex items-center gap-2">
                <Check className="size-4 text-success" /> Institution verified
              </span>
              <span className="flex items-center gap-2">
                <Check className="size-4 text-success" /> Candidate consent first
              </span>
            </div>
          </div>
          <aside className="border-l border-brass pl-6 md:pl-9">
            <p className="font-serif text-2xl leading-9 text-foreground">
              “A smaller circle, held to a higher standard.”
            </p>
            <dl className="mt-8 grid grid-cols-2 gap-x-5 gap-y-7 border-t border-border pt-7">
              <div>
                <dt className="font-serif text-3xl font-semibold">
                  100<span className="text-[0.7em] align-baseline">%</span>
                </dt>
                <dd className="mt-1 text-xs text-muted-foreground">
                  identity checked before access
                </dd>
              </div>
              <div>
                <dt className="font-serif text-3xl font-semibold">1:1</dt>
                <dd className="mt-1 text-xs text-muted-foreground">human review</dd>
              </div>
              <div>
                <dt className="font-serif text-3xl font-semibold">Zero</dt>
                <dd className="mt-1 text-xs text-muted-foreground">public profiles</dd>
              </div>
              <div>
                <dt className="font-serif text-3xl font-semibold">You</dt>
                <dd className="mt-1 text-xs text-muted-foreground">retain control</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>

      <section className="border-b border-border bg-secondary/45 px-5 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-7 md:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass">
                A considered model
              </p>
              <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-5xl">
                Candidate leads.
                <br />
                Family co-pilots.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-8 text-muted-foreground">
              Matrimony can honour both individual agency and family wisdom. Here, the candidate
              owns the profile, controls visibility, receives every introduction, and makes every
              decision. A parent or trusted person may join only when invited.
            </p>
          </div>
          <div className="mt-12 grid border-y border-border md:grid-cols-3 md:divide-x md:divide-y-0 divide-y divide-border">
            <Principle
              n="01"
              icon={<UserRound />}
              title="You hold the keys"
              text="Only the candidate can accept interest, reveal photographs, or begin a conversation."
            />
            <Principle
              n="02"
              icon={<UsersRound />}
              title="Family adds perspective"
              text="A chosen co-pilot can suggest profiles and discuss privately—never act in your name."
            />
            <Principle
              n="03"
              icon={<LockKeyhole />}
              title="Boundaries stay visible"
              text="Every permission is explicit, reversible, and recorded in your privacy centre."
            />
          </div>
        </div>
      </section>

      <section id="verification" className="border-b border-border px-5 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass">
                Membership standards
              </p>
              <h2 className="mt-3 font-serif text-4xl font-semibold md:text-5xl">
                A circle with clear criteria.
              </h2>
              <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
                Membership is limited by design. Every application is reviewed by a trained
                membership specialist.
              </p>
            </div>
            <div className="grid sm:grid-cols-2">
              <Eligibility
                icon={<GraduationCap />}
                title="Indian institutions"
                text="IITs, IIMs, BITS Pilani, FMS, JBIMS, NIFT, IISc, ISI, NLSIU and a considered list of comparable institutions."
              />
              <Eligibility
                icon={<FileCheck2 />}
                title="Global universities"
                text="Leading international universities assessed through recognised rankings and programme selectivity."
              />
              <Eligibility
                icon={<Fingerprint />}
                title="Identity and education"
                text="Government identity plus institutional email, alumni record, degree, or registrar-confirmed documentation."
              />
              <Eligibility
                icon={<ShieldCheck />}
                title="Intent and conduct"
                text="Adults seeking committed partnership, with agreement to our safety and respectful-conduct standards."
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-forest px-5 py-16 text-forest-foreground md:px-8 md:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid items-start gap-10 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass-strong">
                Privacy, by architecture
              </p>
              <h2 className="mt-3 font-serif text-4xl font-semibold md:text-5xl">
                Discretion is not a setting added later.
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Privacy
                icon={<EyeOff />}
                title="Ghost mode"
                text="Be discoverable only to profiles you choose or explicitly approve."
              />
              <Privacy
                icon={<LockKeyhole />}
                title="Private by default"
                text="No public listing, search-engine indexing, or open browsing."
              />
              <Privacy
                icon={<ShieldCheck />}
                title="Verified access"
                text="Only approved members can enter the introduction network."
              />
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-16 text-center md:px-8 md:py-24">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass">
            Applications reviewed individually
          </p>
          <h2 className="mt-4 font-serif text-4xl font-semibold md:text-6xl">
            Start with your story, not a biodata.
          </h2>
          <p className="mx-auto mt-5 max-w-xl leading-7 text-muted-foreground">
            Join a matrimonial community designed for mature decisions, thoughtful families, and
            privacy without compromise.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/apply">
              Begin private application <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

function Principle({
  n,
  icon,
  title,
  text,
}: {
  n: string;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <article className="py-7 md:px-7 md:py-9 first:pl-0">
      <div className="flex items-center justify-between text-brass">
        <span className="[&_svg]:size-5">{icon}</span>
        <span className="font-serif text-sm italic">{n}</span>
      </div>
      <h3 className="mt-6 font-serif text-2xl font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{text}</p>
    </article>
  );
}
function Eligibility({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="border border-border p-6 md:p-7">
      <span className="text-brass [&_svg]:size-6">{icon}</span>
      <h3 className="mt-5 font-serif text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </article>
  );
}
function Privacy({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="border border-forest-foreground/20 p-5">
      <span className="text-brass-strong [&_svg]:size-5">{icon}</span>
      <h3 className="mt-5 font-serif text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-forest-foreground/60">{text}</p>
    </article>
  );
}
