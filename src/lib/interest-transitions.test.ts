import { describe, expect, it } from "vitest";

import { INTEREST_TRANSITIONS, canTransitionInterest, rankInterest } from "./interest-transitions";

describe("canTransitionInterest", () => {
  it("lets only the recipient accept or decline a pending row", () => {
    expect(canTransitionInterest("pending", "accepted", "recipient")).toBe(true);
    expect(canTransitionInterest("pending", "declined", "recipient")).toBe(true);
    expect(canTransitionInterest("pending", "accepted", "sender")).toBe(false);
    expect(canTransitionInterest("pending", "declined", "sender")).toBe(false);
  });

  it("lets the sender withdraw a pending row", () => {
    expect(canTransitionInterest("pending", "withdrawn", "sender")).toBe(true);
    expect(canTransitionInterest("pending", "withdrawn", "recipient")).toBe(false);
  });

  it("lets the original sender re-open a terminal row", () => {
    expect(canTransitionInterest("declined", "pending", "sender")).toBe(true);
    expect(canTransitionInterest("withdrawn", "pending", "sender")).toBe(true);
    expect(canTransitionInterest("expired", "pending", "sender")).toBe(true);
    expect(canTransitionInterest("declined", "pending", "recipient")).toBe(false);
  });

  it("lets both sides block an accepted row, and nothing else", () => {
    expect(canTransitionInterest("accepted", "blocked", "sender")).toBe(true);
    expect(canTransitionInterest("accepted", "blocked", "recipient")).toBe(true);
    expect(canTransitionInterest("accepted", "declined", "sender")).toBe(false);
    expect(canTransitionInterest("accepted", "withdrawn", "sender")).toBe(false);
  });

  it("blocks every transition out of blocked", () => {
    expect(canTransitionInterest("blocked", "pending", "sender")).toBe(false);
    expect(canTransitionInterest("blocked", "accepted", "recipient")).toBe(false);
  });

  it("exposes the full edge set in INTEREST_TRANSITIONS", () => {
    expect(INTEREST_TRANSITIONS.pending.recipient).toEqual(["accepted", "declined"]);
    expect(INTEREST_TRANSITIONS.accepted.sender).toEqual(["blocked"]);
    expect(INTEREST_TRANSITIONS.blocked.sender).toBeUndefined();
    expect(INTEREST_TRANSITIONS.blocked.recipient).toBeUndefined();
  });
});

describe("rankInterest", () => {
  it("prefers accepted, then actionable pending, then pending, then terminal, then blocked", () => {
    expect(rankInterest("accepted", false)).toBe(0);
    expect(rankInterest("pending", true)).toBe(1);
    expect(rankInterest("pending", false)).toBe(2);
    expect(rankInterest("declined", false)).toBe(3);
    expect(rankInterest("withdrawn", false)).toBe(3);
    expect(rankInterest("expired", false)).toBe(3);
    expect(rankInterest("blocked", false)).toBe(-1);
  });

  it("places blocked below every other status", () => {
    expect(rankInterest("blocked", true)).toBeLessThan(rankInterest("pending", false));
  });
});
