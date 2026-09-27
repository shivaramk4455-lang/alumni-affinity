type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  track?: (event: string, properties?: Record<string, unknown>) => string | null;
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
    __lovableReportRuntimeError?: (payload: {
      message: string;
      stack?: string;
      filename?: string;
    }) => void;
    Sentry?: {
      captureException: (error: unknown, captureContext?: Record<string, unknown>) => void;
    };
  }
}

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  // Forward to Sentry if installed and configured in production
  if (window.Sentry?.captureException) {
    window.Sentry.captureException(error, { extra: context });
  }

  // Forward to Lovable Editor telemetry if running inside preview iframe
  if (window.__lovableEvents?.captureException) {
    window.__lovableEvents.captureException(
      error,
      {
        source: "react_error_boundary",
        route: window.location.pathname,
        ...context,
      },
      {
        mechanism: "react_error_boundary",
        handled: false,
        severity: "error",
      },
    );
  }

  // Prod React does not rethrow boundary-caught errors to window.onerror.
  // Forward to runtime error listener if present
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  if (window.__lovableReportRuntimeError) {
    window.__lovableReportRuntimeError({
      message,
      ...(stack !== undefined && { stack }),
      filename: window.location.pathname,
    });
  } else if (!import.meta.env["PROD"]) {
    console.error("[Runtime Error]", message, stack, context);
  }
}
