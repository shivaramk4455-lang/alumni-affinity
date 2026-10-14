import "./lib/error-capture";

import { consumeLastCapturedError, runWithErrorCapture } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { reportServerError } from "./lib/server-alerts";
import { withSecurityHeaders } from "./lib/security-headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  context: {
    url: string;
    waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
  },
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const error = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(error);
  reportServerError(error, context);
  return withSecurityHeaders(
    new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(
    request: Request,
    env: unknown,
    ctx: { waitUntil?: ((promise: Promise<unknown>) => void) | undefined },
  ) {
    const alertContext = {
      url: request.url,
      waitUntil: ctx?.waitUntil?.bind(ctx),
    };
    try {
      const handler = await getServerEntry();
      const response = await runWithErrorCapture(() => handler.fetch(request, env, ctx));
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response, alertContext));
    } catch (error) {
      console.error(error);
      reportServerError(error, alertContext);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
