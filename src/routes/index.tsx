import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  EyeOff,
  FileCheck2,
  Fingerprint,
  GraduationCap,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { SITE_TAGLINE } from "@/lib/legal-identity";
import { Button } from "@/components/ui/button";
import { canonical, ORGANIZATION_JSON_LD } from "@/lib/seo";

const ILLUSTRATIVE_ARCHETYPES = [
  {
    monogram: "A·R",
    cohort: "IIT Bombay ’19",
    degree: "B.Tech & M.Tech, Electrical Engineering",
    role: "Principal Systems Architect",
    location: "Bengaluru · Open to relocation",
    tags: ["Classical Carnatic", "Vegetarian", "Family co-pilot active"],
    visibilityNote: "Employer & photograph unlocked upon mutual introduction",
  },
  {
    monogram: "M·S",
    cohort: "IIM Ahmedabad ’21",
    degree: "PGP in Management · SRCC ’19",
    role: "Vice President, Private Equity",
    location: "Mumbai",
    tags: ["Marathoner", "Non-smoker", "Candidate-led"],
    visibilityNote: "Batch & surname shielded to fellow firm alumni",
  },
  {
    monogram: "K·V",
    cohort: "AIIMS New Delhi ’18",
    degree: "MBBS, MD (Internal Medicine)",
    role: "Senior Clinical Fellow",
    location: "London · Returning to India ’27",
    tags: ["Reader & flautist", "Teetotaller", "Horoscope optional"],
    visibilityNote: "Photographs blurred until explicit gallery grant",
  },
  {
    monogram: "R·N",
    cohort: "BITS Pilani ’20 · Stanford ’22",
    degree: "M.S. Computer Science",
    role: "Staff Machine Learning Engineer",
    location: "San Francisco · Bengaluru roots",
    tags: ["Mountaineering", "Egalitarian values", "Parent co-pilot invited"],
    visibilityNote: "Direct messaging opens only after candidate acceptance",
  },
] as const;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `The Merit Circle — ${SITE_TAGLINE}` },
      {
        name: "description",
        content: `${SITE_TAGLINE}. A discreet, verified matrimonial circle where candidates lead and families participate by invitation.`,
      },
      { property: "og:title", content: `The Merit Circle — ${SITE_TAGLINE}` },
      {
        property: "og:description",
        content: `${SITE_TAGLINE}. Candidate-led introductions, family co-piloted, private by design.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
              <span className="h-px w-9 bg-brass" /> {SITE_TAGLINE}
            </div>
            <h1 className="mt-5 max-w-[16ch] font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.25rem] xl:text-[3.75rem]">
              For people who built their own lives—and wish to choose their own partner.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
              Thoughtful matchmaking for IIT, IIM and leading-institution alumni. Candidates lead
              every introduction; families participate by invitation.
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
            <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-border pt-6 text-sm">
              <div>
                <dt className="font-serif text-base font-semibold text-foreground">
                  Verified credentials
                </dt>
                <dd className="mt-1 text-xs leading-5 text-muted-foreground">
                  Government ID & degree confirmed prior to directory entry
                </dd>
              </div>
              <div>
                <dt className="font-serif text-base font-semibold text-foreground">
                  Individual review
                </dt>
                <dd className="mt-1 text-xs leading-5 text-muted-foreground">
                  Manual membership desk evaluation for every application
                </dd>
              </div>
              <div>
                <dt className="font-serif text-base font-semibold text-foreground">
                  Complete discretion
                </dt>
                <dd className="mt-1 text-xs leading-5 text-muted-foreground">
                  No public index, no open search, and ghost mode by default
                </dd>
              </div>
              <div>
                <dt className="font-serif text-base font-semibold text-foreground">
                  Candidate consent
                </dt>
                <dd className="mt-1 text-xs leading-5 text-muted-foreground">
                  Introductions, photos, and contact sharing require your approval
                </dd>
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
                text="IITs, IIMs, AIIMS, BITS Pilani, FMS, JBIMS, NIFT, IISc, ISI, NLSIU and a considered list of comparable institutions."
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

      <section
        id="inside-the-circle"
        className="border-b border-border px-5 py-16 md:px-8 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brass">
                Inside the Circle — Illustrative Profiles
              </p>
              <h2 className="mt-3 font-serif text-4xl font-semibold md:text-5xl">
                Dignified dossiers, never a public feed.
              </h2>
              <p className="mt-5 text-sm leading-7 text-muted-foreground">
                Real member profiles are never displayed publicly. The composite archetypes below
                illustrate how institutional credentials, personal values, and granular discretion
                locks appear inside a verified member dossier.
              </p>
            </div>
            <div className="self-start border border-border bg-secondary/60 px-3.5 py-2 text-xs font-medium text-muted-foreground lg:self-auto">
              Illustrative composite archetypes · Real member profiles are strictly private
            </div>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ILLUSTRATIVE_ARCHETYPES.map((item) => (
              <article
                key={item.cohort}
                className="flex flex-col justify-between border border-border bg-card p-6 transition-colors hover:border-brass/60"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid size-12 shrink-0 place-items-center border border-brass/50 bg-secondary font-serif text-base font-semibold tracking-wider text-foreground">
                      {item.monogram}
                    </div>
                    <span className="inline-flex items-center gap-1.5 border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-success">
                      <ShieldCheck className="size-3.5" aria-hidden="true" /> Verified
                    </span>
                  </div>

                  <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-brass">
                    {item.cohort}
                  </p>
                  <h3 className="mt-1.5 font-serif text-xl font-semibold leading-snug text-foreground">
                    {item.role}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{item.degree}</p>

                  <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                    <MapPin className="size-3.5 shrink-0 text-brass" aria-hidden="true" />
                    {item.location}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="border border-border bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 border-t border-border pt-3.5">
                  <p className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
                    <LockKeyhole
                      className="mt-0.5 size-3.5 shrink-0 text-brass"
                      aria-hidden="true"
                    />
                    <span>{item.visibilityNote}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              Full dossier records, photographs, and contact information are strictly gated to
              verified members upon mutual consent.
            </p>
            <Link
              to="/standards"
              className="shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-foreground underline-offset-4 hover:underline"
            >
              Review eligibility standards →
            </Link>
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
