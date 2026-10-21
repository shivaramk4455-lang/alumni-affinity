// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.
// Uses AsyncLocalStorage when available so concurrent SSR requests never
// cross-consume each other's captured errors, with a TTL fallback.
//
// The fallback is a FIFO queue, not a single slot. A single slot is
// last-write-wins, so a request that finished later could consume an error
// captured by a request that was still running — and a member's 500 would be
// reported with another member's error and stack. The queue hands each
// consumer the OLDEST unconsumed error instead, which is the right one
// whenever requests fail in the order they started.

type CapturedEntry = { error: unknown; at: number };
type StoreHolder = { current?: CapturedEntry | undefined };

let requestStore: {
  getStore: () => StoreHolder | undefined;
  run: <T>(store: StoreHolder, fn: () => T) => T;
} | null = null;

try {
  // Dynamically resolved in Node / Cloudflare Workers with nodejs_compat
  const asyncHooks = (
    globalThis as unknown as { AsyncLocalStorage?: new () => typeof requestStore }
  ).AsyncLocalStorage;
  if (asyncHooks) {
    requestStore = new asyncHooks();
  }
} catch {
  requestStore = null;
}

if (!requestStore) {
  // Visible on purpose: without AsyncLocalStorage the captured error is
  // correlated by order rather than by request, so a mis-attributed stack is
  // possible under load. Say so once at boot rather than silently degrading.
  console.warn(
    "[error-capture] AsyncLocalStorage is unavailable, so captured SSR errors are correlated by order rather than by request.",
  );
}

/**
 * Errors captured while no request-scoped store was available. Bounded so a
 * burst of failures cannot grow it without limit.
 */
const pendingCaptured: CapturedEntry[] = [];
const MAX_PENDING = 20;
const TTL_MS = 5_000;

export function runWithErrorCapture<T>(fn: () => T): T {
  if (requestStore) {
    return requestStore.run({}, fn);
  }
  return fn();
}

function record(error: unknown) {
  const entry: CapturedEntry = { error, at: Date.now() };
  const store = requestStore?.getStore();
  if (store) {
    store.current = entry;
    return;
  }
  pendingCaptured.push(entry);
  if (pendingCaptured.length > MAX_PENDING) pendingCaptured.shift();
}

const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === "string" ? current : safeStringify(current));
      break;
    }
    const label = depth === 0 ? "" : "caused by: ";
    const status = describeStatus(current);
    parts.push(`${label}${current.stack ?? `${current.name}: ${current.message}`}${status}`);
    current = current.cause;
  }
  return parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT);
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" ? ` (status ${value})` : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const expanded = args.map((arg) => {
    if (!isErrorLike(arg)) return arg;
    record(arg);
    return describeError(arg);
  });
  originalConsoleError(...expanded);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  // Exact match: the request-scoped store holds only this request's error.
  const store = requestStore?.getStore();
  if (store?.current) {
    const { error, at } = store.current;
    store.current = undefined;
    if (Date.now() - at <= TTL_MS) return error;
  }

  // Fallback: take the OLDEST unconsumed error, not the newest. A single
  // last-write-wins slot let a request consume another request's error.
  while (pendingCaptured.length > 0) {
    const entry = pendingCaptured.shift()!;
    if (Date.now() - entry.at <= TTL_MS) return entry.error;
  }
  return undefined;
}
