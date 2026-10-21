import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contract tests for the migration chain.
 *
 * The database is the enforcement point for almost every security and money
 * control in this product, and the CI migration-drill job is the only place
 * the SQL is actually executed. These tests are the cheap, always-on half of
 * that: they assert that the guards exist in the chain at all, so a later
 * migration cannot quietly drop one.
 *
 * They assert the PRESENCE of a control, never the absence of a bug, so a
 * false negative means "the control was removed" — which is exactly the
 * regression worth catching.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/** Every migration's SQL, concatenated, for "does this exist anywhere" checks. */
const chain = migrationFiles
  .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"))
  .join("\n");

const read = (name: string) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8");

/**
 * The SQL body of the NEWEST definition of a function in the chain.
 *
 * A function is redefined several times over the chain, so a slice taken from
 * the first occurrence would include the OLD body — and an assertion about
 * the current behaviour would then be checked against history. The slice also
 * stops at the end of the definition, so a later assertion that quotes the
 * function's own text is not mistaken for the function's body.
 */
const functionBody = (signature: string): string => {
  const at = chain.lastIndexOf(signature);
  expect(at, `definition not found in the chain: ${signature}`).toBeGreaterThan(-1);
  const end = chain.indexOf("$$;", at);
  expect(end, `unterminated definition: ${signature}`).toBeGreaterThan(at);
  return chain.slice(at, end);
};

describe("migration chain", () => {
  it("has a non-empty, strictly ordered chain", () => {
    expect(migrationFiles.length).toBeGreaterThan(50);
    const versions = migrationFiles.map((name) => name.slice(0, 14));
    expect(versions).toEqual([...versions].sort());
  });
});

describe("CRITICAL: the orphan-mandate reconciler can authenticate", () => {
  it("sends the gateway JWT the Edge Gateway requires", () => {
    // The function keeps verify_jwt enabled, so a cron job that omits the
    // Authorization header is rejected with a 401 before the function runs.
    const head = read("20261107000000_production_readiness_hardening_round2.sql");
    const at = head.indexOf("'reconcile-orphaned-subscriptions'");
    expect(at, "the reconcile job is not scheduled in the head migration").toBeGreaterThan(-1);
    const job = head.slice(at, head.indexOf("END $$;", at));

    expect(job).toContain("'Authorization', 'Bearer '");
    expect(job).toContain("service_role_key");
    expect(job).toContain("'X-Cron-Secret'");
  });

  it("reschedules the job with that header", () => {
    expect(chain).toContain("reconcile-orphaned-subscriptions");
    expect(chain).toMatch(/cron\.schedule\(\s*'reconcile-orphaned-subscriptions'/);
  });
});

describe("CRITICAL: interests cannot be back-dated", () => {
  it("stamps created_at and expires_at on insert", () => {
    expect(chain).toContain("FUNCTION public.guard_interest_insert_columns()");
    expect(chain).toContain("CREATE TRIGGER interests_guard_insert_columns");
    expect(chain).toMatch(/NEW\.created_at := now\(\)/);
  });

  it("grants INSERT on the three columns the browser actually sends", () => {
    expect(chain).toContain(
      "GRANT INSERT (sender_id, recipient_id, message) ON public.interests TO authenticated",
    );
    expect(chain).toContain("REVOKE INSERT ON public.interests FROM authenticated");
  });
});

describe("CRITICAL: a co-pilot relationship starts as an invitation", () => {
  it("forces an unbound, inactive invitation on insert", () => {
    expect(chain).toContain("FUNCTION public.guard_copilot_insert_columns()");
    expect(chain).toContain("CREATE TRIGGER copilots_guard_insert_columns");
    expect(chain).toMatch(/NEW\.status := 'invited'/);
    expect(chain).toMatch(/NEW\.copilot_user_id := NULL/);
  });

  it("grants INSERT on the invite columns only", () => {
    expect(chain).toContain(
      "GRANT INSERT (candidate_id, copilot_email, copilot_name, relation) ON public.copilots TO authenticated",
    );
  });
});

describe("CRITICAL: a checkout may not mint two mandates", () => {
  it("serialises concurrent checkouts with an advisory lock", () => {
    expect(chain).toContain("CREATE OR REPLACE FUNCTION public.claim_checkout_slot(");
    expect(functionBody("CREATE OR REPLACE FUNCTION public.claim_checkout_slot(")).toContain(
      "pg_advisory_xact_lock",
    );
  });

  it("returns an explicit verdict for every outcome", () => {
    const claim = functionBody("CREATE OR REPLACE FUNCTION public.claim_checkout_slot(");
    for (const verdict of ["claimed", "reuse", "already_active", "already_pending", "other_plan"]) {
      expect(claim, verdict).toContain(verdict);
    }
  });
});

describe("HIGH: entitlement requires recorded payment evidence", () => {
  it("gates the live row on amount_paid_paise", () => {
    expect(chain).toMatch(
      /FUNCTION private\.live_subscription\(_user uuid\)[\s\S]*?amount_paid_paise IS NOT NULL/,
    );
  });

  it("grandfathers existing payers so the change cannot lock them out", () => {
    expect(chain).toMatch(
      /UPDATE public\.subscriptions s[\s\S]*?SET amount_paid_paise = pl\.amount_paise[\s\S]*?s\.status IN \('active', 'authenticated'\)[\s\S]*?s\.amount_paid_paise IS NULL/,
    );
  });
});

describe("MEDIUM: the legacy teardown is safe to re-apply", () => {
  it("does not drop populated tables", () => {
    const legacy = read("20260928055910_803844cf-e85a-4362-81c6-44b4e942054c.sql");
    // The unconditional DROP TABLE ... CASCADE was destructive on an
    // already-migrated database: it removed the live messages, notifications
    // and reports tables, whose recreating migrations are already recorded.
    expect(legacy).not.toMatch(/^\s*DROP TABLE IF EXISTS public\.messages/m);
    expect(legacy).toContain("legacy teardown skipped");
    expect(legacy).toContain("row(s) present");
  });

  it("does not re-create the permissive directory policy", () => {
    const legacy = read("20260928055910_803844cf-e85a-4362-81c6-44b4e942054c.sql");
    expect(legacy).not.toContain(
      'CREATE POLICY "Members read visible onboarded" ON public.profiles',
    );
  });

  it("removes the permissive directory policy everywhere", () => {
    expect(chain).toContain(
      'DROP POLICY IF EXISTS "Members read visible onboarded" ON public.profiles',
    );
  });
});

describe("MEDIUM: the global sweeps are not member-callable", () => {
  it("revokes the global sweeps from authenticated", () => {
    expect(chain).toContain(
      "REVOKE EXECUTE ON FUNCTION public.expire_stale_interests() FROM PUBLIC, anon, authenticated",
    );
    expect(chain).toContain(
      "REVOKE EXECUTE ON FUNCTION public.sweep_stale_calls() FROM PUBLIC, anon, authenticated",
    );
  });

  it("provides member-scoped wrappers instead", () => {
    expect(chain).toContain("FUNCTION public.expire_my_stale_interests()");
    expect(chain).toContain("FUNCTION public.sweep_my_stale_calls()");
  });

  it("schedules the global sweeps", () => {
    expect(chain).toMatch(/cron\.schedule\(\s*'expire-stale-interests'/);
    expect(chain).toMatch(/cron\.schedule\(\s*'sweep-stale-calls'/);
  });
});

describe("MEDIUM: the conversation gate is never re-pointed", () => {
  it("does not rewrite the governing interest", () => {
    const conversation = functionBody(
      "CREATE OR REPLACE FUNCTION public.get_or_create_conversation(",
    );
    expect(conversation).not.toContain("SET interest_id = EXCLUDED.interest_id");
    expect(conversation).toContain("ON CONFLICT (participant_a, participant_b) DO NOTHING");
  });
});

describe("MEDIUM: the partner age band does not fabricate a birthday", () => {
  it("uses year granularity instead of a 1-January birthday", () => {
    const fn = functionBody("CREATE OR REPLACE FUNCTION private.profile_satisfies_preferences(");
    expect(fn).not.toContain("make_date(");
    expect(fn).toContain("EXTRACT(YEAR FROM current_date)");
  });
});

describe("regression assertions exist and fail loudly", () => {
  it("guards the controls this file asserts", () => {
    const head = read("20261107000000_production_readiness_hardening_round2.sql");
    expect(head).toContain("REGRESSION:");
    // The chain's own pattern: a failed assertion aborts the migration at
    // apply time, so a regression cannot reach production.
    expect(head).toMatch(/has_table_privilege\('authenticated', 'public\.interests', 'INSERT'\)/);
    expect(head).toContain("amount_paid_paise IS NOT NULL%");
  });
});

describe("HIGH: the private helpers are scoped to the caller", () => {
  const scoped = read("20261107001000_private_helper_scope_and_column_grants.sql");

  it("guards every relationship helper with a caller check", () => {
    // Each helper answers only when the caller is a party to the question,
    // so a member cannot read the relationship graph of the whole base.
    for (const fn of [
      "private.is_verified",
      "private.is_copilot_of",
      "private.has_accepted_interest",
      "private.has_photo_access",
      "private.is_active_copilot",
    ]) {
      const at = scoped.indexOf(`FUNCTION ${fn}(`);
      expect(at, `${fn} is not redefined`).toBeGreaterThan(-1);
      const body = scoped.slice(at, scoped.indexOf("$$;", at));
      expect(body, `${fn} has no caller-scope guard`).toContain("auth.uid()");
    }
  });

  it("keeps a service-role caller unrestricted", () => {
    // A cron or service-role caller has no identity; the guard must not
    // change its behaviour.
    expect(scoped).toContain("auth.uid() IS NULL OR");
  });

  it("hides the provider plan id from anon and members", () => {
    expect(scoped).toContain("REVOKE SELECT ON public.subscription_plans FROM anon, authenticated");
    // The granted column list must not include the provider's plan id.
    const grant = scoped.slice(
      scoped.indexOf("GRANT SELECT ("),
      scoped.indexOf(") ON public.subscription_plans"),
    );
    expect(grant).not.toContain("razorpay_plan_id");
  });

  it("exposes the member's own adult attestation on their profile view", () => {
    expect(scoped).toContain("p.adult_attested_at");
  });
});
