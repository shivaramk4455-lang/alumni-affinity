// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { Plugin } from "vite";
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
function legalIdentityGate(): Plugin {
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
 */
const PUBLIC_SUPABASE_URL =
  process.env["VITE_SUPABASE_URL"] ||
  process.env["SUPABASE_URL"] ||
  "https://eopcauzciqflikfdhmcj.supabase.co";
const PUBLIC_SUPABASE_KEY =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
  process.env["SUPABASE_PUBLISHABLE_KEY"] ||
  "sb_publishable_6lPH6KNKcSiWYBfFKjBDxQ_Fmzd29vv";
const PUBLIC_SUPABASE_PROJECT_ID =
  process.env["VITE_SUPABASE_PROJECT_ID"] ||
  process.env["SUPABASE_PROJECT_ID"] ||
  "eopcauzciqflikfdhmcj";

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
    plugins: [legalIdentityGate()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(PUBLIC_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(PUBLIC_SUPABASE_KEY),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(PUBLIC_SUPABASE_PROJECT_ID),
    },
  },
});
