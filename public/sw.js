/* The Merit Circle app shell.
 *
 * Deliberately conservative: private member pages are NEVER cached, so a
 * stale service worker can never resurrect someone else's directory data on
 * a shared device. Only the public marketing routes (/, /apply, /auth and
 * the legal pages) get an offline shell, plus same-origin hashed bundles
 * (content-addressed names mean a stale copy is always byte-identical).
 */

const CACHE = "merit-circle-shell-v2";

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

const PUBLIC_DOCUMENT_PATHS = new Set([
  "/",
  "/apply",
  "/auth",
  "/privacy",
  "/terms",
  "/standards",
  "/grievance",
]);

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

const sw = self;

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Immutable hashed bundles: cache-first and populate cache on miss.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          void cache.put(req, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  // Documents: network first. Public routes fall back to their cached shell;
  // private member routes fail closed when offline rather than serving stale shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const exactHit = await caches.match(req);
        if (exactHit) return exactHit;
        if (PUBLIC_DOCUMENT_PATHS.has(url.pathname)) {
          const home = await caches.match("/");
          if (home) return home;
        }
        return Response.error();
      }),
    );
    return;
  }
});
