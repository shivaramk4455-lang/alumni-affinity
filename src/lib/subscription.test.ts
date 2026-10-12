import { describe, expect, it } from "vitest";

describe("Webhook timestamp ordering logic", () => {
  function isEventStale(eventCreatedAtSeconds: number, existingUpdatedAtIso: string): boolean {
    const existingSeconds = Math.floor(new Date(existingUpdatedAtIso).getTime() / 1000);
    return eventCreatedAtSeconds < existingSeconds;
  }

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

  it("does not allow regression from terminal states back to entitling state", () => {
    const TERMINAL = new Set(["halted", "cancelled", "completed", "expired"]);
    function shouldIgnoreTerminalRegression(currentStatus: string, eventName: string): boolean {
      return TERMINAL.has(currentStatus) && eventName === "invoice.paid";
    }

    expect(shouldIgnoreTerminalRegression("cancelled", "invoice.paid")).toBe(true);
    expect(shouldIgnoreTerminalRegression("active", "invoice.paid")).toBe(false);
  });
});

describe("Subscription live-status resolution", () => {
  it("prioritizes active/authenticated/pending status over legacy created checkouts", () => {
    const rows = [
      { id: "1", status: "created", created_at: "2026-10-01T00:00:00Z" },
      { id: "2", status: "created", created_at: "2026-10-02T00:00:00Z" },
      { id: "3", status: "active", created_at: "2026-10-03T00:00:00Z" },
    ];

    const liveSub = rows.find((r) => ["active", "authenticated", "pending"].includes(r.status));
    expect(liveSub?.id).toBe("3");
    expect(liveSub?.status).toBe("active");
  });
});
