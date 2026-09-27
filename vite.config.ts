// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { Plugin } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

import { GRIEVANCE_OFFICER } from "./src/lib/legal-identity";

/**
 * Release gate: a build flagged REQUIRE_LEGAL_IDENTITY=1 must not ship a
 * placeholder grievance officer (IT Rules 2021 require a named officer with
 * a monitored address). Local/dev builds are unaffected, so the gate can
 * never block a developer; CI/deploy set the env var.
 */
function legalIdentityGate(): Plugin {
  return {
    name: "legal-identity-gate",
    apply: "build",
    buildStart() {
      if (
        process.env["REQUIRE_LEGAL_IDENTITY"] === "1" &&
        !(GRIEVANCE_OFFICER.published as boolean)
      ) {
        throw new Error(
          "REQUIRE_LEGAL_IDENTITY=1 but src/lib/legal-identity.ts still has " +
            "`published: false`. Appoint the grievance officer, fill in their " +
            "details, and set published = true before releasing.",
        );
      }
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [legalIdentityGate()],
  },
});
