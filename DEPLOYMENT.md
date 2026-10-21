# Production Deployment Guide — The Merit Circle

This guide documents the exact steps required to deploy **The Merit Circle** to production.

---

## 1. Prerequisites & Services

1. **Supabase Cloud Project** (Database, Auth, Storage, Edge Functions).
2. **Cloudflare Pages / Workers or Node.js Host** (for hosting TanStack Start SSR).
3. **Razorpay Merchant Account** (with activated Subscriptions product and Live API keys).
4. **Resend Account & Domain Verification** (for transactional and digest emails).
5. **Twilio Account** (optional, for SMS / WhatsApp alerts).
6. **TURN Server** (Cloudflare Calls, Twilio TURN, or Metered) for WebRTC cellular NAT traversal.

---

## 2. Database Migrations

Apply all SQL migrations in chronological order using the Supabase CLI:

```sh
supabase db push
```

> [!NOTE]
> `supabase/migrations/20260927000100_seed_directory.sql` has been guarded to automatically skip demo profiles in production environments. If you want test data in a staging environment, run `supabase db seed` which loads `supabase/seed.sql`.

---

## 3. Storage Buckets Verification

The migrations automatically configure private storage buckets with strict MIME types and file limits:

- `profile-photos`: `image/jpeg`, `image/png` (private, up to 10 MB)
- `verification-docs`: `application/pdf`, `image/jpeg`, `image/png` (private, up to 10 MB)

Verify in Supabase Dashboard under **Storage** that both buckets have **Public Bucket = OFF**.

---

## 4. Edge Functions Deployment & Secrets

Deploy the active edge functions:

```sh
supabase functions deploy admin-review
supabase functions deploy delete-account
supabase functions deploy notify-dispatch
supabase functions deploy weekly-digest
supabase functions deploy razorpay-checkout
supabase functions deploy razorpay-webhook
supabase functions deploy razorpay-cancel
supabase functions deploy turn-credentials
supabase functions deploy health
```

Set the production secrets for the Edge Functions:

```sh
supabase secrets set \
  SUPABASE_URL="https://<your-project-id>.supabase.co" \
  SUPABASE_ANON_KEY="<your-anon-key>" \
  SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>" \
  CRON_SECRET="<random-32-bytes-hex>" \
  RAZORPAY_KEY_ID="rzp_live_..." \
  RAZORPAY_KEY_SECRET="..." \
  RAZORPAY_WEBHOOK_SECRET="..." \
  RESEND_API_KEY="re_..." \
  ALERT_FROM_EMAIL="The Merit Circle <alerts@themeritcircle.in>" \
  TWILIO_ACCOUNT_SID="AC..." \
  TWILIO_AUTH_TOKEN="..." \
  TWILIO_FROM_NUMBER="+..." \
  WHATSAPP_SENDER_NUMBER="+..." \
  TURN_STATIC_SECRET="<coturn-static-auth-secret>" \
  TURN_REALM="themeritcircle.in" \
  TURN_URLS="turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349"
```

> `CRON_SECRET` must match vault `cron_secret` below; without it
> `notify-dispatch` and `weekly-digest` answer 500 to every caller including
> pg_cron (fail-closed by design). `TURN_STATIC_SECRET` must match coturn's
> `static-auth-secret` or minted credentials will not authenticate.

````

---

## 5. PostgreSQL Vault Secrets (for `pg_cron` Scheduled Jobs)

Migration `20261007000000_schedule_notifications.sql` runs the outbox dispatcher every 5 minutes and the weekly digest on Monday morning via `pg_cron` and `pg_net`.

Run the following SQL snippet in the Supabase SQL Editor to register the HTTP webhook credentials in Supabase Vault:

```sql
SELECT vault.create_secret('https://<your-project-id>.supabase.co', 'project_url');
SELECT vault.create_secret('<your-service-role-key>', 'service_role_key');
SELECT vault.create_secret('<same-random-value-as-CRON_SECRET>', 'cron_secret');
````

---

## 6. Razorpay Webhook Configuration

1. In Razorpay Dashboard → **Settings** → **Webhooks**, add a new webhook:
   - **Webhook URL:** `https://<your-project-id>.supabase.co/functions/v1/razorpay-webhook`
   - **Secret:** (Set the same secret used in `RAZORPAY_WEBHOOK_SECRET` above)
   - **Alert Email:** `compliance@themeritcircle.in`
   - **Active Events:**
     - `subscription.activated`
     - `subscription.authenticated`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `subscription.pending`
     - `subscription.halted`
     - `subscription.cancelled`
     - `subscription.completed`
     - `subscription.expired`
     - `refund.processed`
     - `payment.dispute.created`
     - `payment.dispute.closed`

   `refund.processed` and the `payment.dispute.*` events are **required**, not
   optional. Without them a refund or a chargeback never reaches the webhook,
   the row stays `active`, and the paid tier stays live while the money has
   left the business — the exact scenario the refund branch in
   `razorpay-webhook` exists to reverse. The handler matches any event whose
   name starts with `payment.dispute`, so subscribe the dispute events your
   Razorpay plan exposes.

---

## 7. Appoint the First Membership Desk Admin

To designate an initial staff administrator for verification reviews, run:

```sql
UPDATE public.profiles
   SET is_admin = true,
       verification_status = 'verified',
       onboarded = true
 WHERE id = '<your-user-uuid>';
```

Desk staff can then access `/admin` to review submissions, inspect credentials, and manage community reports.

---

## 9. Deployment Checklist (phase 3)

Run in this order; each step is verifiable on its own.

1. **Env vars (hosting)**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, plus the server
   error sink: `RESEND_API_KEY` (same value as the edge-function
   secret), `SERVER_ALERT_TO_EMAIL` (ops inbox that receives 500
   digests) **and `ALERT_FROM_EMAIL`** (the sending address — without it
   the alert sink disables itself and every 500 becomes console-only, which
   is the same as having no alerting at all). Nothing secret is ever
   `VITE_*`; there is no `VITE_TURN_*` requirement any more (see §12).
2. **Edge secrets**: the block in §4 — including `CRON_SECRET`, `TURN_STATIC_SECRET`,
   `TURN_REALM`, `TURN_URLS`.
3. **Vault**: `project_url`, `service_role_key`, `cron_secret` (§5) — with
   `cron_secret` equal to `CRON_SECRET`, otherwise the two unattended functions
   answer 500 to pg_cron and no alert ever sends.
4. **Migrations**: `supabase db push` — applies the full chain through
   `20261107001000_private_helper_scope_and_column_grants`. Several migrations
   fail loudly on purpose, by design: `20261010000001_phase2_regression_assertions`
   (Phase-2 fixes), `20261026000000_repair_photo_view_requests` (photo
   request guards), `20261028000000_rate_limit_purposes` (the purposes CHECK)
   and `20261029000000_deletion_receipts` (the receipt must never carry an FK
   to `profiles`, or Section 12 evidence would cascade away with the member),
   plus `20261107000000` (the column-scoped grants, the atomic checkout claim,
   the payment-evidence rule and the member-scoped sweeps) and
   `20261107001000` (the private-helper caller scoping and the column-scoped
   plan reads). On a production database this also removes
   residual demo-directory rows (guarded, see README) and repairs the
   `my_profile` view. Link once, then push (the database password is
   prompted, never passed here):

   ```sh
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   **`--include-all` is no longer needed.** Production's recorded history skips
   a block of files from 2026-09-28/30 (suite-split UUID renames), and
   `--include-all` would re-apply them to a populated database. Two of those
   files were destructive on that path — the legacy teardown dropped the live
   `messages`, `notifications` and `reports` tables (whose recreating
   migrations are already recorded, so they would never come back) and the
   duplicate foreign-key file re-validated every key against live rows. Both
   are now safe to re-apply, but the reconciling history is still worth doing
   deliberately: take a snapshot first, and run `supabase migration list`
   against production to see exactly what is outstanding.

5. **Storage**: `profile-photos` (10 MB) and `verification-docs` (10 MB) both private,
   MIME-limited (§3).
6. **Razorpay**: webhook URL + secret + the twelve events (§6), then a live ₹1
   test subscription to confirm `invoice.paid` flips the row to `active` and
   that an abandoned checkout does **not** show as a tier in Settings. A tier
   is only live once a payment has been RECORDED — `amount_paid_paise` must be
   non-null — so `subscription.activated` on its own never grants access.
7. **Desk**: appoint the first admin (§7) and the Grievance Officer details on
   `/grievance` (currently a marked placeholder).
8. **Guest preview account**: `guest.demo@meritcircle.example` is a real,
   verified, onboarded account used for demos. Its password was previously
   derivable from the project URL, which shipped in the public browser bundle —
   treat it as **compromised**. Rotate it (Dashboard → Authentication → Users →
   reset password) or delete the account before launch. The client can no longer
   sign into it at all; only the server function can, and only when **both**
   `ENABLE_DEMO_MODE=true` **and** `NODE_ENV` is not production. The browser
   additionally requires `VITE_ENABLE_DEMO_MODE=true` **and** a non-production
   build. All three flags are off by default.
   Rotating is zero-downtime: change `DEMO_GUEST_PASSWORD` in the
   hosting env and the demo function resets the guest user's
   password to the new value on its next session start.
9. **Smoke tests**: signup → onboarding → verification submit → admin approve →
   search → interest → accept → contact reveal → message → call → block → logout.
10. **Cron**: `select * from cron.job;` shows eight jobs —
     `notify-dispatch` (`*/5 * * * *`), `weekly-digest` (`30 6 * * 1`,
     Mondays 06:30 UTC = 12:00 IST), `prune-webhook-events` (`0 3 * * *`),
     `purge-verification-docs` (`47 3 * * *`), `expire-lapsed-subscriptions`
     (`7 * * * *`), `reconcile-orphaned-subscriptions` (`23 * * * *`),
     `expire-stale-interests` (`*/5 * * * *`) and `sweep-stale-calls`
     (`*/5 * * * *`); manually `POST`
     `notify-dispatch` with the `X-Cron-Secret` header and confirm
     `{"ok":true,...}`.

     Every job that calls an edge function needs BOTH headers: the gateway
     JWT (`Authorization: Bearer <service_role_key>`, read from Vault) and the
     function's own `X-Cron-Secret`. A job with only the secret is rejected
     with a 401 by the Edge Gateway before the function body runs, and
     `net.http_post` swallows the failure — the job looks healthy while doing
     nothing. `reconcile-orphaned-subscriptions` is the one that matters most:
     without it, a member who deletes their account keeps being debited.

## 10. Rollback Plan

- **Application**: redeploy the previous build. No client-side migration is
  required; the frontend degrades safely (it reads `my_profile`, which only
  gained columns).
- **Database**: there are **no down migrations** — the chain is forward-only.
  Rolling back means restoring the previous definitions by hand from migration
  history, so take a snapshot before pushing and treat the migration as
  irreversible. The migrations that replace a policy or a view name the
  previous definition they supersede in their header comment.
- **The one that must not be rolled back**: `20261107000000` closes the
  column-scoped grants, the atomic checkout claim and the payment-evidence
  rule. Reverting it re-opens the allowance bypass and the double-mandate
  race; if it must be reverted, pause new checkouts first (undeploy
  `razorpay-checkout`) so no further double mandates can be minted.
- **Demo-table reset**: `supabase db reset` rebuilds from migrations and
  `supabase/seed.sql` (development only).
- **Payments**: disabling `razorpay-checkout` (undeploy) stops new checkouts
  while the webhook keeps existing subscriptions accurate; entitlement falls
  back to the free pacing quota, so no member loses access to the core product.

## 11. Operational Notes

- **Watermarking**: photo views show a viewer-identity overlay in the DOM. The
  signed URL still serves the original file, so the overlay is a deterrent, not
  a forensic mark — the privacy policy, community standards and the consent
  ledger say exactly that. Baking the mark into the file needs an image
  pipeline.
- **Cron auth**: `notify-dispatch` and `weekly-digest` require `X-Cron-Secret`
  (rotation via `CRON_SECRET_PREVIOUS` / `X-Cron-Previous`). A manual flush by
  the desk must send the same header.
- **Grievance officer**: `/grievance` and the footer show a clearly marked
  placeholder until a real officer is appointed; publish the details before
  taking production traffic.

## 12. Client TURN fallback (only when `turn-credentials` is absent)

The production path is server-minted, TTL-bound credentials from the
`turn-credentials` edge function (§4); in production no client-side variable
holds a long-lived TURN credential. The variables below are the legacy
self-hosted fallback only (see `.env.example`, and note
`getIceServersAsync()` prefers the function).

Set them in the Cloudflare/hosting dashboard only if you are deliberately
running without `turn-credentials`:

```env
VITE_TURN_URLS="turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349"
VITE_TURN_USERNAME="turnuser"
VITE_TURN_CREDENTIAL="turnpassword"
```

Either way, verify calls connect reliably between users on 4G/5G mobile carriers (Jio, Airtel) and corporate networks — without working TURN, symmetric-NAT callers simply fail.
