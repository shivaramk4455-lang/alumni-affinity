# The Merit Circle

Build a fully mobile-responsive web app for an elite IIT/IIM and premier-institute alumni matrimonial platform — a mature, private competitor to IITIIMShaadi where candidates lead and families co-pilot.

Design and aesthetic requirements:

- Strictly NO AI slop: zero purple or blue gradients, zero glowing glassmorphism, zero floating blobs, zero cheesy clip-art or cartoon avatars.
- Established heritage aesthetic: warm linen/parchment background (#FBF9F5), deep midnight ink (#0F172A) or heritage forest (#14281D), crisp hairline borders (#E5E0D8), and muted brass accents (#B89563).
- Editorial typography (classic high-contrast serif for headings, clean geometric sans for UI text).
- Established credibility layer: formal membership standards, discreet trust badges, institutional verification details, and a complete professional footer with Indian IT Act compliance, grievance officer, and privacy terms.

Key pages & flows:

1. Responsive Landing Page:
   - Quiet, confident hero and positioning for premier alumni
   - 'Candidate Leads, Family Co-Pilots' model explained
   - Clear eligibility criteria (IITs, IIMs, BITS, AIIMS, top global universities)
   - Privacy guarantees (zero public directory, ghost mode, verified-only access)
2. Application with device-saved draft that carries into signup and pre-fills onboarding (`/apply` → `/auth` → `/onboarding?prefill=1`).
3. Member search with institution, relocation, gender and age filters plus pagination (`/members`); report/block hides profiles from the reporter's search. Partner criteria live in `/settings` and drive alignment badges and a "Best match" sort.
4. Introductions with notifications on send/accept/decline (`/connections`); contact details unlock on acceptance.
5. Family co-pilots limited to two per candidate (DB-enforced), suggestions, invite-accept notifications (`/copilots`).
6. Verification with manual desk review: members submit to `pending_review`; admins approve or request resubmission at `/admin` via the `admin-review` edge function, which also writes a notification.
7. Legal pages (`/privacy`, `/terms`, `/standards`, `/grievance`) and account settings with withdrawal (`/settings`).

## Setup

```sh
npm i        # or: bun i
npm run dev  # or: bun run dev
npm run typecheck
npm run lint
```

Required environment: copy `.env.example` to `.env` and fill it in. `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (server) and their `VITE_` twins (client) drive the app.

> [!WARNING]
> `SUPABASE_SERVICE_ROLE_KEY` bypasses every RLS policy. It is **server-only** and must never appear in a `VITE_*` variable — Vite inlines any `VITE_*` name into the public browser bundle. Set it with `supabase secrets set` for the edge function rather than writing it to `.env`.

### Database

`supabase/migrations/` is the only migration chain — apply it in filename order
(`supabase db push`, or `supabase db reset` locally). The chain head is
`20261105000000_copilot_photo_directory_repair`; `DEPLOYMENT.md` carries the
deployment steps (§2) and the launch checklist (§9).

The table below maps the foundations only. The chain has since grown well past
it, so treat the directory listing — not this table — as the record:

| Migration                                     | What it adds                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `2026092503*`                                 | `profiles`, `interests`, `copilots`, recommendations, storage policies, `private.*` helpers                                          |
| `20260926000000_completion`                   | buckets, `is_admin`, `reports`, `notifications`, co-pilot cap, verified-column guard                                                 |
| `20260927000000_desk_review_hardening`        | verification audit columns, `verification_rejected` outcome                                                                          |
| `20260927000100_seed_directory`               | curated demo directory (no `auth.users` counterparts)                                                                                |
| `20260927000200_saved_profiles`               | member shortlist                                                                                                                     |
| `20260928000000_consent_hardening`            | introduction state machine, notification whitelisting, email-bound co-pilot invites, verified-only directory                         |
| `20260928000100_private_fields`               | column grants, `my_profile` view, `reveal_contact(s)`, `desk_review_queue`, `desk_reports`                                           |
| `20260928000200_storage_and_integrity`        | bucket size/MIME limits, foreign keys to `profiles` and `auth.users`                                                                 |
| `20260930000000_gated_messaging`              | post-acceptance messaging: `conversations`, `messages`, realtime-safe RLS, `get_or_create_conversation()`                            |
| `20261001000000_calls`                        | P2P video calls: `calls`, `call_signals`, call-state guards, signal purge on end, `call_missed` inbox                                |
| `20261002000000_partner_preferences`          | `partner_preferences` (owner-only criteria: age band, gender, institutions, cities, relocation)                                      |
| `20261003000000_pacing`                       | 5-active quota, 14-day expiry + day-7 reminder, `expired` state, `interest_expired/_reminder` inbox                                  |
| `20261004000000_dpdp_governance`              | append-only `consent_events` ledger, `record_consent()`, sabbatical pause, deletion-ready directory                                  |
| `20261008000000_subscriptions`                | Razorpay tiers: `subscription_plans`, `subscriptions`, `entitlement()`, `record_intro_usage()`                                       |
| `20261010000000_phase2_fix_batch`             | tier enforcement + `created` no longer entitles, `my_profile` repair, `blocked` state, server-side inbox rows, `sweep_stale_calls()` |
| `20261010000001_phase2_regression_assertions` | fail-loud migrate-time assertions for the fixes above                                                                                |

### Paid tiers (as enforced — not just sold)

| Tier      | Price / month | Introduction allowance    | Discovery pacing |
| --------- | ------------- | ------------------------- | ---------------- |
| Free      | —             | 5 outstanding at any time | 14-day expiry    |
| Concierge | ₹1,499        | 20 per billing month      | as free          |
| Founder   | ₹3,999        | 60 per billing month      | as free          |

Founder is **grandfathered and no longer sold** (`sellable = false`); it is kept
so existing payers keep the tier they bought. No plan may promise unlimited
volume — `20261011000000` fails at migrate time if one does — so this table and
the numbers in `subscription_plans` must agree.

Enforcement lives in the database (`interests_allowance` trigger calling
`public.entitlement()`), never in the browser, and an **unpaid checkout never
entitles**. The one definition of "counts as paid" is
`private.subscription_is_live()` (migration `20261106000000`): status
`active`/`authenticated` **and** an unexpired `period_end`. `pending` is the
payment-failure state and never entitles; neither does `created` (an abandoned
checkout). A "no" from the recipient does not consume the sender's allowance
twice. Change prices or allowances in `subscription_plans`; no code change is
needed.

> One product decision was made for you and is marked `SAFE DEFAULT` in
> `20261010000000_phase2_fix_batch.sql`: the free tier keeps the 5-outstanding
> pacing quota _and_ paid allowances are monthly. Adjust both there if the
> membership desk wants different numbers.

### Demo directory safety

`20260927000100_seed_directory` is **opt-in**: it seeds the eight demo members
only when `app.seed_demo_directory = 'on'` is set for that session (never in
production). `20261010000000_phase2_fix_batch` removes any demo rows an older
database let through, guarded on the fixed seed ids, no usable login and no
introduction activity.

Promote desk staff (run as the project owner — the guard trigger blocks self-verification, so this must bypass `auth.uid()`):

```sql
UPDATE public.profiles SET is_admin = true WHERE id = '<admin-user-uuid>';
```

To try the app end-to-end without a second person, mark your own account verified the same way:

```sql
UPDATE public.profiles SET verification_status = 'verified', onboarded = true
 WHERE id = '<your-user-uuid>';
```

Deploy the `supabase/functions/admin-review` and `supabase/functions/delete-account` edge functions (both need `SUPABASE_ANON_KEY` as well as the service key — they fail closed if it is missing).

Verify: signup → onboarding → verification submit → admin approve → **set partner preferences** → search → interest → accept → contact reveal → **message** → **video call** → co-pilot invite → suggest → notifications → withdraw.

## Security model

The product promise is "verified people, candidate-led consent". That is enforced in the database, not in React:

- **Verified-only directory.** `profiles` is readable only by members whose own `verification_status = 'verified'`, and only rows that are `verified AND onboarded AND is_visible`. Ghost mode keeps you visible to people you already have an introduction with, so hiding never breaks a conversation you started.
- **Introductions are a state machine.** `enforce_interest_transition` owns the legal transitions: a sender may withdraw or reopen, and **only the recipient may accept** — the sender can never write `accepted`.
- **Private columns are revoked, not hidden.** `contact_phone`, `linkedin_url`, `alumni_email`, `verification_note`, `verification_doc_path`, `is_admin` and the audit columns have no `SELECT` grant for `authenticated`. They are served through `public.my_profile` (your own row, view is hard-scoped to `auth.uid()`), `public.reveal_contact(s)` (only with a mutually accepted introduction) and the `desk_*` functions (which re-check `private.is_admin()`).
- **Notifications cannot be forged.** Members may only insert cross-member notification kinds with a whitelisted internal destination.
- **Co-pilot invites are email-bound.** `accept_copilot_invite(code)` is the only way to claim an invitation, and it requires the signed-in email to match; `candidate_id`, `invite_code` and `copilot_email` are immutable afterwards.
- **Messaging is gated and sealed.** `conversations` rows can only be created by `get_or_create_conversation(interest_id)`, which raises unless the caller is a party to an **accepted** interest — so there is no member-to-member channel outside a mutual introduction. Sending a message additionally re-checks `interests.status = 'accepted'`, so withdrawing closes the thread. Members may only write their own messages and only stamp `read_at` on messages addressed to them; there is no edit or delete, which keeps the desk audit trail intact.
- **Video calls are peer-to-peer and equally gated.** A `calls` row exists only on the conversation of that same accepted interest, and only those two candidates can read it. Media travels browser-to-browser over WebRTC (STUN only — no vendor sees the session); only SDP/ICE descriptions cross the database through RLS-scoped `call_signals`, which a DB trigger purges the moment the call ends. Call identity is frozen by `guard_call_columns` (ended calls can never reopen); a 45s unanswered ring and any hang-up close the call and write a `call_missed` inbox item.
- **Compatibility is a private computation, not a stored score.** `partner_preferences` is a single owner-only row (RLS: `auth.uid() = user_id` on read/write) holding the age band, preferred genders, institutions, cities and relocation stances. `src/lib/alignment.ts` scores candidates **client-side** over directory-visible fields only — institution 3, city 2, relocation 2, age band 2, gender 1 — so there is no score table to leak and no server round-trip to influence. An empty preference row means "no constraint" and simply yields no badges, so search keeps the normal recency order.
- **Deliberate pacing.** At most five _outstanding_ introductions per sender (DB trigger, quota error maps to a human toast). Unanswered interest quietly expires after 14 days (`expire_stale_interests()`, callable by any member, plus a day-7 reminder), reopening re-arms a fresh window and only the recipient can ever accept; contacts and messaging auto-lock on expiry or withdrawal.
- **DPDP data governance.** `consent_events` is an append-only ledger (no UPDATE/DELETE for members; a new row records a changed mind) fed by `src/lib/consent.ts` at onboarding, verification uploads and contact saves, readable in Settings. Sabbatical mode (`paused_until`, max one year) removes you from search while preserving everything; everything real deletes on profile cascade, and a `delete-account` edge function (typed confirmation, storage purge first, profile row next, auth user last) exercises the right to erasure.
- **Every client query lists columns explicitly.** Selecting a revoked column errors instead of leaking. `src/lib/profile-columns.ts` holds the allowed projections — a `.join(", ")` there would widen the type to `string` and silently degrade the result type, so they are plain string literals on purpose.

SSR responses carry `object-src`, `base-uri`, `frame-ancestors`, HSTS, `nosniff` and a referrer policy from `src/lib/security-headers.ts`. A stricter `script-src` needs nonce plumbing through TanStack Start's script tags.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9dc0ccb0-eae3-4815-ad44-380dbc38ac85).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
