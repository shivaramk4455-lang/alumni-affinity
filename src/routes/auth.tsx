import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { startDemoSession } from "@/lib/demo-access.functions";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Sign in — The Merit Circle" },
      {
        name: "description",
        content: "Sign in or create your private Merit Circle membership account.",
      },
      { property: "og:title", content: "Sign in — The Merit Circle" },
      {
        property: "og:description",
        content: "Private, verified access for premier-institute alumni.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const credSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "At least 8 characters").max(72),
  fullName: z.string().trim().max(100).optional(),
});

const KNOWN_ROUTES = [
  "/members",
  "/connections",
  "/copilots",
  "/verification",
  "/dashboard",
  "/settings",
  "/notifications",
  "/admin",
  "/onboarding",
] as const;

/**
 * Parses the post-sign-in destination. Only same-origin absolute paths are
 * accepted (no "//host", no backslash escapes), so an attacker-supplied
 * `?redirect=` can never turn into an open redirect.
 */
function parseRedirect(raw: string | undefined): { pathname: string; search: string } | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  try {
    const url = new URL(raw, "http://internal.local");
    if (url.hostname !== "internal.local") return null;
    return { pathname: url.pathname, search: url.search };
  } catch {
    return null;
  }
}

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  /**
   * Adult attestation. Membership is 21+; the database CHECK on
   * profiles.birth_year is the real gate, this is the record that a human
   * affirmatively confirmed their age before an account existed.
   */
  const [adultAttested, setAdultAttested] = useState(false);
  const [attestError, setAttestError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const target = parseRedirect(redirect);

    // Deep links must survive sign-in, otherwise the co-pilot invite link an
    // invitee follows (they are signed out by definition) is silently lost.
    if (target && target.pathname.startsWith("/copilot-invite/")) {
      const code = target.pathname.slice("/copilot-invite/".length).split("/")[0] ?? "";
      if (code) {
        navigate({ to: "/copilot-invite/$code", params: { code }, replace: true });
        return;
      }
    }
    if (target && target.pathname.includes("onboarding")) {
      navigate({ to: "/onboarding", search: { prefill: "1" }, replace: true });
      return;
    }
    const known =
      target && (KNOWN_ROUTES as readonly string[]).includes(target.pathname)
        ? (target.pathname as (typeof KNOWN_ROUTES)[number])
        : null;
    navigate({ to: known ?? "/members", replace: true });
  }, [user, redirect, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "reset") {
      const value = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        toast.error("Enter a valid email address.");
        return;
      }
      setBusy(true);
      const { error } = await supabase.auth.resetPasswordForEmail(value, {
        redirectTo: window.location.origin + "/auth",
      });
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setResetSent(true);
      return;
    }
    const parsed = credSchema.safeParse({
      email,
      password,
      fullName: mode === "signup" ? fullName : undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    setBusy(true);
    if (mode === "signup") {
      // The attestation is checked here, before the account exists, because a
      // Google OAuth signup never passes through this form's checkbox at all.
      if (!adultAttested) {
        setBusy(false);
        setAttestError("Please confirm you are 21 or older to create an account.");
        return;
      }
      setAttestError(null);
      const { error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: window.location.origin + "/onboarding",
          data: {
            full_name: parsed.data.fullName,
            // handle_new_user() (20261014) reads this flag and stamps
            // profiles.adult_attested_at, so the affirmation becomes an
            // auditable server-side record rather than a browser boolean.
            adult_attested: true,
          },
        },
      });
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setSent(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
  }

  async function resendConfirmation() {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error("Enter your email address first.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: value });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Confirmation link re-sent. Check your inbox.");
  }
  async function google() {
    // On the signup tab the attestation applies to OAuth too, otherwise the
    // checkbox is trivially bypassed by clicking the Google button instead.
    if (mode === "signup" && !adultAttested) {
      setAttestError("Please confirm you are 21 or older to create an account.");
      return;
    }
    setAttestError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth",
      },
    });
    if (error) toast.error("Google sign-in failed. Please try again.");
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-12 px-5 py-14 md:grid-cols-2 md:px-8 md:py-24">
      <section className="max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
          Members only
        </p>
        <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight md:text-5xl">
          A private door, not a public directory.
        </h1>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          Profiles are only visible to signed-in, verified members. Nothing you share is indexed or
          listed publicly.
        </p>
      </section>
      <section className="border border-border bg-card p-6 shadow-paper md:p-10">
        {sent ? (
          <div>
            <h2 className="font-serif text-2xl font-semibold">Check your inbox</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              We sent a confirmation link to {email}. Open it to activate your membership and begin
              onboarding.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setSent(false);
                  setMode("signin");
                }}
              >
                Back to sign in
              </Button>
              <Button variant="ghost" onClick={resendConfirmation} disabled={busy}>
                Re-send link
              </Button>
            </div>
          </div>
        ) : resetSent ? (
          <div>
            <h2 className="font-serif text-2xl font-semibold">Reset link sent</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              If an account exists for {email}, a password-reset link is on its way. Follow it to
              choose a new password, then sign in.
            </p>
            <Button
              variant="outline"
              className="mt-6"
              onClick={() => {
                setResetSent(false);
                setMode("signin");
              }}
            >
              Back to sign in
            </Button>
          </div>
        ) : mode === "reset" ? (
          <>
            <h2 className="font-serif text-2xl font-semibold">Reset your password</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Enter the email you signed up with and we will send a reset link.
            </p>
            <form onSubmit={submit} className="mt-6 grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="em">Email</Label>
                <Input
                  id="em"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? "Please wait…" : "Send reset link"}
              </Button>
            </form>
            <Button variant="ghost" className="mt-4" onClick={() => setMode("signin")}>
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <div
              className="grid grid-cols-2 border border-border"
              role="tablist"
              aria-label="Account access"
            >
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  id={`auth-tab-${m}`}
                  aria-selected={mode === m}
                  aria-controls="auth-panel"
                  onClick={() => setMode(m)}
                  className={`py-3 text-sm font-medium ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {m === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>
            <form
              onSubmit={submit}
              className="mt-6 grid gap-4"
              id="auth-panel"
              role="tabpanel"
              aria-labelledby={`auth-tab-${mode}`}
            >
              {mode === "signup" && (
                <div className="grid gap-2">
                  <Label htmlFor="fn">Full name</Label>
                  <Input
                    id="fn"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="em">Email</Label>
                <Input
                  id="em"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pw">Password</Label>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                />
              </div>
              {mode === "signup" && (
                <div className="grid gap-2">
                  <div className="flex items-start gap-3">
                    <input
                      id="adult-attested"
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-[var(--brass-strong)]"
                      checked={adultAttested}
                      onChange={(e) => {
                        setAdultAttested(e.target.checked);
                        if (e.target.checked) setAttestError(null);
                      }}
                      aria-invalid={attestError ? true : undefined}
                      aria-describedby={attestError ? "adult-attested-error" : undefined}
                    />
                    <label htmlFor="adult-attested" className="text-xs leading-5">
                      I am 21 years of age or older. Membership is open to adults only, and age is
                      recorded as part of your profile.
                    </label>
                  </div>
                  {attestError && (
                    <p id="adult-attested-error" role="alert" className="text-xs text-destructive">
                      {attestError}
                    </p>
                  )}
                </div>
              )}
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
              {mode === "signin" && (
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    className="font-semibold text-foreground underline underline-offset-4"
                    onClick={() => setMode("reset")}
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline underline-offset-4"
                    onClick={resendConfirmation}
                    disabled={busy}
                  >
                    Re-send confirmation
                  </button>
                </div>
              )}
            </form>
            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button variant="outline" size="lg" className="w-full" onClick={google}>
              Continue with Google
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="mt-3 w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const tokens = await startDemoSession();
                  await supabase.auth.setSession(tokens);
                } catch {
                  toast.error("Guest preview is unavailable right now.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Explore as guest (no sign-up)
            </Button>
            <p className="mt-6 text-xs leading-5 text-muted-foreground">
              By continuing you agree to our{" "}
              <Link to="/terms" className="underline">
                terms of membership
              </Link>
              . New here?{" "}
              <Link to="/apply" className="underline">
                See what the application involves
              </Link>
              .
            </p>
          </>
        )}
      </section>
    </main>
  );
}
