import { describe, expect, it } from "vitest";
import { clampDayForMonth, buildIsoDate } from "@/lib/dob";

describe("dob utilities", () => {
  it("clamps invalid days for 30-day months", () => {
    // April has 30 days
    expect(clampDayForMonth(31, 4, 1995)).toBe(30);
    // June has 30 days
    expect(clampDayForMonth(31, 6, 1995)).toBe(30);
    // Valid day 15 unchanged
    expect(clampDayForMonth(15, 4, 1995)).toBe(15);
  });

  it("clamps February days accurately for leap and non-leap years", () => {
    // 2000 is a leap year (29 days)
    expect(clampDayForMonth(31, 2, 2000)).toBe(29);
    // 1999 is not a leap year (28 days)
    expect(clampDayForMonth(31, 2, 1999)).toBe(28);
    // 2004 is a leap year (29 days)
    expect(clampDayForMonth(29, 2, 2004)).toBe(29);
  });

  it("builds valid ISO dates when all 3 fields are present", () => {
    expect(buildIsoDate("15", "05", "1998")).toBe("1998-05-15");
    expect(buildIsoDate("1", "1", "2001")).toBe("2001-01-01");
  });

  it("returns empty string if any field is missing", () => {
    expect(buildIsoDate("", "05", "1998")).toBe("");
    expect(buildIsoDate("15", "", "1998")).toBe("");
    expect(buildIsoDate("15", "05", "")).toBe("");
  });

  it("clamps day when building ISO date", () => {
    // 31st of February 1999 clamped to 28
    expect(buildIsoDate("31", "02", "1999")).toBe("1999-02-28");
    // 31st of April 1995 clamped to 30
    expect(buildIsoDate("31", "04", "1995")).toBe("1995-04-30");
  });
});
