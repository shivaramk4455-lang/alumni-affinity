# Universal State Machine Discovery — The Merit Circle

**Scope:** Full codebase discovery across frontend (TanStack Start / React 19 / Vite / Tailwind v4), backend
(Supabase Postgres + Row Level Security + Deno Edge Functions), and infrastructure (pg_cron, Resend, Twilio,
Razorpay, WebRTC/STUN+TURN).

**Method:** `DISCOVER → UNDERSTAND → MODEL → DECIDE → TEST → IMPLEMENT → VERIFY → DOCUMENT`. No blind refactor.
Every abstraction below solves a demonstrated problem. Existing public interfaces, database contracts, and API
compatibility are preserved.

---

## 1. System Map (Discovered Stack)

| Layer | Technology | Entry | State Owner |
|---|---|---|---|
| Browser app | TanStack Start (SSR) + React 19 + TanStack Router + TanStack React Query 5 | `src/routes/__root.tsx`, `src/router.tsx`, `src/start.ts`, `src/server.ts` | React Query cache + component `useState` |
| Auth | Supabase Auth (JWT, `onAuthStateChange`) | `src/hooks/use-auth.ts`, `src/routes/_authenticated/route.tsx` | `useAuth()` → `{user, loading}` |
| Own profile | `public.my_profile` security-definer view | `src/hooks/use-my-profile.ts` | `MY_PROFILE_KEY = ["my-profile"]` |
| DB enforcement | Postgres RLS + `private.*` SECURITY DEFINER helpers + triggers | `supabase/migrations/*` (79 files) | Database |
| Edge functions | Deno: `admin-review`, `delete-account`, `razorpay-checkout`, `razorpay-webhook`, `razorpay-cancel`, `notify-dispatch`, `weekly-digest`, `turn-credentials`, `health` | `supabase/functions/*/index.ts` | Function + DB row |
| Realtime / calls | Supabase Realtime (`postgres_changes`) + WebRTC P2P | `src/hooks/use-call.ts`, `src/lib/rtc-peer.ts` | `useCall()` |
| Messaging | `get_or_create_conversation()` RPC + realtime `messages` | `src/hooks/use-conversation.ts` | `useConversation()` |
| Drafts | `localStorage` (apply + onboarding) | `src/lib/draft-storage.ts` | `loadApplyDraft()`, onboarding effect |
| Tests | Vitest 5, `src/**/*.test.ts`, migration-contract tests | `vitest.config.ts` | — |
| Build | Vite 8 (`npm run build` = `vite build`) | Flat SSR via Nitro | — |

**Global UI invariants already in place (do not regress):**

* Every read lists columns explicitly (`src/lib/profile-columns.ts`). Selecting a revoked column errors instead
  of leaking.
* Mutations surface `isPending` / `busy` / `sending` to disable the triggering control.
* Skeletons preserve layout shape while `isLoading`; errors are distinct from empty states.
* `sentry`-style error capture lives in `src/lib/error-capture.ts` (`AsyncLocalStorage`-aware SSR correlation).

---

## 2. Prioritized Findings

| Priority | Meaning |
|---|---|
| **P0** | Critical correctness / security / data-integrity failure |
| **P1** | Major UX failure, race condition, inconsistent transition |
| **P2** | Duplication, fragmentation, maintainability friction |
| **P3** | Discoverability / documentation / lower-impact polish |

---

## 3. State Machine Catalog

### SM-01 — Authentication & Session (P0)

**Files:** `src/hooks/use-auth.ts`, `src/routes/_authenticated/route.tsx`, `src/routes/auth.tsx`,
`src/components/site-chrome.tsx` (`SiteHeader`, `NotificationBell`, `IncomingCallBanner`, `UserNavMenu`),
`src/lib/demo-access.functions.ts` (server function), `src/integrations/supabase/client.ts`

**Observed (current) states:**

```
initializing ──getSession()──▶  has-user
initializing ──onAuthStateChange──▶ signed-out / has-user
has-user ──SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED──▶ has-user (+ record_member_activity + invalidate MY_PROFILE_KEY)
has-user ──SIGNED_OUT──▶ signed-out (+ queryClient.clear() + clearMemberDrafts())
```

* Dual source of truth: `useAuth().loading` boolean + `useAuth().user` + `_authenticated/route.tsx` `beforeLoad`
  redirect + `supabase.auth.getSession()` inside `useMyProfile()`, `useConversation()`, `useCall()`, and every
  `supabase.auth.getUser()` call site (~40 call sites, `grep supabase.auth.getUser`).
* `getSession()` is called inside query functions (`useMyProfile`, `useMySubscription`,
  `useNotificationPreferences`, `useDismissedIds`, `useMyPhotoRequest`, …) — stale-session read vs.
  `getUser()`-verified read can disagree across a token refresh.
* `useAuth` session-fallback `getSession()` races the `onAuthStateChange` listener (mitigated by `cancelled`
  flag — correct).
* Demo-mode bypass in `_authenticated/route.tsx`: `startDemoSession()` mints a session only when
  `VITE_ENABLE_DEMO_MODE=true` **and** server `ENABLE_DEMO_MODE=true` **and** not production project
  (`demo-access.functions.ts` triple-guard). Verified: production project id is hard-blocked.

**Invalid / impossible states:**

* `user != null && loading === true` (brief flash after `setUser` before `setLoading(false)` — mitigated by
  synchronous `setLoading(false)` in same tick).
* `user != null && MY_PROFILE_KEY === null` (profile query returns `null` when `getSession()` races
  `SIGNED_OUT` — the queryFn checks `getSession()` afresh).
* In `_authenticated/route.tsx`: `beforeLoad` calls `getSession()` then `getUser()` then demo-mode then redirect —
  three sequential reads, each can fail independently.

**Race risks:**

* Two tabs: `SIGNED_OUT` in tab A clears cache in tab A only; tab B keeps revealed contacts in memory until its
  own auth event fires.
* `record_member_activity` fires on `SIGNED_IN` **and** `TOKEN_REFRESHED` **and** `USER_UPDATED` **and** initial
  `getSession()` — duplicate pings on refresh (harmless, logged once).

**Recommendation (P0 → P1):**

* Keep `useAuth()` as the single session owner. Replace per-hook `supabase.auth.getUser()` calls with
  `useAuth().user` (already available in site chrome) or a shared `requireUser()` helper that throws
  `Error("session unavailable")` uniformly. Do **not** change Supabase Auth itself.
* `useMyProfile()` should use `useAuth().user` as `enabled` gate instead of its own `getSession()` probe;
  keep the `getSession()` inside the queryFn only as a server-side re-check, not as the primary gate.

**Testing:** Sign-out clears `queryClient.clear()` + drafts (covered by code read). Add a Vitest case for
`onAuthStateChange → SIGNED_OUT → clearMemberDrafts called` if/when a jsdom harness is added. No test currently
covers `use-auth`.

---

### SM-02 — Verification & Desk Review (P0)

**DB states** (`profiles.verification_status`): `unverified`, `pending_review`, `verified`, `needs_resubmission`,
`rejected` — enforced by `guard_verified_columns` trigger + `_authenticated/admin.tsx` `beforeLoad` +
`admin-review` edge function (`supabase/functions/admin-review/index.ts`).

**Client decoding** (`src/lib/profile-options.ts`):

* `VERIFICATION_LABELS` + `verificationLabel(status)` — single mapping, unknown → `UNKNOWN_VERIFICATION`.
* `canSubmitForReview(status)` returns `unverified | needs_resubmission | rejected`.

**UI copies of the same machine (fragmentation, P1):**

* `verification.tsx` `submitForReview()` re-checks `pending_review` then `canSubmitForReview` then mutates
  `{ verification_status: "pending_review" }`.
* `dashboard.tsx` computes `stepsDone` arithmetically from `verification_status`
  (`pending_review`/`verified` each +1) and a second prose block for `Institution` uses
  `alumni_email_verified || verified`.
* `members.tsx` gates directory on `verification_status === "verified"` with a copilot escape hatch
  (`isCopilot && feed === "all"`).
* `members.$id.tsx` gates `Express interest` on `verification_status === "verified"` **and** `!interest.data`.
* `site-chrome.tsx` `UserNavMenu` shows `Identity verified` iff `verified`.

**Invalid states:**

* `alumni_email_verified === true && verification_status !== "verified"` (possible: admin sets
  `alumni_email_verified: decision === "verified"` — so it tracks, but dashboard treats either as "done").
* `verification_doc_path !== null && verification_status === "unverified"` (uploaded but never submitted —
  `submitForReview` checks `!emailOk && !doc_path` → blocks, correct).
* Client sends `verification_status: "pending_review"` directly via `save.mutate` (`verification.tsx:179`) —
  **the DB guard must reject if not in `canSubmitForReview` set**. Verified in `guard_verified_columns`
  (migration `20260926000000`). Client-side guard is duplicated, not authoritative.

**Decision:** Keep DB as authority. Collapse the three dashboard `verification_status` checks into a single
`verificationPhase(status)` selector returning `"not_started" | "in_review" | "verified" | "needs_work"` so
`stepsDone`, `Next step`, and `Status` in `dashboard.tsx` cannot diverge. This is a pure refactor, no behavior
change.

**Testing:** Existing `profile-completeness` weighted scoring is tested; verification labels are not. Add a
unit test for `verificationLabel` unknown-status fallback and `canSubmitForReview`.

---

### SM-03 — Onboarding (P1)

**Files:** `src/routes/_authenticated/onboarding.tsx`, `src/components/onboarding/*`,
`src/components/apply/types.ts`, `src/lib/draft-storage.ts`, `src/lib/apply-validation.ts`

**Observed machine (client):**

```
empty ──prefill=1 + APPLY_DRAFT──▶ pre-seeded from apply draft
empty ──me.data exists──▶ seeded from my_profile
any ──localStorage ONBOARDING_DRAFT_KEY──▶ restored (step, f, dob, selectedState, custom*Selected flags)
step 0..3 ──next() zod safeParse──▶ validation errors (per-field, first-error toast) or advance
step 3 ──finish()──▶ supabase update profiles (onboarded:true) + partner_preferences upsert + clearMemberDrafts()
        + invalidate MY_PROFILE_KEY + recordConsent ×2 (fire-and-forget, warns on failure)
```

**Fragmentation:**

* `loaded` ref guards the seed effect (`useEffect` on `[me.data, me.isLoading, prefill]`) — runs **once**.
  If `me.data` changes after load (e.g. invalidation), seed does not re-run (correct — no overwrite).
* `submittedRef` stops the persist effect from re-writing after `finish()` succeeds. Without it the draft
  would resurrect after navigation.
* `me.data?.onboarded` is consulted in three places: persist gate, seed gate, post-save consent branch.
  All three read the **same** `MY_PROFILE_KEY` snapshot — consistent.
* Retry-without-community-columns fallback in `finish()` (catches `error.message.includes("column")`, strips
  `religion/caste/gotra/...`, retries) — a schema-drift safety net, not a state machine.

**Invalid:**

* `step === 0 && dob === ""` → zod `birth_year` fails (correct, but `dob` is separate state from `f.birth_year`;
  two sources for one fact).
* Draft JSON parse failure → `catch { /* ignore invalid draft */ }` → silent reset to `emptyForm`. Acceptable
  (shared-device no-throw), but no user signal.

**Race:** `handleDirectSignup` in `apply.tsx` and `submit()` in `auth.tsx` both write `APPLY_DRAFT_KEY`;
`onboarding.tsx` reads it once on `prefill=1`. A second tab editing `/apply` mid-onboarding overwrites the
draft the first tab seeded from — harmless (seed is one-shot).

**Recommendation (P1):** Keep the one-shot seed. Unify `dob` (string) and `f.birth_year` (string) into a single
derived value: `birth_year = dob ? dob.split("-")[0] : f.birth_year`. Removes the split-brain where the two
can disagree.

**Testing:** `apply-validation` + `dob-picker` have tests; onboarding seed/persist has none. Add a test for
`loadApplyDraft` malformed-JSON fallback and prefill field mapping (`name → full_name`, `gradYear → grad_year`,
etc.).

---

### SM-04 — Apply Draft (P1)

**Files:** `src/routes/apply.tsx`, `src/components/apply/*`, `src/lib/apply-validation.ts`, `src/lib/draft-storage.ts`

**Observed:**

```
step 0..4 (APPLY_STEPS) ──validate(form)──▶ errors map or advance
step 4 ──submit──▶ completed=true ──handleDirectSignup──▶ data.session ? /onboarding?prefill=1 : accountCreated=true
                                                     else handleGoogleSignup (OAuth redirect)
busy: boolean gates inputs during signUp (setBusy(true) → setBusy(false) in both branches)
```

**Fragmentation / duplication:**

* `busy` is a separate boolean from `completed` + `accountCreated` + `authError` + `errors`. Four booleans
  encode one funnel. The transition `completed → accountCreated` is only reachable after `handleDirectSignup`
  resolves without a `session` — a second implicit state.
* `handleChange` maintains a **manual error-key remap** (`copilotEmail → copilot-email`, `city → custom-city`,
  …) — a second, hand-rolled error-throttle beside `validateApplyStep`.

**Invalid:** `completed === true && accountCreated === true && data.session` (accountCreated is set only in the
`!data.session` branch — cannot co-occur). `busy === true && completed === false` (Google OAuth: `busy` stays
true across the redirect — the page navigates away, so harmless).

**Recommendation (P2):** Introduce a tiny discriminated union for the funnel phase instead of three booleans:

```ts
type ApplyPhase =
  | { step: number }
  | { step: "awaiting-password" }
  | { step: "check-email" };
```

Keep `busy` as the in-flight flag. This eliminates the `completed && accountCreated` co-occurrence by
construction and makes the OAuth redirect an explicit terminal arm.

**Testing:** `apply-validation.test.ts` already covers per-step rules. Add a test for the error-key remap
table (it is the only place `copilot-email` vs `copilotEmail` is translated).

---

### SM-05 — Auth Page (P1)

**Files:** `src/routes/auth.tsx`

**Observed sub-states (all `useState` booleans):**

* `mode: "signin" | "signup" | "reset"` — tab state.
* `recovery: boolean` — Supabase `PASSWORD_RECOVERY` event or `hash.includes("type=recovery")`.
* `sent`, `resetSent` — post-submit banners.
* `busy`, `showPassword`, `adultAttested`, `termsAccepted`, `attestError`, `termsError`, `fieldErrors`,
  `serverError`.

**Invalid / blocked transitions:**

* `user != null && recovery === true` → redirect effect returns early (correct — prevents the
  "recovery session immediately redirects to dashboard" bug documented in the comment).
* `mode === "signup" && (!adultAttested || !termsAccepted)` → submit blocked (correct). Google OAuth path
  repeats the same checks (`google()`).
* `recovery` set from `window.location.hash` **and** `onAuthStateChange` — both fire; idempotent.

**Fragmentation:** `busy` is shared across three async actions (`submitNewPassword`, `submit` signin/signup,
`resendConfirmation`). A `busy` from password-reset blocks the sign-in form's submit (same flag, same
component — acceptable, but it means the sign-in button shows "Please wait…" during a background resend).

**Recommendation (P2):** Split into `busyAction: "signin" | "signup" | "reset" | "resend" | null` and derive
`busy = busyAction !== null` per-button. The recovery-mode form already has its own `busy` read. Pure UI
state, no behavior change for the happy path.

**Testing:** `parseRedirect` (unchanged here) is not exported/tested. Export + unit-test the open-redirect
guard — it is security-sensitive.

---

### SM-06 — Member Directory / Search (P0)

**Files:** `src/routes/_authenticated/members.tsx` (1463 lines)

**Observed query-enablement machine (the load-bearing state machine of the whole app):**

```ts
enabled =
  !onProfilePage                                          // route child mounted
  && !!me.data                                             // profile loaded
  && (me.data.verification_status === "verified"
      || (isCopilot && feed === "all"))                   // copilot escape hatch
  && blocked.isSuccess                                     // reports loaded
  && (feed !== "viewed_you" || canUseVisitorFeed)         // privacy opt-in
```

**Filter state — 17 independent `useState` strings/booleans:**

`q, inst, reloc, gender, ageBand, diet, maritalStatus, residency, tongue, religion, rashi, manglik,
minHeight, city, profession, withPhoto, feed, sort, page, showMoreFilters`

* `isFiltered` is recomputed with a long `Boolean(...)` chain (duplicating `activeFilters` memo).
* `activeFilters` memo rebuilds chip objects with closures capturing `resetPage` — recreated on every
  filter change (correct, but the chip list and the gate can diverge if a filter is added to one and not the
  other).
* `page` is reset by `resetPage()` in **every** `onChange` handler (17 call sites). A filter added without
  calling `resetPage()` silently keeps the old page → empty page 2 of a 0-result filter.
* `buildMembersQueryKey(page)` is `useCallback`-memoized with 22 dependencies — a missing dep means a stale
  query key (React Query would serve the wrong cache entry).
* Prefetch effect for page `n+1` depends on 18 deps including `buildMembersQueryKey` itself (stable via
  `useCallback`).

**Two query paths (P1):**

* `runMemberDirectoryQuery` — RPC `discover_members` (server-side filters, counts, alignment signals).
* `runCopilotDirectoryQuery` — direct PostgREST `profiles` select (client-side `.eq` chains).
* Selection: `isCopilot && me.data?.verification_status !== "verified" ? copilot : member`.
* Both build the same `RunMemberDirectoryQueryParams` — good, single param shape.

**Invalid states:**

* `feed === "viewed_you" && !canUseVisitorFeed` → query disabled (correct) but the `<select>` still offers
  the option (disabled attribute added per-option — correct).
* `onProfilePage === true && results.enabled` → `enabled` false; the `Outlet` renders the child. Checked
  **after** all hooks (correct hook order).
* `blocked.isSuccess === false` while a query is in flight → results skeleton, not empty (correct — never
  flashes "no members").

**Decision:** Extract the 17 filter fields + `resetPage` + `isFiltered` + `activeFilters` into a
`useDirectoryFilters` hook so the filter state, the query key, and the prefetch effect share one owner.
The hook returns a single `filters` object spread into `RunMemberDirectoryQueryParams`, eliminating the
22-dep `useCallback` in favor of a stable `JSON.stringify(filters)` key. Low risk: behavior-preserving.

**Testing:** No tests for `members.tsx` (1463 lines) — the highest-risk untested file. Add unit tests for
the extracted `useDirectoryFilters` (page reset on any filter change; `isFiltered` correctness).

---

### SM-07 — Profile Detail / Interest / Photo Access (P0)

**Files:** `src/routes/_authenticated/members.$id.tsx` (1051 lines),
`src/lib/photo-requests.ts`, `src/lib/dismissals.ts`, `src/components/profile/candidate-action-panels.tsx`

**Observed interest-resolution machine (client):**

```ts
interest query: rows = select(...).or(senderA→B, B→A).limit(2)
rank(status, iAmRecipient): blocked=-1, accepted=0, pending&&recipient=1, pending=2, else=3
→ rows.sort(rank)[0] ?? null
```

* Handles the **mutual-send race** (`A→B` + `B→A` coexist because the unique index is direction-ordered).
  The rank prefers `accepted` over `pending`, so an accepted row is never hidden behind a pending one. Correct.
* Rendering sends/handles per derived `interest.data.status`.

**Observed photo-visibility machine:**

```ts
canSeePhoto = visibility === "all_members" || (accepted && visibility !== "hidden")
photoRequestable = !isSelf && !!photo_path && !canSeePhoto && visibility === "accepted_only"
```

* `hidden` is never requestable (correct — strongest setting).
* `photo-requests.ts` state: `pending | accepted | declined | revoked` (DB type); the mutations only ever
  write `pending` on insert and `accepted | declined` on decide. `revoked` is never written by the client —
  only (presumably) by a DB action. The UI handles `pending` / `declined` / fallback (requestable).
* After `useDecidePhotoRequest` success, invalidates `["photo"]`, `["gallery"]`, `["member"]` — but the
  **requester's** `useMyPhotoRequest` query invalidates `["photo-request"]` only. A requester with the
  profile open must `refetch` manually (retry button exists on `MemberPhoto` — correct).

**Report / dismiss / block tri-state (P1):**

| Action | Table | Notification | Terminal? |
|---|---|---|---|
| Dismiss ("Not for me") | `profile_dismissals` | None (one-way, reversible in Settings) | No |
| Report | `reports` | Desk alert | Hides profile from search |
| Block (via `connections.tsx` accept-tab) | `interests.status = "blocked"` | — | Yes, ends introduction |

* Dismiss and Report both hide from search but through different tables — the query merges
  `[...blocked, ...dismissed]` into `hidden` (members.tsx:496). Reading **both** tables on every directory
  load (bounded at 200 / 500 rows).
* `useDismissProfile` swallows `23505` (already dismissed = success). Correct.

**Decision:** Keep the tri-state; it is product-intentional and well-commented. Document the inclusion (already
extensively commented). No code change proposed.

**Testing:** No tests for the rank function. Extract `rankInterest` as a pure function and unit-test all six
(status × recipient) combinations.

---

### SM-08 — Introductions (P0)

**Files:** `src/routes/_authenticated/connections.tsx`, DB `interests.status`:
`pending | accepted | declined | withdrawn | expired | blocked`

**Observed client partition (three overlapping sets):**

```ts
received = all.filter(r => r.recipient_id === myId && r.status === "pending")
sent     = all.filter(s => s.sender_id === myId && s.status !== "accepted" && s.status !== "blocked")
mutual   = all.filter(s => s.status === "accepted" && (sender || recipient))
declined = all.filter(s => (declined|withdrawn|expired) && (sender || recipient))
```

* `sent` includes `declined | withdrawn | expired` rows **and** `declined` shows them again in the Declined
  tab — the same row appears in two tabs. The radio in `sent` renders a "Send again" button that does
  `update { status: "pending" }` (re-open), while the Declined tab renders explanatory copy. Having both is
  intentional (send again from Sent, history from Declined) but an agent reading the code will not know.
* `mutualPendingByPair` map marks both directions of a mutual send (client-side `O(n²)` find per pending row).
* **Every mutation writes the status string directly** (`act.mutate({ status: "accepted" })`) and relies on
  `enforce_interest_transition` DB trigger to reject illegal moves. The trigger is authoritative.
  **Client-side transition table is missing** — e.g., the UI still renders "Send again" for `declined` rows
  in `sent`, and the recipient-accept path is one click (`mutate({status:"accepted"})`) with no
  client-side check that `I am the recipient`. The DB trigger enforces it, but a 403-style toast says
  "Could not update. Please try again." (not "Only the recipient can accept").

**Invalid states reaching the UI:**

* `sent` shows rows the sender cannot act on (`accepted` excluded, but `blocked` excluded too, correct).
* `declined` tab includes **expired** rows — "Send again" is not offered there, but those rows also appear
  in `sent` with a "Send again" button. Expiry re-open semantics are covered by the `pending` write path.

**Race / side effects on accept:**

* `onSuccess` invalidates `["interests"]`, `["contact"]`, `["revealed-contacts"]` — but **not**
  `["messages"]` / `["conversation"]` / `["call-history"]`, which only become meaningful after acceptance.
  A member who accepts and immediately clicks "Message" mounts `useConversation` fresh, so the cache miss
  refetches — but if messages were previously fetched (e.g. in another tab), a stale `!interest` row could
  render "Direct messaging locked" briefly. Low risk, noted for completeness.

**Decision (P1):** Introduce a client-side transition table exported from `src/lib/interest-transitions.ts`:

```ts
export const INTEREST_TRANSITIONS: Record<Status, Status[]> = {
  pending: ["accepted", "declined", "withdrawn"],   // accepted: recipient only — enforced server-side
  declined: ["pending"], withdrawn: ["pending"], expired: ["pending"],
  accepted: ["blocked"], blocked: [],
};
export const canTransition = (from, to, role) => ...
```

Render action buttons from this table instead of the current ad-hoc `tab === "received" &&` / `tab === "sent"`
conditional blocks. Keeps the DB trigger as the real authority; the table is a **mirror** (like
`subscription-liveness.ts` mirrors `private.live_subscription()`), with a migration-contract test asserting the
DB trigger still lists the same edges.

---

### SM-09 — Co-pilots (P1)

**Files:** `src/routes/_authenticated/copilots.tsx`, `src/routes/_authenticated/copilot-invite.$code.tsx`

**DB states** (`copilots.status`): `invited → active | revoked` (+ `copilot_user_id` bound on accept via
`accept_copilot_invite(code)` RPC; `guard_copilot_insert_columns` forces `status='invited'`,
`copilot_user_id=NULL` on insert — enforced; migration-contract tested).

**Client machine:**

* **Candidate side**: `mine = links.filter(candidate_id === myId)`; invite form gated by
  `mine.filter(status !== "revoked").length >= 2` → toast (client gate; DB enforces the cap too).
* **Accepted-co-pilot side**: `copilotingFor = links.filter(copilot_user_id === myId && status === "active")`.
  `myRecs` = recommendations where `candidate_id === myId || myCopilotIds.has(copilot_id)`.
* `setStatus` mutation writes arbitrary `status: string` (typed as `string`, not the enum) — passes
  `"revoked"` only from the UI today.
* Invite link is `/copilot-invite/{invite_code}`; `auth.tsx` redirect effect preserves it across sign-in
  (special-cased in the redirect effect). Correct — the most common lost-deep-link bug, already fixed.

**Invalid:**

* `mine` includes `revoked` rows; they render with a "Revoked" badge and no link — correct.
* A candidate who revokes their own co-pilot while that co-pilot has the page open: stale until refetch.
  Acceptable (no realtime here).

**Decision:** Type the `setStatus` mutation as `status: "revoked" | "active"` and disable the action buttons
while `setStatus.isPending` (currently possible to double-click revoke).

---

### SM-10 — Messaging (P1)

**Files:** `src/hooks/use-conversation.ts`, `src/routes/_authenticated/messages.index.tsx`,
`src/routes/_authenticated/messages.$interestId.tsx`

**Observed machine:**

```
useConversation(interestId):
  convo query  → RPC get_or_create_conversation(interestId) → row or id→row fallback
  history query (enabled on conversationId) → 200 newest → reversed
  realtime (INSERT + UPDATE on messages, filter conversation_id) → setQueryData append / read_at merge
  send(body): trim/slice(0,2000) → optimistic temp-${ts} row → insert → replace temp with server row
              → on insert error: remove temp, setSendError
              → on success: notify_counterparty(message_received) — failure logged, never rolls back
  markRead(): update read_at where conversation_id && sender!=me && read_at is null
              — error logged, never surfaced to UI (comment: "counterpart's seen tick simply never appeared")
```

**Invalid states:**

* `sending === true && sendError !== null` — `send()` sets `sending=true; setSendError(null)` atomically;
  on leave `setSending(false)` before returning. Between `setSending(false)` on the error path and the UI
  read, `sendError` shows. Correct.
* Two sends in the same tick: second call sees `sending === true` → returns `false` → `handleSend` restores
  `text` and toasts. Correct, no double-message (unique temp id via `Date.now()` — two sends in the same
  millisecond would collide on temp id; impossible because the second is rejected by `sending`).

**Optimistic-update race:** Realtime echo of *my own* insert arrives via `INSERT` and is merged by id —
the dedup check `old.some(m => m.id === row.id)` prevents a duplicate when the server row replaces the temp
row first. Correct.

**Inbox machine (messages.index.tsx):** Keyed on **accepted interests** (not `conversations`), so threads
nobody has opened still list. Last-message + unread computed in one 300-row query; failures degrade to
"no preview" rather than hiding threads (three separate `try/catch` blocks). Robust.

**Discussion (P1):** `markRead` error is swallowed (logged only). The counterpart's "Seen" tick silently
never appears. Unlike `send`, a failed receipt has **no retry path** and **no toast**. The comment
acknowledges it. This is the correct call for a read receipt (a toast for a failed read-receipt is worse),
but the staleness is unbounded — a member who was offline sees "Sent" forever.

**Decision:** Keep as-is; document as a known at-least-once limitation. Optional future: periodic refetch of
`read_at` (React Query `refetchInterval` scoped to the conversation page).

---

### SM-11 — Calls / WebRTC (P0)

**Files:** `src/hooks/use-call.ts` (403 lines), `src/routes/_authenticated/call.$callId.tsx`,
`src/routes/_authenticated/calls.tsx`, `src/components/site-chrome.tsx` (`IncomingCallBanner`),
`src/lib/rtc-peer.ts`, `src/components/call/pre-call-device-check.tsx`

**DB states** (`calls.status`): `ringing | active | ended` (+ `decline_reason`,
`answered_at`, `ended_at`). `RING_TIMEOUT_MS = 45_000` (caller-side timeout).

**Client machine (`useCall`):**

```
caller arrives  → begin("caller") after precallDone → getUserMedia → createRtcPeer → createOffer → signal("offer")
callee arrives  → waits in preCallDeviceCheck → answer() [update status→active] → begin("callee")
                 → historical + realtime signals fetched; signals before peer → pendingRef queue → flushed in begin()
either          → endCall(reason) [hangup signal → update status→ended → teardownMedia → notify_counterparty if was ringing]
unmount         → teardownMedia (camera stops) — correct backstop
```

**Realtime:** `useEffect([callId, myId, applySignal])` re-subscribes when `myId` changes (profile load) —
re-fetches historical signals on each `myId` transition (could apply the same offer twice; `rtc-peer`
guards: `handleRemoteAnswer` checks `signalingState !== "have-local-offer"`; `handleRemoteOffer` has no
guard but `setRemoteDescription` twice with the same SDP is a no-op in the spec — accepted risk).

**`endedRef` + `begunRef` discipline:** `endCall` guards on `endedRef.current` (hangup vs. realtime UPDATE
race); `begin` guards on `begunRef` and resets it to `false` on `getUserMedia` failure so the user can retry
after granting permissions. Correct.

**Media state machine (4 booleans + 2 refs):**

* `local`, `remote`, `connection: RTCPeerConnectionState`, `mediaError`, `busy`, `isAudioMuted`,
  `isVideoMuted`, refs `localRef/remoteRef/peerRef/begunRef/pendingRef/endedRef`.
* `toggleAudio/Video` mutate `track.enabled` + `replaceTrack` — no renegotiation (glare-free by design).

**`PreCallDeviceCheck` state machine:** `mediaState: loading | ready | error` + `cameraEnabled` +
`micEnabled` + `micVolume`. On proceed, **stops preview tracks** so the call session acquires them cleanly
(correct — double-acquisition is the classic broken-camera bug). `handleStart` is idempotent-safe because
the effect cleanup already stopped tracks.

**Invalid / raced states:**

* `call.status === "ringing" && role === "caller" && !precallDone` → `PreCallDeviceCheck` renders;
  after `precallDone`, `useEffect` calls `begin("caller")`. The same effect re-runs when `begin` changes
  (it is `useCallback([applySignal, signal, teardownMedia])`, all stable) — safe.
* Callee clicks Accept twice: `answer()` guards on `busy`; second click during the update is dropped.
  `busy` is set **before** `begin("callee")` so the ring UI flips to "Connecting…" only after the status
  update succeeds. Correct.
* `IncomingCallBanner` polls `callee_id === me && status === "ringing"` every 5s. Decline writes `ended`
  directly (no `hangup` signal, no `notify_counterparty`) — the caller side learns via `calls` UPDATE
  realtime → `teardownMedia` + invalidate. The callee's `decline()` does not send `call_missed`; the
  **caller**'s `endCall("missed")` (ring timeout) does. A callee-declined call never writes `call_missed`
  to the caller's inbox — is that intended? The UI on the caller shows "Declined" (via `decline_reason`),
  but no `notification` row is written. **Found inconsistency (P1):** timeout path writes `call_missed`,
  explicit-decline path does not. The inbox will show a missed call for one and silence for the other.

**Decision (P1):** Call `notify_counterparty(call_missed)` from the callee-decline path as well — or drop it
from the timeout path for symmetry. Symmetry (both paths notify) is the lesser surprise. One-line RPC,
behind the existing `notify_counterparty` contract.

---

### SM-12 — Photo Gallery (P1)

**Files:** `src/lib/gallery.ts` (684 lines), `src/components/photo-gallery.tsx`

**Observed state:** `photos.length` (0..6 cap enforced client-side **and** DB-side), `active` index,
`confirmId` (two-step delete), `previewOpen`, `busy = OR of 4 mutations' isPending`.

**Fallback architecture (correct):** `profile_photos` table → `profiles.photo_path` sync, with graceful
degradation if the table is missing (`42P01`/`PGRST204`/schema-cache), trigger-issue (`42501`), and
one-primary-violation (`23505` → retry as `is_primary:false`) all handled distinctly. `useGallery` falls
back to `photo_path` if the table query returns zero rows.

**Delete ordering:** Storage object **first**, then row (fixed in the audited revision — the old row-first
ordering left orphan files). Primary-delete promotes the next photo and syncs `profiles.photo_path`.
Correct.

**Sync-propagation latency (P1):** `useUploadGalleryPhoto` invalidates `["gallery"]`, `["my-profile"]`,
`["photo"]`, `["navbar-avatar"]`, `["search-photo"]` — but **`search-photo`** is used by `AvatarPhoto`
with a 4-minute `staleTime`, and `MemberPhoto` with `["photo", path]` keyed on path (a new path is a new
key, so no stale read). Correct; the `["photo"]` invalidation is broad but harmless.

**Compression:** `compressPhotograph` (client-side canvas, 2048px, 88% JPEG) + magic-bytes check
(`assertAllowedFileType`) before upload. The verification-page upload path (`verification.tsx`) reuses
`compressPhotograph` and `assertAllowedFileType` but **not** `assertGalleryFile` (different size/format
rules for credential docs — correct separation).

**Recommendation:** None required. This module is the best-documented state machine in the codebase.

---

### SM-13 — Subscriptions & Razorpay (P0)

**Files:** `src/lib/subscription.ts`, `src/lib/subscription-liveness.ts`, `src/lib/subscription.test.ts`,
`supabase/functions/razorpay-checkout/index.ts`, `supabase/functions/razorpay-webhook/index.ts`,
`supabase/functions/razorpay-cancel/index.ts`, `supabase/migrations/20261008000000_subscriptions.sql` +
`20261106000000_entitlement_live_window.sql` + `20261107000000_production_readiness_hardening_round2.sql`

**DB states:** `created | authenticated | active | pending | halted | cancelled | completed | expired |
superseded | refunded | disputed` (+ `cancel_at_period_end`, `amount_paid_paise`, `period_end`).

**Liveness (3 conditions, mirrored browser↔DB):**

```ts
isLive = (active|authenticated) && (period_end null|future) && (amount_paid_paise !== null)
```

* `pending` = payment failure, never entitles. `created` = abandoned checkout, never entitles.
* `TERMINAL = halted|cancelled|completed|expired|superseded|refunded|disputed`.
* `ENTITLING_EVENTS` includes `payment.captured | payment.failed` (both write entitling statuses).
* Webhook ordering: **claim-first** dedup (`webhook_events.event_id` unique), freshness window (30 days),
  supersede-before-activate, monotonic terminal guard (`TERMINAL.has(existing.status) &&
  ENTITLING_EVENTS.has(event)`), refund/dispute resolution via payment/invoice linkage.

**Browser mirror** (`subscription-liveness.ts`) is explicitly documented as a strict mirror of
`private.live_subscription()` and `private.subscription_is_live()`, with `migration-contract.test.ts`
asserting the SQL still contains `amount_paid_paise IS NOT NULL`. **This is the reference pattern for every
other SM.**

**Checkout state machine (the subtle one):**

```
existing open rows (created|authenticated|active|pending, limit 5):
  active/authenticated        → 409 "already active"
  pending   same plan         → return existing subscription_id (retry the same mandate)
  pending   other plan        → 409 "different tier unresolved"
  created <10s                → 429 throttle
  created <15m same plan      → return existing subscription_id (reuse, no orphan)
then: create Razorpay subscription (provider)
then: claim_checkout_slot()   → advisory lock → verdict
  claimed        → 200
  reuse          → cancel new provider object, return existing id
  already_active / already_pending / other_plan / too_soon → cancel + 409/409/409/429
```

* The in-handler pre-check is an **optimization** (saves a provider call); `claim_checkout_slot` is the
  authoritative atomic decision (documented in the file header). Correct architecture.
* `scriptPromise` in `subscription.ts` is a module-level memoized promise with **rejection reset**
  (`scriptPromise = null` on `script.onerror`) — the classic "memoized rejection is forever" bug is
  already fixed.

**`requests_used` reciprocity:** `record_intro_usage()` scales the allowance 50%–150% by
`reciprocity_multiplier`. The count is **reset only by `invoice.paid`** (webhook sets `requests_used: 0`).
A `payment.captured` does **not** reset it. If Razorpay delivers `payment.captured` without `invoice.paid`
(order is not guaranteed), the member gets the tier but keeps a stale `requests_used`. **Race (P1):**
documented as multi-event (both are processed; `invoice.paid` will arrive for a real subscription, so the
window is transient).

---

### SM-14 — Notification Outbox (P0)

**Files:** `supabase/functions/notify-dispatch/index.ts`, `src/components/site-chrome.tsx`
(`NotificationBell`), `src/routes/_authenticated/notifications.tsx`, `src/lib/safe-link.ts`

**DB states** (`notification_outbox.status`): `queued | sending | sent | failed` (+ `attempts` ≤ 25,
`status_changed_at`).

**Dispatcher machine (claim-first):**

```
cron → sweep stuck `sending >15m` → queued (attempts < 25)
     → park_exhausted_notifications() (attempts ≥ 25 → failed)
     → claim_due_notifications(limit) (FOR UPDATE SKIP LOCKED)
     → per row: render (unknown template → park directly, no retry)
              → send via Resend/Twilio   → finish_notification(ok)
```

* Providers have a 10s deadline; a provider throw fails one row, not the batch.
* Unknown-template rows are parked **immediately** (permanent error ≠ transient).
* `notificationDestination(link)` whitelists 5 routes; anything else → `/dashboard`. Open-redirect-safe.

**Inbox (in-app) machine:** `unread = !read_at`. `NotificationBell` (10-row preview) and the inbox page
(50 rows) use **different query keys** (`["notifications","preview"]` vs `["notifications","inbox"]`) —
the comment documents why (different projections/page sizes). Mark-read on open + on unmount (the unmount
effect flushes whatever was unread when the page was opened — a subtle UX: a member who opens the inbox
marks everything read even if they didn't read it).

**Dual-channel risk (P1):** Every interest transition writes **both** an in-app `notifications` row
(server trigger) **and** an outbox row (email/SMS/WhatsApp). If the dispatcher is down, the member gets
the in-app item but not the email — the two channels are not transactional. At-least-once on the outbox
side (stuck-row resend can duplicate one email in the worst crash window).

---

### SM-15 — Consent Ledger (P0 — legal)

**Files:** `src/lib/consent.ts`, `src/components/settings/consent-ledger-section.tsx`,
`src/routes/_authenticated/onboarding.tsx`, `src/routes/_authenticated/verification.tsx`,
`src/routes/_authenticated/settings.tsx`, `supabase/migrations/20261004000000_dpdp_governance.sql`

**Machine:** `consent_events` is append-only (no member UPDATE/DELETE). `record_consent()` RPC is the single
write path and stamps `POLICY_VERSION = "2026-09"` **server-side** (the client arg is audit-only).
`recordConsent()` is fire-and-forget by design — a failure logs + returns `{ok:false}` but never blocks
the member's action. **Every call site checks `ok` and either toasts an error or throws** — except the
onboarding path, which warns (`toast.error("Profile was saved, but we could not record your consent
receipt…")`).

**Ledger is keyed read-only** (`useConsentLog`, newest 25). The delete-account flow snapshots purposes
**before** the profile cascade so the receipt has an audit trail (documented in `delete-account`).

**Decision:** Correct as-is. The one asymmetry — `recordConsent` requires the member's auth context but the
DPDP question is "can we prove they agreed?" — is covered: the receipt is written regardless of the write
path's success, and a failed write is visible in logs + the UI warning.

---

### SM-16 — Settings: Visibility, Sabbatical, Account (P1)

**Files:** `src/routes/_authenticated/settings.tsx` (887 lines)

**Sub-machines sharing one `dirty` flag:**

* `is_visible` (ghost mode): `save.mutate({is_visible})` on toggle — immediate, no Save button.
* `photo_visibility` / `created_by` / horoscope selects: immediate on change.
* `contact_phone` / `linkedin_url` / `paused_until` / `paused_reason` / partner preferences: **local state
  until explicit Save**, guarded by `useBlocker` (confirm dialog) + `enableBeforeUnload`.
* `show_profile_views`, activity tracking, notification channels: immediate.
* `savePause`: writes `paused_until` + `recordConsent("sabbatical_visibility", granted=until!==null)`.
* `signOut`: `queryClient.cancelQueries(); queryClient.clear(); supabase.auth.signOut()` then navigate.
* `AccountDangerZone`: withdraw (`is_visible=false`, reversible) vs. delete (typed confirmation →
  `delete-account` edge function → storage purge → profile delete → auth delete → `deletion_receipts`).

**Invalid state:** `dirty` compares local phone/linkedin against `p?.contact_phone` — if `p` is `undefined`
(profile loading), `dirty` is temporarily true (a spurious blocker prompt on first paint). In practice the
form mounts after `me.data` resolves, so unreachable.

**`useBlocker`** fires `window.confirm` synchronously — a UX wart (blocking dialog, no styling), but
functional and tested-adjacent. Replacing it with a custom dialog is a design change; left as-is.

---

### SM-17 — Search & Filter State (already covered as SM-06)

### SM-18 — Display / Alarm State (P2)

* `IncomingCallBanner`: `isRinging` → plays a looping ringtone (Web Audio, 2.8s interval) + title flash
  (1.2s toggle) until the call goes answered/ended; cleanup restores `document.title`. Two timers, one
  effect, correctly cleaned up.
* `notificationDestination` whitelist (above).
* `demo-access.functions.ts`: triple-gate (env + not-prod + not-production-project) before minting a
  guest session.

---

## 4. Cross-Cutting Patterns (Already Correct — Do Not Regress)

| Pattern | Where | Why it exists |
|---|---|---|
| Strict mirror module + migration-contract test | `subscription-liveness.ts` + `migration-contract.test.ts` | Browser view must never disagree with DB enforcement |
| Claim-first idempotency | `webhook_events`, `claim_checkout_slot`, `claim_due_notifications` | Concurrent deliveries serialize; retry is safe |
| Explicit column projections | `profile-columns.ts` | Revoked columns error instead of leaking |
| Column-scoped INSERT grants | Migrations `20260928000000+` | `GRANT INSERT` covers every column; per-column grants close it |
| Distinguish "error" from "empty" in UI | Every list page (`isError` → alert + retry, never "No items") | A failed read is not an empty state |
| `key` discipline for React Query | `["notifications","preview"]` vs `["notifications","inbox"]` | Different projections must not share a cache key |
| Fire-and-forget with failure signal | `recordConsent → {ok}`, `notify_counterparty` log-only | The action must not fail on the side-channel, but the failure is visible |
| Two-step confirm for destructive actions | connections, gallery, admin, account | Irreversible = second explicit click |
| `beforeLoad` guards (defense in depth) | `_authenticated/route.tsx`, `admin.tsx` | Redirect before render; RPCs remain authoritative |

---

## 5. Architectural Recommendations (Prioritized)

### P0

1. **Verification phase selector** (`src/lib/profile-options.ts`): add
   `verificationPhase(status): "not_started" | "in_review" | "verified" | "needs_work"` and replace the
   four ad-hoc `verification_status` comparisons in `dashboard.tsx` (stepsDone, Next step ×3, Status rows).
   Behavior-preserving; removes the only place three components compute "where am I in verification?"
   differently.
2. **Single session owner**: replace bare `supabase.auth.getUser()` calls (~40 sites) with
   `useAuth().user` or a `requireUser()` helper that throws `Error("session unavailable")`. `useMyProfile`
   should gate on `useAuth().user`, not its own `getSession()`. No Auth-architecture change.

### P1

3. **Interest transition table** (`src/lib/interest-transitions.ts`): export the legal transition edges
   (mirror of `enforce_interest_transition`), render action buttons from it, and lock it with a
   migration-contract test. Keeps the DB trigger as authority while making the client state machine
   discoverable for agents.
4. **Directory filter hook** (`useDirectoryFilters`): own the 17 filter fields, `resetPage`, `isFiltered`,
   `activeFilters`, the query key, and the prefetch effect. Eliminates the 22-dep `useCallback` and the
   "added a filter but forgot `resetPage()`" hazard.
5. **Callee-decline `call_missed` parity**: emit `notify_counterparty(call_missed)` on explicit callee
   decline, matching the ring-timeout path. One RPC, one direction.
6. **Onboarding DOB unification**: derive `birth_year` from the single `dob` string.
7. **Test coverage gaps**: `rankInterest` (SM-07), `loadApplyDraft` fallback (SM-03), error-key remap
   (SM-04), `parseRedirect` (SM-05), notification-destination whitelist (SM-14). All are pure functions;
   trivially unit-testable.

### P2

8. **Apply funnel phase union** (SM-04) and **`busyAction` split** (SM-05): replace multi-boolean funnels
   with a discriminated phase.
9. **`setStatus` enum** (SM-09): `status: "revoked" | "active"` + `isPending` disable.
10. **Co-pilot `myRecs` memoization**: recomputed per render from three query results; fine at this scale,
    but extracting the filter into a selector documents the dual identity (candidate + co-pilot).

### P3

11. Document the dual-`sent`/`declined`-tab overlap (SM-08) inline — it is intentional, but the next reader
    needs to know why one row renders in two tabs.
12. `markRead` staleness (SM-10): bounded periodic refetch on the conversation page, or accept the
    at-least-once limitation explicitly.

---

## 6. Governance (Apply to Every Future Feature)

1. **Name the sm before implementing.** Write the states, events, and legal transitions in the PR
   description.
2. **Assign one owner** per machine (component, hook, RPC, or edge function). Bar a second writer unless
   the second writer is a test mirror.
3. **Mirror + contract test.** If the DB enforces it, the browser mirror lives in its own module
   (see `subscription-liveness.ts`) with a `migration-contract.test.ts` assertion.
4. **Two variables that look like one state are a bug.** `dob` vs `birth_year`, `completed` vs
   `accountCreated` — unify.
5. **Missing rest is not missing.** Every READ has three UI arms: loading (skeleton), error (alert + retry),
   empty (empty state). No silent fallback.
6. **Mutations announce their in-flight state** on the triggering control only (already the convention —
   extend it to `copilots.tsx` setStatus).
7. **Terminal states are terminal.** `subscribed`/`blocked`/`ended` rows are never resurrected client-side;
   a new transition requires a DB migration + a transition-table update.
8. **Cleanup is non-negotiable.** `useEffect` returning a teardown is required for every realtime channel,
   media stream, and timer (`useCall`, `PreCallDeviceCheck`, `IncomingCallBanner` all do this).

---

## 7. Appendix — Files Read for This Analysis

All under `C:\Users\ramie\Downloads\alumni-affinity-main\alumni-affinity-main\`:

* `AGENTS.md`, `README.md`, `package.json`, `src/router.tsx`, `src/routes/__root.tsx`,
  `src/routes/_authenticated/route.tsx`, `src/hooks/use-auth.ts`, `src/hooks/use-my-profile.ts`,
  `src/hooks/use-debounced-value.ts`, `src/hooks/use-call.ts`, `src/hooks/use-conversation.ts`,
  `src/lib/rtc-peer.ts`, `src/lib/consent.ts`, `src/lib/subscription.ts`, `src/lib/subscription-liveness.ts`,
  `src/lib/subscription.test.ts`, `src/lib/draft-storage.ts`, `src/lib/demo-access.functions.ts`,
  `src/lib/photo-requests.ts`, `src/lib/dismissals.ts`, `src/lib/notification-prefs.ts`,
  `src/lib/profile-completeness.ts`, `src/lib/profile-completeness.test.ts`, `src/lib/alignment.ts`,
  `src/lib/alignment.test.ts`, `src/lib/guna-milan.ts`, `src/lib/access-log.ts`,
  `src/lib/apply-validation.ts`, `src/lib/apply-validation.test.ts`, `src/lib/error-capture.ts`,
  `src/lib/gallery.ts`, `src/lib/icebreakers.ts`, `src/lib/safe-link.ts`, `src/lib/profile-columns.ts`,
  `src/lib/profile-options.ts`, `src/lib/migration-contract.test.ts`, `src/lib/dob.ts`
* `src/routes/apply.tsx`, `src/routes/auth.tsx`, `src/routes/_authenticated/onboarding.tsx`,
  `src/routes/_authenticated/members.tsx`, `src/routes/_authenticated/members.$id.tsx`,
  `src/routes/_authenticated/connections.tsx`, `src/routes/_authenticated/copilots.tsx`,
  `src/routes/_authenticated/copilot-invite.$code.tsx`, `src/routes/_authenticated/verification.tsx`,
  `src/routes/_authenticated/dashboard.tsx`, `src/routes/_authenticated/settings.tsx`,
  `src/routes/_authenticated/messages.index.tsx`, `src/routes/_authenticated/messages.$interestId.tsx`,
  `src/routes/_authenticated/notifications.tsx`, `src/routes/_authenticated/calls.tsx`,
  `src/routes/_authenticated/call.$callId.tsx`, `src/routes/_authenticated/admin.tsx`,
  `src/routes/_authenticated/shortlist.tsx`, `src/components/site-chrome.tsx`,
  `src/components/photo-gallery.tsx`, `src/components/member-photo.tsx`,
  `src/components/directory/member-card.tsx`, `src/components/call/pre-call-device-check.tsx`,
  `src/components/settings/{billing-partner-preferences-access-audit-logs-consent-ledger-account-danger-zone}.tsx`,
  `src/components/apply/types.ts`
* `src/integrations/supabase/client.ts`, `src/integrations/supabase/auth-middleware.ts`
* `supabase/functions/{razorpay-webhook,razorpay-checkout,razorpay-cancel,admin-review,delete-account,notify-dispatch,weekly-digest,turn-credentials,health}/index.ts`
  (read: webhook, checkout, admin-review, delete-account, notify-dispatch fully; others listed)
* `supabase/migrations/*` — directory listed (79 files), contract tests read;
  hold migration content referenced via `README.md` + `migration-contract.test.ts`.

---

**End of document.** No code changes were made during this discovery; recommendations await triage.
