/**
 * Response headers applied to every SSR response.
 *
 * The CSP is deliberately limited to directives that cannot break the app
 * (no script-src / style-src / connect-src yet) — it stops clickjacking,
 * plugin embedding and <base> hijacking without risking the Tailwind runtime,
 * the Supabase client or the Lovable preview frame. Tightening script-src
 * needs nonce plumbing through TanStack Start's script tags.
 */
const CONTENT_SECURITY_POLICY = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self' https://lovable.dev https://*.lovable.app https://*.lovableproject.com https://*.lovableproject-dev.com http://localhost:3000",
].join("; ");

export function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(self), microphone=(self), geolocation=()",
    // OAuth popups need to keep the opener reference.
    "cross-origin-opener-policy": "same-origin-allow-popups",
  };
  if (import.meta.env["PROD"]) {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

/** Adds the headers above without ever throwing on an immutable Response. */
export function withSecurityHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(securityHeaders())) {
    if (response.headers.has(key)) continue;
    try {
      response.headers.set(key, value);
    } catch {
      /* immutable headers — leave the response untouched */
    }
  }
  return response;
}
