import { describe, expect, it } from "vitest";

import { computeGunaMilan, gunaVerdict, type HoroscopeInput } from "./guna-milan";

const h = (nakshatra: string, rashi?: string, manglik?: string): HoroscopeInput => ({
  nakshatra,
  rashi: rashi ?? null,
  manglik: manglik ?? null,
});

describe("computeGunaMilan", () => {
  it("returns null when either member has no birth star", () => {
    expect(computeGunaMilan(h("Ashwini"), h(""))).toBeNull();
    expect(computeGunaMilan(h(""), h("Rohini"))).toBeNull();
    expect(computeGunaMilan(h("Not A Star"), h("Rohini"))).toBeNull();
  });

  it("awards the full 8-point Nadi only when Nadi differs", () => {
    // Ashwini (Aadi) vs Bharani (Madhya) — different Nadi => 8.
    const diff = computeGunaMilan(h("Ashwini"), h("Bharani"))!;
    expect(diff.kootas.find((k) => k.name === "Nadi")!.score).toBe(8);
    // Same Nadi (Ashwini & Punarvasu are both Aadi) => 0 (Nadi dosha).
    const same = computeGunaMilan(h("Ashwini"), h("Punarvasu"))!;
    expect(same.kootas.find((k) => k.name === "Nadi")!.score).toBe(0);
    expect(same.kootas.find((k) => k.name === "Nadi")!.detail).toMatch(/dosha/i);
  });

  it("never exceeds 36 and never drops below 0", () => {
    const stars = [
      "Ashwini",
      "Bharani",
      "Krittika",
      "Rohini",
      "Mrigashira",
      "Ardra",
      "Punarvasu",
      "Pushya",
      "Ashlesha",
      "Magha",
      "Chitra",
      "Swati",
      "Vishakha",
      "Anuradha",
      "Jyeshtha",
      "Mula",
      "Shravana",
      "Dhanishta",
      "Shatabhisha",
      "Revati",
    ];
    for (const a of stars) {
      for (const b of stars) {
        const r = computeGunaMilan(h(a), h(b))!;
        expect(r.total).toBeGreaterThanOrEqual(0);
        expect(r.total).toBeLessThanOrEqual(36);
        for (const k of r.kootas) {
          expect(k.score).toBeGreaterThanOrEqual(0);
          expect(k.score).toBeLessThanOrEqual(k.max);
        }
      }
    }
  });

  it("gives identical members a strong score, with Nadi dosha as expected", () => {
    const r = computeGunaMilan(h("Rohini"), h("Rohini"))!;
    // Same star: full Varna/Vashya/Yoni/Graha Maitri/Gana/Bhakoot, but the
    // classic Nadi dosha (same Nadi = 0) and Janma Tara (count 1 = 0) apply.
    expect(r.total).toBe(25);
    expect(r.kootas.find((k) => k.name === "Nadi")!.score).toBe(0);
    // Neither passed a Manglik value, so the dosha status is honestly unknown.
    expect(r.manglikDosha).toBe("unknown");
  });

  it("flags Bhakoot dosha on the 6/8 axis and clears it on friendly axes", () => {
    // Mesha (idx 0) vs Kanya (idx 5): distance 5 => 6/8 axis => Bhakoot 0.
    const bad = computeGunaMilan(h("Ashwini", "Mesha"), h("Hasta", "Kanya"))!;
    expect(bad.kootas.find((k) => k.name === "Bhakoot")!.score).toBe(0);
    // Mesha vs Simha (idx 4): distance 4 => favourable => 7.
    const good = computeGunaMilan(h("Ashwini", "Mesha"), h("Magha", "Simha"))!;
    expect(good.kootas.find((k) => k.name === "Bhakoot")!.score).toBe(7);
  });

  it("derives Rashi from the birth star when it is not provided", () => {
    const withRashi = computeGunaMilan(h("Ashwini", "Mesha"), h("Hasta", "Kanya"))!;
    const without = computeGunaMilan(h("Ashwini"), h("Hasta"))!;
    expect(without.total).toBe(withRashi.total);
  });

  it("reports Manglik cancellation when both are Manglik", () => {
    expect(
      computeGunaMilan(h("Ashwini", "Mesha", "Yes"), h("Rohini", "Vrishabha", "Yes"))!.manglikDosha,
    ).toBe("cancelled");
    expect(
      computeGunaMilan(h("Ashwini", "Mesha", "Yes"), h("Rohini", "Vrishabha", "No"))!.manglikDosha,
    ).toBe("present");
    expect(
      computeGunaMilan(h("Ashwini", "Mesha", "No"), h("Rohini", "Vrishabha", "No"))!.manglikDosha,
    ).toBe("none");
    expect(
      computeGunaMilan(h("Ashwini", "Mesha", "Don't know"), h("Rohini", "Vrishabha", "No"))!
        .manglikDosha,
    ).toBe("unknown");
  });
});

describe("gunaVerdict", () => {
  it("bands the score into human labels", () => {
    expect(gunaVerdict(10).tone).toBe("low");
    expect(gunaVerdict(20).tone).toBe("fair");
    expect(gunaVerdict(26).tone).toBe("good");
    expect(gunaVerdict(33).tone).toBe("excellent");
  });
});
