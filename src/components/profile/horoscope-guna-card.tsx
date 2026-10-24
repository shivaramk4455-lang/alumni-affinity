import { Link } from "@tanstack/react-router";
import type { GunaResult } from "@/lib/guna-milan";
import { DetailRow } from "./detail-row";

interface HoroscopeGunaCardProps {
  data?:
    | {
        nakshatra?: string | null | undefined;
        nakshatra_pada?: number | string | null | undefined;
        rashi?: string | null | undefined;
        manglik?: string | null | undefined;
        birth_time?: string | null | undefined;
        birth_place?: string | null | undefined;
      }
    | null
    | undefined;
  isSelf: boolean;
  guna?: GunaResult | null | undefined;
  gunaBand?: { label: string; tone: "excellent" | "good" | "fair" | "low" } | null | undefined;
  myNakshatra?: string | null | undefined;
}

export function HoroscopeGunaCard({
  data,
  isSelf,
  guna,
  gunaBand,
  myNakshatra,
}: HoroscopeGunaCardProps) {
  const hasTheirHoroscope = Boolean(
    data?.nakshatra || data?.rashi || data?.manglik || data?.birth_time || data?.birth_place,
  );

  if (!hasTheirHoroscope) return null;

  return (
    <section className="mt-6 border-t border-border pt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
        Horoscope
      </p>
      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
        {data?.nakshatra && (
          <DetailRow
            k="Birth star (Nakshatra)"
            v={
              data.nakshatra_pada
                ? `${data.nakshatra} · Pada ${data.nakshatra_pada}`
                : data.nakshatra
            }
          />
        )}
        {data?.rashi && <DetailRow k="Moon sign (Rashi)" v={data.rashi} />}
        {data?.manglik && <DetailRow k="Manglik" v={data.manglik} />}
        {data?.birth_time && <DetailRow k="Time of birth" v={data.birth_time} />}
        {data?.birth_place && <DetailRow k="Place of birth" v={data.birth_place} />}
      </dl>

      {!isSelf && (
        <div className="mt-4 border border-brass/40 bg-brass/5 p-4">
          {guna && gunaBand ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-serif text-lg font-semibold">Guna Milan</p>
                <span
                  className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold ${
                    gunaBand.tone === "excellent" || gunaBand.tone === "good"
                      ? "border-success/40 bg-success/10 text-success"
                      : gunaBand.tone === "fair"
                        ? "border-brass/50 bg-brass/10 text-brass-strong"
                        : "border-border bg-secondary/40 text-muted-foreground"
                  }`}
                >
                  {gunaBand.label}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-serif text-2xl font-semibold text-foreground">
                  {guna.total}
                </span>
                <span className="text-muted-foreground"> / {guna.max} Ashtakoota</span>
              </p>
              <ul className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                {guna.kootas.map((k) => (
                  <li key={k.name} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{k.name}</span>
                    <span className="font-semibold tabular-nums">
                      {k.score}/{k.max}
                    </span>
                  </li>
                ))}
              </ul>
              {guna.manglikDosha === "present" && (
                <p className="mt-3 text-xs leading-5 text-destructive">
                  One of you is Manglik. Families often look for remedies or a Manglik partner —
                  please discuss this with the desk.
                </p>
              )}
              {guna.manglikDosha === "cancelled" && (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Both of you are Manglik, so the dosha is traditionally considered cancelled.
                </p>
              )}
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Ashtakoota is guidance, not a verdict — only visible to you, and best read alongside
                a jyotishi.
              </p>
            </>
          ) : !myNakshatra ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Add your own birth star in{" "}
              <Link
                to="/onboarding"
                className="font-semibold text-brass underline underline-offset-2"
              >
                your profile
              </Link>{" "}
              to see a Guna Milan compatibility score with this member.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
