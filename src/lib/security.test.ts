import { describe, expect, it } from "vitest";
import {
  buildCsp,
  cacheControlFor,
  isAuthenticatedPath,
  securityHeaders,
  withSecurityHeaders,
} from "./security-headers";

describe("securityHeaders", () => {
  it("enforces strict frame-ancestors in production to prevent clickjacking", () => {
    // The production policy is asserted DIRECTLY. The previous test guarded
    // these assertions behind `import.meta.env.PROD`, which is false under
    // Vitest, so the clickjacking defence was never actually tested in CI.
    const csp = buildCsp(true);

    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("*.lovable.app");
    expect(csp).not.toContain("*.lovableproject.com");
    expect(csp).not.toContain("http://localhost:3000");
  });

  it("keeps the base directives in the production policy", () => {
    const csp = buildCsp(true);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("allows the dev embedders only in the dev policy", () => {
    expect(buildCsp(false)).toContain("http://localhost:3000");
    expect(buildCsp(true)).not.toContain("http://localhost:3000");
  });

  it("sets standard defensive headers", () => {
    const headers = securityHeaders();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(headers["x-permitted-cross-domain-policies"]).toBe("none");
  });

  it("sets HSTS in production and only in production", () => {
    // The production branch is asserted directly rather than behind
    // `import.meta.env.PROD`, which is false under Vitest — that guard is
    // exactly why the HSTS header was never covered.
    expect(securityHeaders(true)["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(securityHeaders(false)["strict-transport-security"]).toBeUndefined();
  });
});

describe("cache policy", () => {
  // A member-only document must never be readable from a shared browser's
  // disk cache, and must never be stored by a proxy.
  const memberPaths = [
    "/dashboard",
    "/members",
    "/members/2f6c0f4a-0000-4000-8000-000000000000",
    "/connections",
    "/messages",
    "/messages/2f6c0f4a-0000-4000-8000-000000000000",
    "/calls",
    "/call/2f6c0f4a-0000-4000-8000-000000000000",
    "/shortlist",
    "/notifications",
    "/copilots",
    "/copilot-invite/abc123",
    "/onboarding",
    "/verification",
    "/settings",
    "/admin",
  ];

  it("marks every member-only path as private and no-store", () => {
    for (const path of memberPaths) {
      expect(isAuthenticatedPath(path), path).toBe(true);
      expect(cacheControlFor(path), path).toBe("private, no-store, max-age=0");
    }
  });

  it("does not treat public pages as member-only", () => {
    for (const path of ["/", "/apply", "/auth", "/privacy", "/terms", "/standards", "/grievance"]) {
      expect(isAuthenticatedPath(path), path).toBe(false);
      expect(cacheControlFor(path), path).not.toContain("no-store");
    }
  });
});

describe("withSecurityHeaders", () => {
  it("adds the headers to a response that has none", () => {
    const response = withSecurityHeaders(new Response("ok", { status: 200 }));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("never overwrites a header the response already set", () => {
    // A route that deliberately sets its own header keeps it.
    const response = withSecurityHeaders(
      new Response("ok", { status: 200, headers: { "x-content-type-options": "custom" } }),
    );
    expect(response.headers.get("x-content-type-options")).toBe("custom");
  });
});
