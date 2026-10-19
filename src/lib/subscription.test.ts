import { describe, expect, it } from "vitest";
import { isEventStale, isSubscriptionLive, isTerminalSubscriptionState } from "./subscription";

describe("Webhook timestamp ordering logic", () => {
  it("does not drop legitimate same-second subsequent events due to subsecond updated_at", () => {
    // Razorpay webhook timestamps are integer seconds.
    // Supabase stores ISO strings with millisecond/microsecond precision.
    const eventTimeSeconds = 1728560000;
    // Postgres updated_at written with subsecond precision in the same second:
    const existingUpdatedAt = "2024-10-10T11:33:20.450Z";

    // Same-second event must NEVER be treated as stale
    expect(isEventStale(eventTimeSeconds, existingUpdatedAt)).toBe(false);
  });

  it("correctly identifies genuinely older replay events as stale", () => {
    const eventTimeSeconds = 1728559990; // 10 seconds earlier
    const existingUpdatedAt = "2024-10-10T11:33:20.450Z";

    expect(isEventStale(eventTimeSeconds, existingUpdatedAt)).toBe(true);
  });

  it("identifies terminal states correctly and forbids regression back to active", () => {
    expect(isTerminalSubscriptionState("cancelled")).toBe(true);
    expect(isTerminalSubscriptionState("halted")).toBe(true);
    expect(isTerminalSubscriptionState("completed")).toBe(true);
    expect(isTerminalSubscriptionState("expired")).toBe(true);
    expect(isTerminalSubscriptionState("active")).toBe(false);
    expect(isTerminalSubscriptionState("authenticated")).toBe(false);
    expect(isTerminalSubscriptionState("pending")).toBe(false);
  });
});

describe("Subscription live-status resolution (matches private.subscription_is_live)", () => {
  const now = new Date("2026-10-18T12:00:00Z").getTime();
  const future = "2026-10-19T12:00:00Z";
  const past = "2026-10-17T12:00:00Z";

  it("considers active or authenticated with unexpired period as live", () => {
    expect(isSubscriptionLive("active", future, now)).toBe(true);
    expect(isSubscriptionLive("authenticated", future, now)).toBe(true);
    expect(isSubscriptionLive("active", null, now)).toBe(true);
  });

  it("does not consider expired period_end as live (immediate cutoff, no grace)", () => {
    expect(isSubscriptionLive("active", past, now)).toBe(false);
    expect(isSubscriptionLive("authenticated", past, now)).toBe(false);
  });

  it("strictly rejects pending, created, or terminal states from entitling", () => {
    // 'pending' is the payment-failure state: must never entitle
    expect(isSubscriptionLive("pending", future, now)).toBe(false);
    // 'created' is an abandoned checkout: must never entitle
    expect(isSubscriptionLive("created", future, now)).toBe(false);
    expect(isSubscriptionLive("cancelled", future, now)).toBe(false);
    expect(isSubscriptionLive("halted", future, now)).toBe(false);
  });

  it("prioritizes live active/authenticated over stale/abandoned checkouts in candidate list", () => {
    const rows = [
      { id: "1", status: "created", period_end: null },
      { id: "2", status: "pending", period_end: future },
      { id: "3", status: "active", period_end: past }, // lapsed
      { id: "4", status: "active", period_end: future }, // genuine live subscription
    ];

    const liveSub = rows.find((r) => isSubscriptionLive(r.status, r.period_end, now));
    expect(liveSub?.id).toBe("4");
    expect(liveSub?.status).toBe("active");
  });
});
