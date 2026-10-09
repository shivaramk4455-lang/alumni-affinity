// Server-side error sink (Phase 3 observability).
//
// The SSR server logs expanded errors to console, but console output in
// a serverless runtime is ephemeral and pages nobody. This buffers
// catastrophic errors and emails an aggregated digest to the ops inbox
// via Resend — the provider the app already uses for alerts — so a 500
// storm reaches a human without adding a new vendor or a database
// table. Unconfigured (no RESEND_API_KEY / SERVER_ALERT_TO_EMAIL) the
// sink is a no-op and console-only logging remains the baseline.
import { describeError } from "./error-capture";

type ServerAlertContext = {
  url?: string | undefined;
  // Cloudflare's ExecutionContext keeps a fire-and-forget promise
  // alive past the response; Node (dev) does not need it.
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
};

type ErrorRecord = {
  at: string;
  url?: string | undefined;
  detail: string;
};

const FLUSH_AFTER_MS = 60_000;
const FLUSH_AFTER_COUNT = 10;
const MAX_DETAIL_CHARS = 4_000;
const MAX_EMAIL_CHARS = 9_000;

let buffer: ErrorRecord[] = [];
let lastFlushAt = 0;

function alertConfig(): { apiKey: string; to: string; from: string } | null {
  const apiKey = process.env["RESEND_API_KEY"];
  const to = process.env["SERVER_ALERT_TO_EMAIL"];
  if (!apiKey || !to) return null;
  return {
    apiKey,
    to,
    from: process.env["ALERT_FROM_EMAIL"] ?? "The Merit Circle <alerts@resend.dev>",
  };
}

export function reportServerError(error: unknown, context: ServerAlertContext = {}): void {
  try {
    buffer.push({
      at: new Date().toISOString(),
      url: context.url,
      detail: describeError(error).slice(0, MAX_DETAIL_CHARS),
    });
    const due = buffer.length >= FLUSH_AFTER_COUNT || Date.now() - lastFlushAt >= FLUSH_AFTER_MS;
    if (!due) return;
    lastFlushAt = Date.now();
    const records = buffer;
    buffer = [];
    const send = flush(records);
    if (context.waitUntil) context.waitUntil(send);
    else void send;
  } catch {
    // The sink must never break the response it is alerting about.
  }
}

async function flush(records: ErrorRecord[]): Promise<void> {
  const cfg = alertConfig();
  if (!cfg) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [cfg.to],
        subject: `${records.length} server error${records.length === 1 ? "" : "s"} — The Merit Circle`,
        text: digest(records),
      }),
    });
    if (!res.ok) {
      console.error(`alert sink: resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      // Transient provider failure: re-queue so the storm is not lost.
      requeue(records);
    }
  } catch (error) {
    console.error("alert sink: flush failed", error);
    requeue(records);
  }
}

function requeue(records: ErrorRecord[]): void {
  buffer = [...records, ...buffer].slice(0, FLUSH_AFTER_COUNT * 4);
}

// Aggregate by error signature so a recurring 500 sends one line with a
// count instead of one email per occurrence.
function digest(records: ErrorRecord[]): string {
  const groups = new Map<string, { count: number; first: ErrorRecord; example: string }>();
  for (const record of records) {
    const signature = record.detail.split("\n")[0] ?? record.detail;
    const group = groups.get(signature);
    if (group) {
      group.count += 1;
    } else {
      groups.set(signature, { count: 1, first: record, example: record.detail });
    }
  }
  return [...groups.values()]
    .map((g) =>
      [
        `${g.count > 1 ? `×${g.count} ` : ""}${g.first.at}${g.first.url ? ` ${g.first.url}` : ""}`,
        g.example,
      ].join("\n"),
    )
    .join("\n\n")
    .slice(0, MAX_EMAIL_CHARS);
}
