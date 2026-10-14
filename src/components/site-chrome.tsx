import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import {
  ArrowUpRight,
  Bell,
  ChevronDown,
  Landmark,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { GRIEVANCE_OFFICER, SITE_TAGLINE } from "@/lib/legal-identity";
import type { MyProfileRow } from "@/lib/profile-columns";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useMyProfile } from "@/hooks/use-my-profile";
import { notificationDestination } from "@/lib/safe-link";

const publicNav = [
  { to: "/", label: "Membership" },
  { to: "/apply", label: "How to apply" },
  // Verification is a member-only route, so a logged-out click bounced to
  // sign-in and looked identical to "Sign in". This points at the real
  // standards/verification section on the home page instead, so the item
  // shows something of its own.
  { to: "/", label: "Verification", hash: "verification" },
] as const;
const memberNav = [
  { to: "/dashboard", label: "Home" },
  { to: "/members", label: "Search" },
  { to: "/connections", label: "Introductions" },
  { to: "/messages", label: "Messages" },
  { to: "/calls", label: "Calls" },
  { to: "/shortlist", label: "Shortlist" },
  { to: "/notifications", label: "Notifications" },
  { to: "/copilots", label: "Co-pilots" },
  { to: "/verification", label: "Verification" },
  { to: "/settings", label: "Settings" },
] as const;

const adminNav = [
  { to: "/dashboard", label: "Home" },
  { to: "/members", label: "Search" },
  { to: "/connections", label: "Introductions" },
  { to: "/messages", label: "Messages" },
  { to: "/calls", label: "Calls" },
  { to: "/shortlist", label: "Shortlist" },
  { to: "/notifications", label: "Notifications" },
  { to: "/copilots", label: "Co-pilots" },
  { to: "/verification", label: "Verification" },
  { to: "/admin", label: "Desk" },
  { to: "/settings", label: "Settings" },
] as const;

/** Every nav item shape, so a shared menu can hold any of the three arrays. */
type NavItem = (typeof publicNav)[number] | (typeof memberNav)[number] | (typeof adminNav)[number];

/**
 * Overflow menu for the crowded primary nav.
 *
 * Members once had every destination listed inline — nine items once Messages
 * and Shortlist landed — which pushed the bell, email and Sign out off the
 * row at normal laptop widths. The four daily destinations stay visible; the
 * rest live behind this.
 *
 * ARIA menu-button pattern: `aria-haspopup` + `aria-expanded`, Escape closes,
 * and an outside click closes so a stray click never leaves it stuck open.
 */
function NavMenu({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-2 min-w-44 border border-border bg-card p-1 shadow-paper"
        >
          {items.map((item) => (
            <Link
              key={item.label}
              role="menuitem"
              to={item.to}
              {...("hash" in item ? { hash: item.hash } : {})}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Signed photo URL for member avatar thumbnail in navbar/menus. */
function useUserAvatar(path?: string | null) {
  return useQuery({
    queryKey: ["navbar-avatar", path],
    enabled: !!path,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("profile-photos")
        .createSignedUrl(path!, 3600);
      if (error) return null;
      return data?.signedUrl ?? null;
    },
  });
}

/**
 * Round thumbnail avatar button that opens a user profile card and menu.
 * Replaces the raw explicit email in the header to preserve privacy while
 * keeping the email, profile link, and settings one tap away.
 */
function UserNavMenu({
  user,
  profile,
  onSignOut,
}: {
  user: User;
  profile: MyProfileRow | null | undefined;
  onSignOut: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const avatar = useUserAvatar(profile?.photo_path);
  const displayName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Member";
  const initials = profile?.full_name?.trim()
    ? profile.full_name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join("")
    : (user.email?.[0]?.toUpperCase() ?? "M");

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.email ?? "member"}`}
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1.5 rounded-full p-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <span className="relative grid size-9 place-items-center overflow-hidden rounded-full border border-border bg-secondary shadow-sm transition-transform group-hover:scale-105 group-hover:border-brass/70">
          {avatar.data ? (
            <img
              src={avatar.data}
              alt={displayName}
              className="size-full object-cover"
              loading="eager"
            />
          ) : (
            <span className="font-serif text-xs font-semibold text-foreground">{initials}</span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-3 text-muted-foreground transition-transform duration-200 group-hover:text-foreground ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="User account options"
          className="absolute right-0 top-full z-50 mt-2 w-72 border border-border bg-card p-0 shadow-paper"
        >
          {/* Header section with User Thumbnail, Full Name, and Email */}
          <div className="border-b border-border bg-secondary/25 p-4">
            <div className="flex items-center gap-3">
              <div className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary">
                {avatar.data ? (
                  <img src={avatar.data} alt={displayName} className="size-full object-cover" />
                ) : (
                  <span className="font-serif text-sm font-semibold text-foreground">
                    {initials}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-serif text-sm font-semibold text-foreground">
                  {displayName}
                </p>
                {/* User email shown prominently when pressed */}
                <p
                  className="mt-0.5 select-all truncate text-xs text-muted-foreground"
                  title={user.email ?? ""}
                >
                  {user.email}
                </p>
                {profile?.verification_status === "verified" ? (
                  <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-brass">
                    <ShieldCheck className="size-3" /> Identity verified
                  </span>
                ) : (
                  <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    Verification pending
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Navigation items */}
          <div className="p-1">
            {user.id && (
              <Link
                role="menuitem"
                to="/members/$id"
                params={{ id: user.id }}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <UserRound className="size-4" />
                <span>My Profile</span>
              </Link>
            )}
            <Link
              role="menuitem"
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings className="size-4" />
              <span>Settings & Preferences</span>
            </Link>
            <Link
              role="menuitem"
              to="/verification"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ShieldCheck className="size-4" />
              <span>Verification Status</span>
            </Link>
            {profile?.is_admin && (
              <Link
                role="menuitem"
                to="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-brass transition-colors hover:bg-muted"
              >
                <Landmark className="size-4" />
                <span>Admin Desk</span>
              </Link>
            )}
          </div>

          {/* Sign out button */}
          <div className="border-t border-border p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void onSignOut();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="size-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const list = useQuery({
    queryKey: ["notifications"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  // Close on outside click / Escape instead of relying on a second click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  if (!user) return null;

  /** Mark a single notification read when the member actually opens it. */
  async function markRead(id: string) {
    // The error used to be discarded, so a failed update left the unread dot
    // in place with no explanation. Surface it; the mutation is retried the
    // next time the row is opened.
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Could not mark that notification as read.");
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-brass text-xs font-bold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 border border-border bg-card shadow-paper">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <Link
              to="/notifications"
              className="text-xs font-semibold underline underline-offset-4"
              onClick={() => setOpen(false)}
            >
              View all
            </Link>
          </div>
          {list.isError ? (
            <div role="alert" className="px-4 py-5 text-center">
              <p className="text-xs text-destructive">
                Notifications could not be loaded — this is not an empty inbox.
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold underline underline-offset-2"
                onClick={() => void list.refetch()}
                disabled={list.isFetching}
              >
                {list.isFetching ? "Retrying…" : "Retry"}
              </button>
            </div>
          ) : list.isPending ? (
            <div className="divide-y divide-border" aria-busy="true">
              <span className="sr-only">Loading notifications…</span>
              {[0, 1, 2].map((n) => (
                <div key={n} className="px-4 py-3">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="mt-2 h-3 w-56" />
                </div>
              ))}
            </div>
          ) : !items.length ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing yet.</p>
          ) : (
            items.slice(0, 5).map((n) => (
              <Link
                key={n.id}
                to={notificationDestination(n.link)}
                className="block border-b border-border px-4 py-3 last:border-0 hover:bg-secondary/40"
                onClick={() => {
                  setOpen(false);
                  if (!n.read_at) void markRead(n.id);
                }}
              >
                <p className="text-sm font-semibold">{n.title}</p>
                {n.body && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Ringing banner: if a call has me listed as callee and is still ringing,
// offer one-click Accept anywhere in the authenticated shell. Accept just
function playRingtonePulse() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";
    osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc2.frequency.setValueAtTime(659.25, ctx.currentTime); // E5

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.4);
    osc2.stop(ctx.currentTime + 0.4);

    const osc3 = ctx.createOscillator();
    const osc4 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc3.type = "sine";
    osc4.type = "sine";
    osc3.frequency.setValueAtTime(523.25, ctx.currentTime + 0.18);
    osc4.frequency.setValueAtTime(783.99, ctx.currentTime + 0.18); // G5

    gain2.gain.setValueAtTime(0.001, ctx.currentTime + 0.18);
    gain2.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.23);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

    osc3.connect(gain2);
    osc4.connect(gain2);
    gain2.connect(ctx.destination);

    osc3.start(ctx.currentTime + 0.18);
    osc4.start(ctx.currentTime + 0.18);
    osc3.stop(ctx.currentTime + 0.65);
    osc4.stop(ctx.currentTime + 0.65);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Autoplay restrictions or browser audio context policies
  }
}

// routes to the call screen — all media/signalling state lives there alone.
export function IncomingCallBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const ringing = useQuery({
    queryKey: ["call-ringing"],
    enabled: !!user,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from("calls")
        .select("id, conversation_id, caller_id, started_at")
        .eq("callee_id", u.user.id)
        .eq("status", "ringing")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const isRinging = !!(user && ringing.data);

  useEffect(() => {
    if (!isRinging) return;

    playRingtonePulse();
    const audioTimer = setInterval(() => {
      playRingtonePulse();
    }, 2800);

    const originalTitle = document.title;
    let alertToggle = false;
    const titleTimer = setInterval(() => {
      alertToggle = !alertToggle;
      document.title = alertToggle ? "🔔 Incoming Call… — The Merit Circle" : originalTitle;
    }, 1200);

    return () => {
      clearInterval(audioTimer);
      clearInterval(titleTimer);
      document.title = originalTitle;
    };
  }, [isRinging]);

  // The RLS SELECT policy already guarantees only my rows are visible, and
  // polls stop the instant the call goes answered/ended.

  if (!user || !ringing.data) return null;

  async function decline() {
    await supabase
      .from("calls")
      .update({ status: "ended", ended_at: new Date().toISOString(), decline_reason: "declined" })
      .eq("id", ringing.data!.id);
    void ringing.refetch();
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-0 z-[60] mx-auto mb-4 w-[min(92vw,28rem)] border border-brass bg-card p-4 shadow-paper"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-brass/15 text-brass">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brass/25" />
          <Video className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Incoming video introduction</p>
          <p className="truncate text-xs text-muted-foreground">
            A verified member you accepted is calling you.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          onClick={() => navigate({ to: "/call/$callId", params: { callId: ringing.data!.id } })}
        >
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={() => void decline()}>
          Decline
        </Button>
      </div>
    </div>
  );
}

// Ringing banner: see IncomingCallBanner above.
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMyProfile();
  const nav = user ? (me.data?.is_admin ? adminNav : memberNav) : publicNav;
  /**
   * Split the nav for the inline row. Five daily destinations stay visible —
   * checked at 1280px and above — and the rest go behind "More", so the bell,
   * email and Sign out keep their place on the row.
   */
  const inline = ["Home", "Search", "Introductions", "Messages", "Calls"];
  // Public nav is short — show it all inline; only members get "More".
  const primaryNav: NavItem[] = user
    ? nav.filter((i): i is NavItem => inline.includes(i.label))
    : [...nav];
  const overflowNav: NavItem[] = user
    ? nav.filter((i): i is NavItem => !inline.includes(i.label))
    : [];

  const mobileAvatar = useUserAvatar(me.data?.photo_path);
  const mobileDisplayName = me.data?.full_name?.trim() || user?.email?.split("@")[0] || "Member";
  const mobileInitials = me.data?.full_name?.trim()
    ? me.data.full_name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join("")
    : (user?.email?.[0]?.toUpperCase() ?? "M");

  async function signOut() {
    setOpen(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      <div className="mx-auto grid h-18 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 md:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-3" onClick={() => setOpen(false)}>
          <span className="grid size-9 shrink-0 place-items-center border border-primary bg-primary text-primary-foreground">
            <Landmark className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-serif text-xl font-semibold leading-none text-foreground">
              The Merit Circle
            </span>
            <span className="mt-1 block truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {SITE_TAGLINE}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary navigation">
          {primaryNav.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              {...("hash" in item ? { hash: item.hash } : {})}
              activeOptions={{
                exact: item.to === "/" && !("hash" in item),
                includeHash: "hash" in item,
              }}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              {item.label}
            </Link>
          ))}
          {overflowNav.length > 0 && <NavMenu label="More" items={overflowNav} />}
          {!loading &&
            (user ? (
              <div className="flex items-center gap-3">
                <NotificationBell />
                <UserNavMenu user={user} profile={me.data} onSignOut={signOut} />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link to="/auth" className="text-sm font-medium text-foreground">
                  Sign in
                </Link>
                <Button asChild size="lg">
                  <Link to="/auth" search={{ mode: "signup" }}>
                    Become a member <ArrowUpRight />
                  </Link>
                </Button>
              </div>
            ))}
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          {!loading && user && (
            <>
              <NotificationBell />
              <UserNavMenu user={user} profile={me.data} onSignOut={signOut} />
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {open && (
        <nav
          id="mobile-nav"
          className="border-t border-border bg-background px-5 py-4 md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="mx-auto grid max-w-7xl gap-1">
            {!loading && user && (
              <div className="mb-2 flex items-center gap-3 border-b border-border pb-3">
                <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary shadow-sm">
                  {mobileAvatar.data ? (
                    <img
                      src={mobileAvatar.data}
                      alt={mobileDisplayName}
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="font-serif text-sm font-semibold text-foreground">
                      {mobileInitials}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-sm font-semibold text-foreground">
                    {mobileDisplayName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={user.email ?? ""}>
                    {user.email}
                  </p>
                </div>
              </div>
            )}
            {nav.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                {...("hash" in item ? { hash: item.hash } : {})}
                className="border-b border-border py-3 text-sm font-medium"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            {!loading &&
              (user ? (
                <button
                  type="button"
                  onClick={signOut}
                  className="flex items-center gap-2 py-3 text-left text-sm font-medium text-destructive transition-colors hover:opacity-85"
                >
                  <LogOut className="size-4" /> Sign out
                </button>
              ) : (
                <>
                  <Link
                    to="/auth"
                    search={{ mode: "signin" }}
                    className="border-b border-border py-3 text-sm font-medium"
                    onClick={() => setOpen(false)}
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/auth"
                    search={{ mode: "signup" }}
                    className="py-3 text-sm font-semibold"
                    onClick={() => setOpen(false)}
                  >
                    Become a member
                  </Link>
                </>
              ))}
          </div>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-5 py-12 md:px-8 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr]">
          <div className="max-w-md">
            <div className="flex items-center gap-3 font-serif text-2xl">
              <Landmark className="size-5 text-brass" /> The Merit Circle
            </div>
            <p className="mt-5 text-sm leading-7 text-primary-foreground/65">
              {SITE_TAGLINE}—candidate-led, family co-piloted, with zero public profiles.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-brass">
              <ShieldCheck className="size-4" /> Identity and institution verified
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-brass">
              Membership
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-primary-foreground/70">
              <li>
                <Link to="/auth" className="hover:text-primary-foreground">
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/apply" className="hover:text-primary-foreground">
                  Application
                </Link>
              </li>
              <li>
                <Link to="/members" className="hover:text-primary-foreground">
                  Member search
                </Link>
              </li>
              <li>
                <Link to="/verification" className="hover:text-primary-foreground">
                  Verification
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-brass">
              Legal & care
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-primary-foreground/70">
              <li>
                <Link to="/privacy" className="hover:text-primary-foreground">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-primary-foreground">
                  Terms of membership
                </Link>
              </li>
              <li>
                <Link to="/standards" className="hover:text-primary-foreground">
                  Community standards
                </Link>
              </li>
              <li>
                <Link to="/grievance" className="hover:text-primary-foreground">
                  Grievance redressal
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 grid gap-3 border-t border-primary-foreground/15 pt-6 text-xs leading-5 text-primary-foreground/70 md:grid-cols-[1fr_auto]">
          <p>
            Operated in accordance with the Information Technology Act, 2000 and applicable Indian
            data protection law.
          </p>
          <p>
            Grievance Officer:{" "}
            <Link
              to="/grievance"
              className="underline underline-offset-2 hover:text-primary-foreground"
            >
              {GRIEVANCE_OFFICER.published
                ? `${GRIEVANCE_OFFICER.officer} · ${GRIEVANCE_OFFICER.email}`
                : "Details to be published before launch (placeholder)"}
            </Link>
          </p>
        </div>
        <div className="mt-5 flex flex-wrap justify-between gap-3 text-xs text-primary-foreground/60">
          <span>© 2026 The Merit Circle Private Limited</span>
          <span>New Delhi · Bengaluru · Mumbai</span>
        </div>
      </div>
    </footer>
  );
}
