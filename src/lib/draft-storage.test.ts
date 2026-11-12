import { describe, expect, it } from "vitest";

import {
  APPLY_DRAFT_KEY,
  MEMBER_DRAFT_KEYS,
  ONBOARDING_DRAFT_KEY,
  clearMemberDrafts,
  hasMemberDrafts,
} from "./draft-storage";

const store = new Map<string, string>();
const stub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
Object.assign(globalThis, { localStorage: stub });

describe("draft-storage", () => {
  it("defines both draft keys and the shared key list", () => {
    expect(APPLY_DRAFT_KEY).toBe("merit-circle-apply-draft");
    expect(ONBOARDING_DRAFT_KEY).toBe("alumni_onboarding_draft_v2");
    expect(MEMBER_DRAFT_KEYS).toEqual([APPLY_DRAFT_KEY, ONBOARDING_DRAFT_KEY]);
  });

  it("hasMemberDrafts reports false when empty and true after a write", () => {
    store.clear();
    expect(hasMemberDrafts()).toBe(false);
    stub.setItem(APPLY_DRAFT_KEY, "{}");
    expect(hasMemberDrafts()).toBe(true);
    stub.setItem(ONBOARDING_DRAFT_KEY, "{}");
    expect(hasMemberDrafts()).toBe(true);
  });

  it("clearMemberDrafts removes both keys", () => {
    stub.setItem(APPLY_DRAFT_KEY, "{}");
    stub.setItem(ONBOARDING_DRAFT_KEY, "{}");
    clearMemberDrafts();
    expect(hasMemberDrafts()).toBe(false);
    expect(stub.getItem(APPLY_DRAFT_KEY)).toBeNull();
    expect(stub.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
  });

  it("clearMemberDrafts is a no-op (not a throw) on a clean store", () => {
    store.clear();
    expect(() => clearMemberDrafts()).not.toThrow();
  });
});
