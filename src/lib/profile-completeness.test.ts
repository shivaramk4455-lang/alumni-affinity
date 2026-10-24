import { describe, expect, it } from "vitest";

import { profileCompleteness } from "@/lib/profile-completeness";
import type { MyProfileRow } from "@/lib/profile-columns";

describe("profileCompleteness", () => {
  it("returns 0% for a null or empty profile", () => {
    const resNull = profileCompleteness(null);
    expect(resNull.percent).toBe(0);
    expect(resNull.earned).toBe(0);
    expect(resNull.missing.length).toBeGreaterThan(0);

    const resEmpty = profileCompleteness({} as MyProfileRow);
    expect(resEmpty.percent).toBe(0);
    expect(resEmpty.earned).toBe(0);
  });

  it("calculates partial score correctly for photograph and bio", () => {
    const profile = {
      photo_path: "profiles/user-123/primary.webp",
      bio: "Engineering lead living in Bengaluru, passionate about hiking and design.",
    } as MyProfileRow;

    const res = profileCompleteness(profile);
    // photo_path = 30 points, bio = 15 points, total = 102 -> Math.round(45 / 102 * 100) = 44%
    expect(res.earned).toBe(45);
    expect(res.total).toBe(102);
    expect(res.percent).toBe(44);
    expect(res.missing.some((m) => m.label.includes("photograph"))).toBe(false);
    expect(res.missing.some((m) => m.label.includes("introduction"))).toBe(false);
    expect(res.missing.some((m) => m.label === "Write what you are looking for")).toBe(true);
  });

  it("requires values_statement to be at least 20 characters", () => {
    const shortValues = {
      values_statement: "Too short",
    } as MyProfileRow;
    expect(profileCompleteness(shortValues).earned).toBe(0);

    const validValues = {
      values_statement: "Looking for an intellectually curious partner who values family.",
    } as MyProfileRow;
    // values_statement = 20 points
    expect(profileCompleteness(validValues).earned).toBe(20);
  });

  it("requires all three education fields (institution, degree, grad_year) to score education weight", () => {
    const partialEdu = {
      institution: "IIT Bombay",
      degree: "B.Tech",
    } as MyProfileRow;
    expect(profileCompleteness(partialEdu).earned).toBe(0);

    const fullEdu = {
      institution: "IIT Bombay",
      degree: "B.Tech",
      grad_year: 2020,
    } as MyProfileRow;
    expect(profileCompleteness(fullEdu).earned).toBe(15);
  });

  it("awards 100% when all key profile components are populated", () => {
    const fullProfile = {
      photo_path: "user/photo.jpg",
      values_statement: "Looking for a grounded, ambitious life partner to build with.",
      bio: "Tech entrepreneur based in Mumbai.",
      institution: "IIM Ahmedabad",
      degree: "MBA",
      grad_year: 2018,
      profession: "Product Manager",
      city: "Mumbai",
      height_cm: 180,
      diet: "Vegetarian",
      marital_status: "Never Married",
      mother_tongue: "Hindi",
      residency_status: "Citizen",
      nakshatra: "Rohini",
      religion: "Hindu",
    } as MyProfileRow;

    const res = profileCompleteness(fullProfile);
    expect(res.earned).toBe(102);
    expect(res.percent).toBe(100);
    expect(res.missing).toHaveLength(0);
  });
});
