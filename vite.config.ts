// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { PluginOption } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

import { GRIEVANCE_OFFICER, unresolvedLegalFields } from "./src/lib/legal-identity";

/**
 * Release gate: a build flagged REQUIRE_LEGAL_IDENTITY=1 must not ship a
 * placeholder grievance officer (IT Rules 2021 Rule 3(2) requires a *named*
 * officer with a monitored address; Rules 3A/4 add the Nodal Officer).
 *
 * The check deliberately does not trust the `published` flag on its own — that
 * is a manual boolean a human could flip while placeholders remain. It requires
 * `published === true` AND every required field to hold a real, deliverable
 * value, and reports every outstanding field at once so a single build tells
 * the operator everything they still need to supply.
 *
 * Local/dev builds are unaffected (the env var is unset), so the gate can never
 * block day-to-day development. CI's release job sets it.
 */
function legalIdentityGate(): PluginOption {
  return {
    name: "legal-identity-gate",
    apply: "build",
    buildStart() {
      if (process.env["REQUIRE_LEGAL_IDENTITY"] !== "1") return;

      const problems: string[] = [];
      if (GRIEVANCE_OFFICER.published !== true) {
        problems.push("- src/lib/legal-identity.ts: GRIEVANCE_OFFICER.published is still `false`.");
      }
      for (const field of unresolvedLegalFields()) {
        problems.push(`- ${field.label}: ${field.hint}`);
      }
      if (problems.length === 0) return;

      throw new Error(
        "REQUIRE_LEGAL_IDENTITY=1 — refusing to build.\n\n" +
          "This service cannot lawfully be published without a named Grievance " +
          "Officer, a monitored complaint address, a Nodal Officer and a DPO " +
          "contact point (IT Rules 2021 Rules 3(2)(a), 3A and 4(1); DPDP Act 2023 " +
          "Sections 5, 13 and 14).\n\n" +
          "Outstanding:\n" +
          problems.join("\n") +
          "\n\nFill these in at src/lib/legal-identity.ts and set `published: true`.\n" +
          "Do not invent values to satisfy this gate.",
      );
    },
  };
}

/**
 * Public Lovable Cloud connection values (URL + publishable key — both are
 * browser-safe; all protection comes from RLS). `.env` is gitignored in this
 * repo, so hosted builds would otherwise bake empty values into the client
 * bundle and blank the screen with "Missing Supabase environment variable(s)".
 * Env values still win when present. NEVER add a service-role/secret key here.
 *
 * WHY THESE LITERALS ARE STILL HERE, AND WHAT CHANGED
 *
 * The values below are the PRODUCTION project. Falling back to them silently
 * meant that a build with no environment at all — a CI build, a preview, a
 * contributor's first `npm run dev` — bound to the production database and
 * read and wrote real members' data. The loud "missing Supabase environment
 * variable(s)" path in src/integrations/supabase/client.ts could never be
 * reached, because the fallback made the variables never missing.
 *
 * The fallback is kept (the hosted builder does not inject env vars at build
 * time, and a bundle with no URL is a blank screen), but it is no longer
 * silent:
 *
 *   * every build now PRINTS which project it is about to talk to;
 *   * a release build can demand real configuration by setting
 *     REQUIRE_SUPABASE_CONFIG=1, which fails the build instead of falling
 *     back — the same gate shape as REQUIRE_LEGAL_IDENTITY below.
 */
const PRODUCTION_SUPABASE_URL = "https://beetszutyuihbnzzmokr.supabase.co";
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_6lPH6KNKcSiWYBfFKjBDxQ_Fmzd29vv";
const PRODUCTION_SUPABASE_PROJECT_ID = "beetszutyuihbnzzmokr";

const configuredSupabaseUrl = process.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"] || "";
const configuredSupabaseKey =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_PUBLISHABLE_KEY"] || "";
const configuredSupabaseProjectId =
  process.env["VITE_SUPABASE_PROJECT_ID"] || process.env["SUPABASE_PROJECT_ID"] || "";

const usingProductionFallback = !configuredSupabaseUrl || !configuredSupabaseKey;

const PUBLIC_SUPABASE_URL = configuredSupabaseUrl || PRODUCTION_SUPABASE_URL;
const PUBLIC_SUPABASE_KEY = configuredSupabaseKey || PRODUCTION_SUPABASE_PUBLISHABLE_KEY;
const PUBLIC_SUPABASE_PROJECT_ID = configuredSupabaseProjectId || PRODUCTION_SUPABASE_PROJECT_ID;

/**
 * Release gate: a build flagged REQUIRE_SUPABASE_CONFIG=1 must not fall back
 * to the built-in production project. A build that silently binds to
 * production is how a preview or a CI artefact ends up pointed at real
 * members' data.
 */
function supabaseConfigGate(): PluginOption {
  return {
    name: "supabase-config-gate",
    apply: "build",
    buildStart() {
      if (usingProductionFallback) {
        console.warn(
          "[supabase-config] No SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY in the build " +
            `environment: this bundle is bound to the PRODUCTION project ${PRODUCTION_SUPABASE_PROJECT_ID}. ` +
            "Set them in the build environment, or set REQUIRE_SUPABASE_CONFIG=1 to fail the build instead.",
        );
      }

      if (process.env["REQUIRE_SUPABASE_CONFIG"] !== "1") return;

      const missing: string[] = [];
      if (!configuredSupabaseUrl) missing.push("SUPABASE_URL / VITE_SUPABASE_URL");
      if (!configuredSupabaseKey)
        missing.push("SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY");

      if (missing.length === 0) return;

      throw new Error(
        "REQUIRE_SUPABASE_CONFIG=1 — refusing to build.\n\n" +
          "This build would fall back to the built-in PRODUCTION Supabase project " +
          `(${PRODUCTION_SUPABASE_PROJECT_ID}). Set the following in the build ` +
          "environment instead:\n\n" +
          missing.map((m) => `  - ${m}`).join("\n") +
          "\n\nThe publishable key is browser-safe; never set a service-role key " +
          "in a VITE_* variable.",
      );
    },
  };
}

// Server-side fallbacks (SSR + server functions read process.env).
process.env["SUPABASE_URL"] ||= PUBLIC_SUPABASE_URL;
process.env["SUPABASE_PUBLISHABLE_KEY"] ||= PUBLIC_SUPABASE_KEY;
// Vite's env loader also picks VITE_* up from process.env, covering bracket access.
process.env["VITE_SUPABASE_URL"] ||= PUBLIC_SUPABASE_URL;
process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||= PUBLIC_SUPABASE_KEY;
process.env["VITE_SUPABASE_PROJECT_ID"] ||= PUBLIC_SUPABASE_PROJECT_ID;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [legalIdentityGate(), supabaseConfigGate()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(PUBLIC_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(PUBLIC_SUPABASE_KEY),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(PUBLIC_SUPABASE_PROJECT_ID),
    },
  },
});
