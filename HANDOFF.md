# Project Handoff & Architecture Notes — The Merit Circle

## 1. Repository & Directory Structure

- **Root Repository**: `alumni-affinity-main/alumni-affinity-main` is the true Git root and package directory.
- Note: The parent directory `Downloads/alumni-affinity-main` is an outer wrapper folder and does not contain a valid `package.json` or `.git`. All CLI tools, package managers, and Git operations must be run from `alumni-affinity-main/alumni-affinity-main`.

## 2. Invariant Contracts & Database Architecture

- **Forward-Only Migrations**: `supabase/migrations/` is the single source of truth. There are no down-migrations. Migration chain head is `20261107001000_private_helper_scope_and_column_grants.sql`.
- **Subscription Entitlement Contract**:
  - Defined in `private.live_subscription()` (migration `20261107000000`).
  - Strict three-condition check: status `active` or `authenticated`, unexpired `period_end`, and **recorded payment** (`amount_paid_paise IS NOT NULL`).
  - Checkout abandonment (`created`) or payment failure (`pending`) never entitles.
- **Pacing & Reciprocity**: Introduction quota dynamically scaled (50%–150%) based on member response rates (`public.reciprocity_multiplier`).
- **DPDP Governance**: Append-only audit ledger in `consent_events` recorded via `record_consent()` for all partner preference and photo sharing adjustments.
- **Storage & Privacy**:
  - `profile-photos` and `verification-docs` are private buckets with 10 MB limits and magic-byte MIME validation (JPEG, PNG, WEBP, PDF).
  - Photo view displays in-DOM viewer identity watermark overlay.

## 3. UI/UX & Design System Standards

- **Heritage Palette**: Warm parchment (`#FBF9F5`), Midnight ink (`#0F172A`), Forest green (`#14281D`), Muted brass (`#B89563`), Hairline borders (`#E5E0D8`).
- **Strictly Zero AI Slop**:
  - No decorative gradients, glassmorphism, floating blobs, or cheesy clip-art.
  - Zero decorative `<Sparkles />` icons on astrological or matching features.
  - Concise, action-oriented button labels without helper fluff.
- **Progressive Disclosure & Component Architecture**:
  - In `members.tsx`, core search and primary filters stay visible; secondary filters (horoscope, diet, residency, etc.) remain in collapsible "More filters".
  - In `members.$id.tsx`, all candidate actions (Interest, Shortlist, Suggest, Hide, Report) are unified into a single ergonomic action bar.
  - In `dashboard.tsx`, verified users see actionable introductions directly; repetitive links duplicating top-level navigation are avoided.
  - In `settings.tsx`, heavy domain sections are modularized under `src/components/settings/`:
    - `billing-section.tsx`: Subscription tier status, allowances, Razorpay checkout & self-service cancellation.
    - `partner-preferences-section.tsx`: Criteria editor with DPDP audit ledger & unsaved changes dirty tracking.
    - `access-audit-logs-section.tsx`: Profile visitors, contact reveals, coarse activity tracking switch.
    - `consent-ledger-section.tsx`: Immutable DPDP Act s.12 consent receipt history.
    - `account-danger-zone.tsx`: Profile withdrawal & permanent data erasure cascade.

## 4. Verification Quality Gates

Before any commit or deployment, ensure all 4 verification gates pass:

```sh
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm run test       # vitest run (asserts coverage thresholds)
npm run build      # vite build (compiles client + SSR bundles)
```
