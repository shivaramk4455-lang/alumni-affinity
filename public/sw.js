/* The Merit Circle app shell.
 *
 * Deliberately conservative: private member pages are NEVER cached, so a
 * stale service worker can never resurrect someone else's directory data on
 * a shared device. Only the public marketing routes (/, /apply, /auth and
 * the legal pages) get an offline shell, plus same-origin hashed bundles
 * (content-addressed names mean a stale copy is always byte-identical).
 */

const CACHE = "merit-circle-shell-v1";

const SHELL = [
  "/",
  "/apply",
  "/auth",
  "/privacy",
  "/terms",
  "/standards",
  "/grievance",
  "/manifest.webmanifest",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.addAll(SHELL);
      } catch {
        // Offline at install time: the shell simply stays uncached.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Suppress the TS nudge for the worker scope; this file ships verbatim.
const sw = self;

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Immutable hashed bundles: safe to serve stale forever.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
    return;
  }

  // Documents: network first, fall back to the cached shell only offline.
  // Member routes are NOT in the cache, so they fail closed when offline
  // instead of showing another member's stale data.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit ?? caches.match("/").then((home) => home ?? Response.error())),
        ),
    );
    return;
  }
});
