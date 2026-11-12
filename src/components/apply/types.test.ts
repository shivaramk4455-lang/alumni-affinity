import { describe, expect, it } from "vitest";

import { loadApplyDraft, emptyApplyDraft } from "@/components/apply/types";
import { APPLY_DRAFT_KEY } from "@/lib/draft-storage";

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

describe("loadApplyDraft", () => {
  it("returns the empty draft when storage is empty", () => {
    store.clear();
    expect(loadApplyDraft()).toEqual(emptyApplyDraft);
  });

  it("falls back to the empty draft on malformed JSON", () => {
    store.clear();
    stub.setItem(APPLY_DRAFT_KEY, "not-json{{{");
    expect(loadApplyDraft()).toEqual(emptyApplyDraft);
  });

  it("merges a partial stored draft over the empty defaults", () => {
    store.clear();
    stub.setItem(APPLY_DRAFT_KEY, JSON.stringify({ name: "Asha", city: "Pune" }));
    const draft = loadApplyDraft();
    expect(draft.name).toBe("Asha");
    expect(draft.city).toBe("Pune");
    expect(draft.country).toBe("India"); // default preserved
    expect(draft.ghost).toBe(true);
  });

  it("prefill mapping: dob is preserved verbatim for the onboarding seed", () => {
    store.clear();
    stub.setItem(APPLY_DRAFT_KEY, JSON.stringify({ dob: "1998-05-15" }));
    expect(loadApplyDraft().dob).toBe("1998-05-15");
  });
});
