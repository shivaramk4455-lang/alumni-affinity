import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { isSubscriptionLive } from "./subscription-liveness";

// The billing rules live in their own module so they can be unit tested and
// coverage-thresholded on their own. They are re-exported here because this
// module is the product's public entry point for them.
export {
  isEventStale,
  isSubscriptionLive,
  isTerminalSubscriptionState,
  TERMINAL_SUBSCRIPTION_STATES,
} from "./subscription-liveness";

/**
 * Paid tiers.
 *
 * The browser never decides what a member is entitled to. It asks the server
 * for an entitlement, and the server decides from the Razorpay-derived
 * subscription row. The only thing this module writes is the *request* to
 * start a checkout.
 */
export type Plan = {
  code: string;
  label: string;
  amount_paise: number;
  currency: string;
  /** Finite. No plan may be unlimited — that promise degrades the network. */
  intro_requests: number | null;
  placement_weight: number;
  display_order: number;
  /** False = grandfathered legacy tier: still entitles, never sold again. */
  sellable: boolean;
  /** Human/service element of the tier, shown on the pricing card. */
  service_note: string | null;
};

export type MySubscription = {
  plan_code: string;
  status: string;
  requests_used: number;
  period_end: string | null;
  cancel_at_period_end: boolean;
  /**
   * Recorded payment evidence. The database only entitles a subscription row
   * that has one, so the browser must read the same column to agree with it.
   */
  amount_paid_paise: number | null;
};

export const inr = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);

export function usePlans() {
  return useQuery({
    queryKey: ["plans"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select(
          "code, label, amount_paise, currency, intro_requests, placement_weight, display_order, sellable, service_note",
        )
        .eq("active", true)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * The member's live subscription, if any. `null` means the free tier, which
 * is the normal case and not an error.
 */
export function useMySubscription() {
  return useQuery({
    queryKey: ["my-subscription"],
    queryFn: async (): Promise<MySubscription | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Unlike the free tier below, a failed session read is an error, not a
      // legitimate `null` — otherwise a paying member sees the free-tier upsell.
      if (!user) throw new Error("session unavailable");

      // Mirrors private.subscription_is_live() (migration 20261106000000), which
      // is the definition the send gate actually enforces:
      //
      //   * `pending` is the payment-FAILURE state. It used to be selected here,
      //     so a member whose renewal was declined saw a paid tier card and a
      //     working Cancel button for access they did not have.
      //   * a period that has ended is not live, even if the terminal webhook
      //     never arrived.
      //   * an abandoned `created` row is not a tier at all (the deployment
      //     checklist already asserted this, and the code disagreed).
      //
      // Returning a list rather than .maybeSingle() also removes a latent throw:
      // maybeSingle errors when two rows match, which is exactly the state a
      // double checkout used to produce.
      const { data: candidates, error: liveError } = await supabase
        .from("subscriptions")
        .select(
          "plan_code, status, requests_used, period_end, cancel_at_period_end, amount_paid_paise",
        )
        .in("status", ["active", "authenticated"])
        .order("created_at", { ascending: false });
      if (liveError) throw liveError;

      const live = (candidates ?? [])
        .map((row) => row as MySubscription)
        .find((row) => isSubscriptionLive(row.status, row.period_end, row.amount_paid_paise));
      return live ?? null;
    },
  });
}

type CheckoutResponse = {
  key_id: string;
  subscription_id: string;
  plan_code: string;
  amount_paise: number;
  currency: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

/**
 * Start a checkout.
 *
 * The server returns the key id and subscription id; the browser opens
 * Razorpay's modal with them. The script is loaded on demand and the flow is
 * a no-op with a clear message if the extension is missing, rather than a
 * thrown error in a click handler.
 */
export function useStartCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (planCode: string) => {
      const { data, error } = await supabase.functions.invoke<CheckoutResponse>(
        "razorpay-checkout",
        { body: { plan_code: planCode } },
      );
      // functions.invoke returns an error for a non-2xx, and the body carries
      // the reason; surface it rather than the generic "edge function error".
      if (error) throw new Error(await readErrorMessage(error));
      if (!data) throw new Error("Checkout could not be started.");
      return data;
    },
    onSuccess: async (session) => {
      try {
        await loadRazorpayScript();
      } catch {
        // The script comes from Razorpay's CDN on demand, so an ad-blocker or a
        // flaky connection rejects it. Previously that rejection escaped as an
        // unhandled promise rejection *after* the mutation had already reported
        // success: the member tapped "Choose plan", the spinner stopped, and
        // nothing happened — no modal, no error, no explanation.
        toast.error("The payment window could not be loaded. Check your connection and try again.");
        return;
      }
      if (!window.Razorpay) {
        toast.error("The payment window could not be loaded. Please try again.");
        return;
      }
      const razorpay = new window.Razorpay({
        key: session.key_id,
        subscription_id: session.subscription_id,
        name: "The Merit Circle",
        description: "Membership tier",
        handler: () => {
          // Razorpay redirects away and returns; the webhook is what actually
          // activates the tier, so this only nudges the cache to re-check.
          qc.invalidateQueries({ queryKey: ["my-subscription"] });
          qc.invalidateQueries({ queryKey: ["plans"] });
          toast.success("Payment received. Your tier activates within a minute.");
        },
        modal: {
          ondismiss: () => qc.invalidateQueries({ queryKey: ["my-subscription"] }),
        },
        theme: { color: "#8C6A3B" },
      });
      razorpay.open();
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/**
 * Self-service cancellation for active subscription.
 * Schedules cancellation at the end of the current billing cycle.
 */
export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        message?: string;
        error?: string;
      }>("razorpay-cancel");
      if (error) throw new Error(await readErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["my-subscription"] });
      qc.invalidateQueries({ queryKey: ["consent-events"] });
      toast.success(
        data?.message ||
          "Subscription scheduled for cancellation at the end of the billing period.",
      );
    },
    onError: (err: Error) => toast.error(err.message || "Could not cancel subscription."),
  });
}

async function readErrorMessage(error: { message?: string; context?: unknown }): Promise<string> {
  const context = error.context;
  // supabase-js attaches the raw Response to FunctionsHttpError as `context`,
  // so the edge function's { error } body was previously never read and every
  // non-2xx surfaced the generic "Edge Function returned a non-2xx status code"
  // instead of the reason the desk or the provider actually gave.
  if (context instanceof Response) {
    try {
      const body = (await context.json()) as { error?: string } | null;
      if (body?.error) return body.error;
    } catch {
      // Body was not JSON, or had already been consumed — fall through.
    }
  }
  const direct = (context as { error?: string } | undefined)?.error;
  return direct ?? error.message ?? "Could not start the payment.";
}

let scriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Drop the cached promise. Memoizing the rejection made "try again"
      // permanently broken: every later call reused the failed promise, so a
      // member who retried after a network blip could never reach checkout
      // again in that tab.
      scriptPromise = null;
      reject(new Error("Razorpay script failed to load"));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}
