import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

describe("securityHeaders", () => {
  it("enforces strict frame-ancestors in production to prevent clickjacking", () => {
    // In production, frame-ancestors must only allow 'self'
    const headers = securityHeaders();
    const csp = headers["content-security-policy"] ?? "";

    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");

    // Must never allow arbitrary third-party lov* wildcard embedding in production
    if (import.meta.env["PROD"]) {
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).not.toContain("*.lovable.app");
      expect(csp).not.toContain("*.lovableproject.com");
    }
  });

  it("sets standard defensive headers", () => {
    const headers = securityHeaders();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
