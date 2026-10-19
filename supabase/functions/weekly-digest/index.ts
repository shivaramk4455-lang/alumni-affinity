// deno-lint-ignore-file
// Weekly digest builder.
//
// Run once a week by pg_cron. Aggregates the last seven days per member,
// then enqueues one email per opted-in member. Aggregation happens here
// rather than in SQL-per-member so the whole week is a handful of queries
// instead of one per profile.
//
// Members with an empty week are skipped by default: a digest that says
// "0 new introductions, 0 accepted" is the fastest way to earn an unsubscribe.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";
import { cronAuthError } from "../_shared/cron-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WEEK_DAYS = 7;
// Page size for the opt-in scan. Bounded per page: a runaway member count
// pages through instead of blowing the function timeout.
const MAX_MEMBERS = 5000;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Server configuration error" }, 500);
  // No caller identity by design (pg_cron invokes this); the shared cron
  // secret is the whole boundary. The publishable key alone must not pass.
  const cronRejection = cronAuthError(req);
  if (cronRejection) return cronRejection;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const since = new Date(Date.now() - WEEK_DAYS * 86_400_000).toISOString();
  const weekId = getIsoWeekString();

  type InterestRecipientRow = { recipient_id: string };
  type InterestAcceptRow = { sender_id: string; recipient_id: string };
  type ProfileCityRow = { id: string; city: string | null };
  type ProfileViewRow = { viewed_id: string };

  // Paginated aggregate scans past single-query limits:
  // Week aggregates are shared across pages (computed once): per-page
  // recomputation would repeat the same scans and drift mid-run.
  const [interestsRows, acceptsRows, newMembersRows, viewsRows] = await Promise.all([
    fetchAllRows<InterestRecipientRow>((from, to) =>
      admin
        .from("interests")
        .select("recipient_id")
        .gte("created_at", since)
        .eq("status", "pending")
        .range(from, to),
    ),
    fetchAllRows<InterestAcceptRow>((from, to) =>
      admin
        .from("interests")
        .select("sender_id, recipient_id")
        .gte("decided_at", since)
        .eq("status", "accepted")
        .range(from, to),
    ),
    fetchAllRows<ProfileCityRow>((from, to) =>
      admin.from("profiles").select("id, city").gte("created_at", since).range(from, to),
    ),
    fetchAllRows<ProfileViewRow>((from, to) =>
      admin.from("profile_views").select("viewed_id").gte("viewed_at", since).range(from, to),
    ),
  ]);

  const newInterests = tally(interestsRows, "recipient_id");
  const acceptSent = tally(acceptsRows, "sender_id");
  const acceptReceived = tally(acceptsRows, "recipient_id");
  const profileViews = tally(viewsRows, "viewed_id");

  const cityCount = new Map<string, number>();
  for (const p of newMembersRows ?? []) {
    if (p.city) cityCount.set(p.city, (cityCount.get(p.city) ?? 0) + 1);
  }

  const summary = { considered: 0, queued: 0, skipped_empty: 0, failed: 0, pages: 0, week: weekId };

  // Recipients page by keyset (user_id order); each page advances the cursor,
  // so a 5001st opt-in is page two, not a silent drop.
  let cursor: string | null = null;
  for (;;) {
    let pageQuery = admin
      .from("notification_preferences")
      .select("user_id, digest_skip_when_empty")
      .eq("email_digest", true)
      .order("user_id")
      .limit(MAX_MEMBERS);
    if (cursor) pageQuery = pageQuery.gt("user_id", cursor);
    const { data: recipients, error: recipientError } = await pageQuery;
    if (recipientError) return json({ error: recipientError.message }, 500);
    if (!recipients?.length) break;
    summary.pages += 1;

    // Eligibility + audience per page, chunked (100) to protect PostgREST
    // from over-long `in()` lists (HTTP 414).
    const CHUNK_SIZE = 100;
    const recipientIds = recipients.map((r) => r.user_id);
    const eligible = new Map<string, { city: string | null; skipEmpty: boolean }>();
    for (let i = 0; i < recipientIds.length; i += CHUNK_SIZE) {
      const chunk = recipientIds.slice(i, i + CHUNK_SIZE);
      const { data: chunkRows } = await admin
        .from("profiles")
        .select("id, city")
        .in("id", chunk)
        .eq("onboarded", true)
        .eq("verification_status", "verified")
        .is("paused_until", null);
      for (const p of chunkRows ?? []) {
        const pref = recipients.find((r) => r.user_id === p.id);
        eligible.set(p.id, {
          city: (p as { city?: string | null }).city ?? null,
          skipEmpty: pref?.digest_skip_when_empty !== false,
        });
      }
    }
    summary.considered += eligible.size;

    for (const [memberId, info] of eligible) {
      const payload = {
        new_interests: newInterests.get(memberId) ?? 0,
        accepted: (acceptSent.get(memberId) ?? 0) + (acceptReceived.get(memberId) ?? 0),
        new_members: info.city ? (cityCount.get(info.city) ?? 0) : 0,
        profile_views: profileViews.get(memberId) ?? 0,
      };

      const empty =
        payload.new_interests === 0 &&
        payload.accepted === 0 &&
        payload.new_members === 0 &&
        payload.profile_views === 0;
      if (empty && info.skipEmpty) {
        summary.skipped_empty += 1;
        continue;
      }

      // The ISO week is part of the key, so a re-run in the same week collapses onto
      // the same rows instead of mailing everyone twice.
      const { error } = await admin.rpc("enqueue_notification", {
        _user: memberId,
        _template: "weekly_digest",
        _payload: payload,
        _idempotency_key: `weekly_digest:${memberId}:${weekId}`,
      });
      if (error) {
        summary.failed += 1;
        console.error(`digest ${memberId}: ${error.message}`);
      } else {
        summary.queued += 1;
      }
    }

    cursor = recipients[recipients.length - 1]!.user_id;
  }

  return json({ ok: true, ...summary });
});

/** Formats the current date as an ISO week string, e.g. "2026-W42" */
function getIsoWeekString(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Keyset/range pages through all records for an unbounded aggregate scan */
async function fetchAllRows<T extends Record<string, unknown>>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
  pageSize = 5000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      console.error("Aggregation scan error:", error);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/** Count rows into a map keyed by the given column. */
function tally<T extends Record<string, unknown>>(
  rows: T[] | null,
  key: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows ?? []) {
    const value = row[key];
    if (typeof value === "string") out.set(value, (out.get(value) ?? 0) + 1);
  }
  return out;
}
