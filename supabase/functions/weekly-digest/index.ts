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
// Bounded: a runaway member count must not blow the function timeout.
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

  // Opted-in, onboarded, still discoverable. A paused member is deliberately
  // excluded: they have opted out of being pursued, and a digest is pursuit.
  // F-09: Track if recipients hit the limit to alert operators when paging is needed.
  const { data: recipients, error: recipientError } = await admin
    .from("notification_preferences")
    .select("user_id, digest_skip_when_empty")
    .eq("email_digest", true)
    .limit(MAX_MEMBERS);
  if (recipientError) return json({ error: recipientError.message }, 500);

  const hasMore = (recipients?.length ?? 0) >= MAX_MEMBERS;
  if (hasMore) {
    console.warn(
      `weekly-digest: MAX_MEMBERS (${MAX_MEMBERS}) reached. Keyset pagination recommended.`,
    );
  }

  // F-09: Chunk ID queries in batches of 100 to prevent HTTP 414 (Request-URI Too Large)
  // in PostgREST when querying large sets of UUIDs.
  const recipientIds = (recipients ?? []).map((r) => r.user_id);
  const eligibleIds = new Set<string>();
  const CHUNK_SIZE = 100;

  for (let i = 0; i < recipientIds.length; i += CHUNK_SIZE) {
    const chunk = recipientIds.slice(i, i + CHUNK_SIZE);
    const { data: eligibleChunk } = await admin
      .from("profiles")
      .select("id")
      .in("id", chunk)
      .eq("onboarded", true)
      .eq("verification_status", "verified")
      .is("paused_until", null);
    for (const p of eligibleChunk ?? []) eligibleIds.add(p.id);
  }

  const skipWhenEmpty = new Map(
    (recipients ?? []).map((r) => [r.user_id, r.digest_skip_when_empty !== false]),
  );

  // One pass per table, bucketed in memory. Four small queries beat N.
  const [interests, accepts, newMembers, views] = await Promise.all([
    admin
      .from("interests")
      .select("recipient_id")
      .gte("created_at", since)
      .eq("status", "pending")
      .limit(20000),
    admin
      .from("interests")
      .select("sender_id, recipient_id")
      .gte("decided_at", since)
      .eq("status", "accepted")
      .limit(20000),
    admin.from("profiles").select("id, city").gte("created_at", since).limit(20000),
    admin.from("profile_views").select("viewed_id").gte("viewed_at", since).limit(20000),
  ]);

  const newInterests = tally(interests.data, "recipient_id");
  const acceptSent = tally(accepts.data, "sender_id");
  const acceptReceived = tally(accepts.data, "recipient_id");
  const profileViews = tally(views.data, "viewed_id");

  // "New members in your city" needs each member's own city, so it is the one
  // figure that cannot come from a single shared aggregate.
  // Chunked in batches of 100 to protect against URL length limits.
  const eligibleIdList = [...eligibleIds];
  const audience: { id: string; city: string | null }[] = [];
  for (let i = 0; i < eligibleIdList.length; i += CHUNK_SIZE) {
    const chunk = eligibleIdList.slice(i, i + CHUNK_SIZE);
    const { data: audienceChunk } = await admin.from("profiles").select("id, city").in("id", chunk);
    if (audienceChunk) audience.push(...audienceChunk);
  }
  const cityCount = new Map<string, number>();
  for (const p of newMembers.data ?? []) {
    if (p.city) cityCount.set(p.city, (cityCount.get(p.city) ?? 0) + 1);
  }

  const summary = { considered: eligibleIds.size, queued: 0, skipped_empty: 0, failed: 0 };

  for (const member of audience ?? []) {
    if (!eligibleIds.has(member.id)) continue;

    const payload = {
      new_interests: newInterests.get(member.id) ?? 0,
      accepted: (acceptSent.get(member.id) ?? 0) + (acceptReceived.get(member.id) ?? 0),
      new_members: member.city ? (cityCount.get(member.city) ?? 0) : 0,
      profile_views: profileViews.get(member.id) ?? 0,
    };

    const empty =
      payload.new_interests === 0 &&
      payload.accepted === 0 &&
      payload.new_members === 0 &&
      payload.profile_views === 0;
    if (empty && skipWhenEmpty.get(member.id) !== false) {
      summary.skipped_empty += 1;
      continue;
    }

    // The date is part of the key, so a re-run on the same day collapses onto
    // the same rows instead of mailing everyone twice.
    const { error } = await admin.rpc("enqueue_notification", {
      _user: member.id,
      _template: "weekly_digest",
      _payload: payload,
      _idempotency_key: `weekly_digest:${member.id}:${new Date().toISOString().slice(0, 10)}`,
    });
    if (error) {
      summary.failed += 1;
      console.error(`digest ${member.id}: ${error.message}`);
    } else {
      summary.queued += 1;
    }
  }

  return json({ ok: true, has_more: hasMore, ...summary });
});

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
