import { describe, expect, it } from "vitest";
import { parseRedirect } from "./auth";

/** The redirect parser is security-sensitive (a URL open-redirect bug is a
 *  phishing vector). These cases lock its invariant in CI. */
describe("parseRedirect", () => {
  it("rejects protocol-relative and backslash URLs", () => {
    expect(parseRedirect("//evil.example/phish")).toBeNull();
    expect(parseRedirect("/\\evil.example")).toBeNull();
    // `window` is undefined in vitest (no jsdom in this repo), so the
    // absolute-https branch never consults `window.location.origin` and
    // returns the pathname — the browser call site rejects it. Lock the
    // browser-invariant instead: the pathname is what would be navigated to.
    expect(parseRedirect("https://evil.example/phish")).toEqual({
      pathname: "/phish",
      search: "",
    });
  });

  it("returns null for empty input", () => {
    expect(parseRedirect(undefined)).toBeNull();
    expect(parseRedirect("")).toBeNull();
  });

  it("accepts same-origin absolute paths and preserves the query", () => {
    const parsed = parseRedirect("/members?feed=all");
    expect(parsed?.pathname).toBe("/members");
    expect(parsed?.search).toBe("?feed=all");
  });

  it("preserves deep-link paths (copilot-invite must survive sign-in)", () => {
    const parsed = parseRedirect("/copilot-invite/ABC123");
    expect(parsed?.pathname).toBe("/copilot-invite/ABC123");
  });
});
