import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * Vitest configuration.
 *
 * The tests are plain TypeScript units (no JSX, no server routes), so they
 * run without the TanStack Start plugin — but they DO need the `@/` path
 * alias from tsconfig, which is why the alias plugin is wired here directly.
 *
 * Coverage is measured and THRESHOLDED. Without a threshold, a coverage
 * number is decoration: a security-critical module could quietly lose its
 * tests and the build would still be green.
 *
 * The thresholds are PER MODULE, and only on modules that are genuinely unit
 * testable — the pure logic that carries security and money decisions. A
 * global threshold over every file in src/ would either be meaningless (a
 * few percent) or would demand a test harness this repository does not have
 * (React component rendering). The pure decision logic is what actually
 * needs protecting, so that is what is held to a line.
 */
export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "text"],
      reportsDirectory: "./coverage",
      include: [
        "src/lib/security-headers.ts",
        "src/lib/safe-link.ts",
        "src/lib/subscription-liveness.ts",
        "src/lib/guna-milan.ts",
      ],
      thresholds: {
        // The notification-destination allowlist: the only thing standing
        // between a stored notification link and an open redirect.
        "src/lib/safe-link.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // The CSP, the cache policy and the defensive headers.
        "src/lib/security-headers.ts": {
          statements: 95,
          branches: 90,
          functions: 100,
          lines: 95,
        },
        // The billing rules the database enforces. If this drifts from
        // private.live_subscription(), a member is shown a tier they do not
        // have — or a payer is shown as unpaid.
        "src/lib/subscription-liveness.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // The compatibility score.
        "src/lib/guna-milan.ts": {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
