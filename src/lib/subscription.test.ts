import { describe, expect, it } from "vitest";
import {
  isEventStale,
  isSubscriptionLive,
  isTerminalSubscriptionState,
} from "./subscription-liveness";

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

describe("Subscription live-status resolution (matches private.live_subscription)", () => {
  const now = new Date("2026-10-18T12:00:00Z").getTime();
  const future = "2026-10-19T12:00:00Z";
  const past = "2026-10-17T12:00:00Z";
  const paid = 149_900;

  it("considers active or authenticated with unexpired period as live", () => {
    expect(isSubscriptionLive("active", future, paid, now)).toBe(true);
    expect(isSubscriptionLive("authenticated", future, paid, now)).toBe(true);
    expect(isSubscriptionLive("active", null, paid, now)).toBe(true);
  });

  it("does not consider expired period_end as live (immediate cutoff, no grace)", () => {
    expect(isSubscriptionLive("active", past, paid, now)).toBe(false);
    expect(isSubscriptionLive("authenticated", past, paid, now)).toBe(false);
  });

  it("strictly rejects pending, created, or terminal states from entitling", () => {
    // 'pending' is the payment-failure state: must never entitle
    expect(isSubscriptionLive("pending", future, paid, now)).toBe(false);
    // 'created' is an abandoned checkout: must never entitle
    expect(isSubscriptionLive("created", future, paid, now)).toBe(false);
    expect(isSubscriptionLive("cancelled", future, paid, now)).toBe(false);
    expect(isSubscriptionLive("halted", future, paid, now)).toBe(false);
  });

  // REGRESSION (H-4): an entitling status alone is not proof that money
  // moved. The webhook's `subscription.activated` branch writes status
  // 'active' before any invoice has been recorded, and the database refuses
  // to entitle a row with no amount_paid_paise. The browser mirror must
  // agree, or it would show a paid tier the database will not grant.
  it("does not entitle a row with no recorded payment evidence", () => {
    expect(isSubscriptionLive("active", future, null, now)).toBe(false);
    expect(isSubscriptionLive("authenticated", future, null, now)).toBe(false);
  });

  it("entitles a row once a payment has been recorded, even at a zero amount", () => {
    // The database's test is `amount_paid_paise IS NOT NULL`, so a recorded
    // zero is still evidence. Keeping the two in step matters.
    expect(isSubscriptionLive("active", future, 0, now)).toBe(true);
  });

  it("prioritizes live active/authenticated over stale/abandoned checkouts in candidate list", () => {
    const rows = [
      { id: "1", status: "created", period_end: null, amount_paid_paise: null },
      { id: "2", status: "pending", period_end: future, amount_paid_paise: paid },
      { id: "3", status: "active", period_end: past, amount_paid_paise: paid }, // lapsed
      { id: "4", status: "active", period_end: future, amount_paid_paise: null }, // no payment yet
      { id: "5", status: "active", period_end: future, amount_paid_paise: paid }, // genuine live subscription
    ];

    const liveSub = rows.find((r) =>
      isSubscriptionLive(r.status, r.period_end, r.amount_paid_paise, now),
    );
    expect(liveSub?.id).toBe("5");
    expect(liveSub?.status).toBe("active");
  });
});
