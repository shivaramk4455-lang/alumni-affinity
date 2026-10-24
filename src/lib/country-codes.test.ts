import { describe, expect, it } from "vitest";
import { parsePhoneNumber, getDialCodeNumeric } from "./country-codes";

describe("country-codes", () => {
  it("defaults empty input to India (+91)", () => {
    expect(parsePhoneNumber("")).toEqual({ countryCode: "+91", localNumber: "" });
    expect(parsePhoneNumber(null)).toEqual({ countryCode: "+91", localNumber: "" });
  });

  it("parses +91 Indian mobile numbers correctly", () => {
    expect(parsePhoneNumber("+91 9876543210")).toEqual({
      countryCode: "+91",
      localNumber: "9876543210",
    });
    expect(parsePhoneNumber("+919876543210")).toEqual({
      countryCode: "+91",
      localNumber: "9876543210",
    });
  });

  it("parses international country codes correctly", () => {
    // US
    expect(parsePhoneNumber("+1 4155552671")).toEqual({
      countryCode: "+1",
      localNumber: "4155552671",
    });
    // UK
    expect(parsePhoneNumber("+44 7911 123456")).toEqual({
      countryCode: "+44",
      localNumber: "7911 123456",
    });
    // UAE
    expect(parsePhoneNumber("+971 50 123 4567")).toEqual({
      countryCode: "+971",
      localNumber: "50 123 4567",
    });
    // Singapore
    expect(parsePhoneNumber("+65 8123 4567")).toEqual({
      countryCode: "+65",
      localNumber: "8123 4567",
    });
    // Australia
    expect(parsePhoneNumber("+61 412 345 678")).toEqual({
      countryCode: "+61",
      localNumber: "412 345 678",
    });
    // Germany
    expect(parsePhoneNumber("+49 151 23456789")).toEqual({
      countryCode: "+49",
      localNumber: "151 23456789",
    });
    // Saudi Arabia
    expect(parsePhoneNumber("+966 50 123 4567")).toEqual({
      countryCode: "+966",
      localNumber: "50 123 4567",
    });
  });

  it("handles numbers typed without dial code prefix by assuming +91", () => {
    expect(parsePhoneNumber("9876543210")).toEqual({
      countryCode: "+91",
      localNumber: "9876543210",
    });
    expect(parsePhoneNumber("919876543210")).toEqual({
      countryCode: "+91",
      localNumber: "9876543210",
    });
  });

  it("handles getDialCodeNumeric correctly", () => {
    expect(getDialCodeNumeric("+91")).toBe("+91");
    expect(getDialCodeNumeric("+1")).toBe("+1");
    expect(getDialCodeNumeric("+1-CA")).toBe("+1");
    expect(getDialCodeNumeric("+44")).toBe("+44");
  });
});
