import { describe, expect, it } from "vitest";
import { notificationDestination } from "./safe-link";

describe("notificationDestination", () => {
  it("keeps whitelisted destinations", () => {
    expect(notificationDestination("/connections")).toBe("/connections");
    expect(notificationDestination("/copilots")).toBe("/copilots");
    expect(notificationDestination("/notifications")).toBe("/notifications");
    expect(notificationDestination("/dashboard")).toBe("/dashboard");
    expect(notificationDestination("/verification")).toBe("/verification");
  });
  it("rewrites external or unknown links to the dashboard", () => {
    expect(notificationDestination("https://evil.example")).toBe("/dashboard");
    expect(notificationDestination("//evil.example")).toBe("/dashboard");
    expect(notificationDestination(null)).toBe("/dashboard");
  });
});
