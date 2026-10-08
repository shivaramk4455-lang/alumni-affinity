import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BadgeCheck, Clock3, FileCheck2, Mail, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhotoGalleryManager } from "@/components/photo-gallery";
import { supabase } from "@/integrations/supabase/client";

import type { Database } from "@/integrations/supabase/types";
import { MY_PROFILE_KEY, useMyProfile } from "@/hooks/use-my-profile";
import { compressPhotograph, formatErrorMessage } from "@/lib/gallery";
import { recordConsent } from "@/lib/consent";
import {
  PHOTO_VISIBILITY,
  canSubmitForReview,
  isRecognisedAlumniEmail,
  verificationLabel,
} from "@/lib/profile-options";

export const Route = createFileRoute("/_authenticated/verification")({
  head: () => ({
    meta: [
      { title: "Verification — The Merit Circle" },
      {
        name: "description",
        content: "Confirm your institution, manage your photograph and privacy settings.",
      },
      { property: "og:title", content: "Verification — The Merit Circle" },
      {
        property: "og:description",
        content: "Institutional verification and photograph privacy controls.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Verification,
});

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";

function Verification() {
  const qc = useQueryClient();
  const [alumniEmail, setAlumniEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [seeded, setSeeded] = useState(false);

  const me = useMyProfile();

  useEffect(() => {
    if (me.data && !seeded) {
      setSeeded(true);
      setAlumniEmail(me.data.alumni_email ?? "");
      setPhone(me.data.contact_phone ?? "");
      setLinkedin(me.data.linkedin_url ?? "");
    }
  }, [me.data, seeded]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#photos") {
      setTimeout(() => {
        const el = document.getElementById("photos");
        el?.scrollIntoView({ behavior: "smooth" });
      }, 150);
    }
  }, []);

  const save = useMutation({
    mutationFn: async (patch: Database["public"]["Tables"]["profiles"]["Update"]) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("profiles").update(patch).eq("id", u.user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
    },
    onError: () => toast.error("Could not save. Please try again."),
  });

  const upload = useMutation({
    mutationFn: async ({
      file,
      bucket,
    }: {
      file: File;
      bucket: "profile-photos" | "verification-docs";
    }) => {
      const { data: u } = await supabase.auth.getUser();
      const fileToUpload = bucket === "profile-photos" ? await compressPhotograph(file) : file;
      const ext = fileToUpload.name.split(".").pop()?.toLowerCase() ?? "dat";
      const path = `${u.user!.id}/${bucket === "profile-photos" ? "portrait" : "credential"}.${ext}`;
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, fileToUpload, { upsert: true, contentType: fileToUpload.type });
      if (error) throw error;
      const patch =
        bucket === "profile-photos" ? { photo_path: path } : { verification_doc_path: path };
      const { error: e2 } = await supabase.from("profiles").update(patch).eq("id", u.user!.id);
      if (e2) throw e2;
      return bucket;
    },
    onSuccess: (bucket) => {
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      qc.invalidateQueries({ queryKey: ["photo"] });
      // Ledger entry for the two consent-bearing uploads: the member has agreed
      // to desk review of a credential, and to the on-screen viewer-identity
      // photo overlay (a visible deterrent, not a mark baked into the file).
      void recordConsent(
        bucket === "profile-photos" ? "photo_watermarking" : "document_review",
        true,
        bucket === "profile-photos"
          ? "Photograph uploaded; on-screen viewer-identity overlay acknowledged (deterrent only)"
          : "Credential document submitted to the membership desk",
      ).then((consent) => {
        if (!consent.ok) {
          toast.warning(
            "Uploaded, but the consent receipt could not be written — retry from Settings.",
            { duration: 8000 },
          );
        }
      });
      qc.invalidateQueries({ queryKey: ["consent-events"] });
      toast.success(
        bucket === "profile-photos" ? "Photograph uploaded." : "Document uploaded for review.",
      );
    },
    onError: (e) => toast.error(formatErrorMessage(e)),
  });

  const p = me.data;
  const status = verificationLabel(p?.verification_status);
  const emailOk = !!p?.alumni_email && isRecognisedAlumniEmail(p.alumni_email);

  function saveAlumniEmail() {
    const value = alumniEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error("Enter a valid email address.");
      return;
    }
    const recognised = isRecognisedAlumniEmail(value);
    save.mutate(
      { alumni_email: value },
      {
        onSuccess: () => {
          toast[recognised ? "success" : "info"](
            recognised
              ? "Institutional domain recognised — recorded for the desk."
              : "Domain not recognised. Please also upload a credential document.",
          );
        },
      },
    );
  }

  function submitForReview() {
    if (!emailOk && !p?.verification_doc_path) {
      toast.error("Add an institutional email or upload a credential document first.");
      return;
    }
    if (p?.verification_status === "pending_review") {
      toast.info("Already with the membership desk.");
      return;
    }
    if (!canSubmitForReview(p?.verification_status)) {
      toast.error("This profile cannot be submitted for review right now.");
      return;
    }
    save.mutate(
      { verification_status: "pending_review" },
      {
        onSuccess: () => toast.success("Submitted to the membership desk."),
      },
    );
  }

  if (me.isError) {
    // A failed read left the contact fields blank, which reads as "nothing on
    // file" — hide them behind an explicit error instead.
    return (
      <main className="mx-auto max-w-4xl px-5 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">Verification could not load</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your standing and contact fields could not be read, so they are hidden rather than shown
          blank. This is a connection problem, not an empty record.
        </p>
        <Button
          className="mt-8"
          size="lg"
          onClick={() => void me.refetch()}
          disabled={me.isFetching}
        >
          {me.isFetching ? "Retrying…" : "Try again"}
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-12 md:px-8 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        Membership desk
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Verification & privacy</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Credentials are reviewed privately. Documents are visible only to you and never shown to
        other members.
      </p>

      <section className="mt-9 border border-border bg-card p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-2xl font-semibold">Current standing</h2>
          <span
            className={`border px-2.5 py-1 text-xs font-semibold ${status.tone === "done" ? "border-success bg-success/10 text-success" : status.tone === "pending" ? "border-brass bg-brass/10 text-brass-strong" : "border-border bg-muted text-muted-foreground"}`}
          >
            {status.label}
          </span>
        </div>
        <div className="mt-6 grid gap-3">
          <Row
            icon={<Mail />}
            title="Institutional email"
            detail={
              p?.alumni_email
                ? `${p.alumni_email}${emailOk ? " · domain recognised" : " · domain not recognised"}`
                : "Not provided"
            }
            done={emailOk}
          />
          <Row
            icon={<FileCheck2 />}
            title="Credential document"
            detail={p?.verification_doc_path ? "Uploaded and awaiting desk review" : "Not uploaded"}
            done={!!p?.verification_doc_path}
          />
          <Row
            icon={<Clock3 />}
            title="Desk review"
            detail={
              p?.verification_status === "verified"
                ? "Complete"
                : p?.verification_status === "pending_review"
                  ? "Usually within 24 hours"
                  : "Not yet submitted"
            }
            done={p?.verification_status === "verified"}
          />
        </div>
        {p?.verification_note && (
          <p className="mt-5 border-l-2 border-brass bg-secondary/40 p-4 text-sm">
            {p.verification_note}
          </p>
        )}
        {p?.verification_status === "needs_resubmission" && (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            The desk asked for one more detail. Update your email or document above, then submit
            again.
          </p>
        )}
        {p?.verification_status !== "verified" && (
          <Button className="mt-6" onClick={submitForReview} disabled={save.isPending}>
            Submit for review
          </Button>
        )}
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Institutional email</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Use your alumni or institute address, for example name@alumni.iitb.ac.in.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label htmlFor="alumni-email" className="sr-only">
            Institutional email address
          </label>
          <Input
            id="alumni-email"
            value={alumniEmail}
            onChange={(e) => setAlumniEmail(e.target.value)}
            placeholder="name@alumni.iitb.ac.in"
            inputMode="email"
            autoComplete="email"
          />
          <Button variant="outline" onClick={saveAlumniEmail} disabled={save.isPending}>
            Save email
          </Button>
        </div>
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Credential document</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Degree certificate, transcript or alumni card. PDF, JPG or PNG up to 10 MB.
        </p>
        <label className="mt-5 flex cursor-pointer items-center gap-3 border border-dashed border-border p-5 text-sm transition-colors hover:bg-secondary/60 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <Upload className="size-4 text-brass" />
          <span>
            {p?.verification_doc_path ? "Replace uploaded document" : "Choose a document"}
          </span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            // `hidden` is display:none, which drops the control out of the tab
            // order entirely — the document upload was unreachable by keyboard.
            // `sr-only` keeps it focusable, and focus-within on the label makes
            // that focus visible.
            className="sr-only"
            aria-label="Upload a credential document — PDF, JPG or PNG up to 10 MB"
            disabled={upload.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset so re-picking the same file after a failure fires again.
              e.target.value = "";
              if (f) upload.mutate({ file: f, bucket: "verification-docs" });
            }}
          />
        </label>
        {upload.isPending && (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            Uploading your document…
          </p>
        )}
      </section>

      <section id="photos" className="mt-6 border border-border bg-card p-6 md:p-8 scroll-mt-24">
        <h2 className="font-serif text-2xl font-semibold">Photograph &amp; gallery</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload up to 6 photographs. Verified members see them according to your visibility
          setting; each rendered copy is stamped with the viewer’s name and the time of viewing.
          Screenshots cannot be prevented — report misuse and the membership desk will act.
        </p>
        <div className="mt-6 grid gap-6">
          <PhotoGalleryManager watermark="Your own view" name={p?.full_name ?? null} />
          <div className="grid max-w-sm gap-2">
            <label htmlFor="verify-photo-visibility" className="text-sm font-semibold">
              Who may see your photographs
            </label>
            <select
              id="verify-photo-visibility"
              className={selectCls}
              value={p?.photo_visibility ?? "accepted_only"}
              onChange={(e) => save.mutate({ photo_visibility: e.target.value })}
              aria-describedby="verify-photo-visibility-detail"
            >
              {PHOTO_VISIBILITY.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span
              id="verify-photo-visibility-detail"
              className="text-xs font-normal leading-5 text-muted-foreground"
            >
              {
                PHOTO_VISIBILITY.find((o) => o.value === (p?.photo_visibility ?? "accepted_only"))
                  ?.detail
              }
            </span>
          </div>
        </div>
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Contact coordinates</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Shared only with members whose introduction you have accepted. These are the same fields
          as on{" "}
          <Link
            to="/settings"
            className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
          >
            Settings
          </Link>
          , so edit them in one place or the other — not both.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold">
            Phone
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            LinkedIn
            <Input
              type="url"
              inputMode="url"
              autoComplete="url"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="linkedin.com/in/…"
            />
          </label>
        </div>
        <Button
          variant="outline"
          className="mt-5"
          disabled={save.isPending}
          onClick={() => {
            save.mutate(
              { contact_phone: phone.trim() || null, linkedin_url: linkedin.trim() || null },
              {
                onSuccess: () => toast.success("Contact details saved."),
              },
            );
          }}
        >
          Save contact details
        </Button>
      </section>

      <p className="mt-8 text-sm text-muted-foreground">
        Profile details such as education and city live in{" "}
        <Link
          to="/onboarding"
          className="font-semibold text-foreground underline underline-offset-4"
        >
          your profile
        </Link>
        .
      </p>
    </main>
  );
}

function Row({
  icon,
  title,
  detail,
  done,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  done: boolean;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border border-border p-4">
      <span
        className={`grid size-9 place-items-center rounded-full [&_svg]:size-4 ${done ? "bg-success/10 text-success" : "bg-brass/10 text-brass"}`}
      >
        {done ? <BadgeCheck /> : icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
