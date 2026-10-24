import { useState } from "react";
import { Crown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  inr,
  useCancelSubscription,
  useMySubscription,
  usePlans,
  useStartCheckout,
} from "@/lib/subscription";

export function BillingSection() {
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const subscription = useMySubscription();
  const plans = usePlans();
  const checkout = useStartCheckout();
  const cancelSub = useCancelSubscription();

  return (
    <section className="mt-6 border border-border bg-card p-6 md:p-8">
      <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
        <Crown className="size-5 text-brass" /> Membership tier
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Introductions, messaging and one-to-one video calls are free and always will be. Paid
        membership buys the desk's time — curated shortlists and priority human replies — not a
        metered quota of introductions.
      </p>

      {subscription.isError ? (
        <p
          role="alert"
          className="mt-6 border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
        >
          Your membership could not be loaded, so your current tier is hidden rather than shown as
          the complimentary tier — we will not offer a member an upgrade they already hold.{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => void subscription.refetch()}
            disabled={subscription.isFetching}
          >
            {subscription.isFetching ? "Retrying…" : "Retry"}
          </button>
        </p>
      ) : subscription.isLoading ? (
        <div className="mt-6" aria-busy="true">
          <span className="sr-only">Loading your membership…</span>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : subscription.data ? (
        <div className="mt-6 border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold">
                {plans.data?.find((pl) => pl.code === subscription.data?.plan_code)?.label ??
                  subscription.data.plan_code}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {subscription.data.requests_used > 0
                  ? `${subscription.data.requests_used} introduction${
                      subscription.data.requests_used === 1 ? "" : "s"
                    } sent this month.`
                  : "No introductions sent this month."}
                {subscription.data.period_end
                  ? ` ${subscription.data.cancel_at_period_end ? "Expires" : "Renews"} ${new Date(
                      subscription.data.period_end,
                    ).toLocaleDateString("en-IN", {
                      dateStyle: "medium",
                    })}.`
                  : ""}
              </p>
            </div>
            <span className="rounded-full border border-border px-3 py-1 text-xs capitalize text-muted-foreground">
              {subscription.data.cancel_at_period_end
                ? "Cancelling at period end"
                : subscription.data.status}
            </span>
          </div>
          {subscription.data.cancel_at_period_end ? (
            <div className="border-t border-border bg-secondary/30 p-4 text-xs text-muted-foreground">
              Cancellation scheduled. Your tier benefits remain active until the end of your current
              billing period.
            </div>
          ) : (
            <div className="border-t border-border p-4">
              {cancelConfirmOpen ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-destructive">
                    Cancel recurring membership?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your priority benefits will continue until the end of your billing cycle. You
                    will not be billed again, and your membership will smoothly revert to the
                    complimentary tier.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={cancelSub.isPending}
                      onClick={() =>
                        cancelSub.mutate(undefined, {
                          onSettled: () => setCancelConfirmOpen(false),
                        })
                      }
                    >
                      {cancelSub.isPending ? "Cancelling…" : "Confirm cancellation"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCancelConfirmOpen(false)}>
                      Keep subscription
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => setCancelConfirmOpen(true)}
                >
                  Cancel recurring subscription
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {plans.data?.map((plan) => (
            <div key={plan.code} className="flex flex-col border border-border p-5">
              <p className="font-serif text-xl font-semibold">{plan.label}</p>
              <p className="mt-1 text-2xl font-semibold">{inr(plan.amount_paise)}</p>
              <p className="mt-1 text-xs text-muted-foreground">per month</p>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm text-muted-foreground">
                <li>
                  {plan.intro_requests == null
                    ? "Introduction allowance set by the desk"
                    : `${plan.intro_requests} introduction requests each month`}
                </li>
                <li>
                  Reach is earned too: answering introductions you receive can raise your effective
                  allowance up to 1.5×; letting them lapse lowers it.
                </li>
                <li>Unlimited one-to-one video calls</li>
                {plan.service_note && <li>{plan.service_note}</li>}
              </ul>
              {plan.sellable ? (
                <Button
                  className="mt-5"
                  disabled={checkout.isPending}
                  onClick={() => checkout.mutate(plan.code)}
                >
                  {checkout.isPending ? "Opening checkout…" : `Choose ${plan.label}`}
                </Button>
              ) : (
                <p className="mt-5 border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground">
                  No longer sold — existing members keep this tier.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
