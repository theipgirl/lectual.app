import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { readPublicIntake } from "@/lib/intake-forms/public";
import { refererHost } from "@/lib/intake-forms/spam";
import { renderStamp } from "@/lib/intake-forms/secrets";
import { PublicIntake } from "./_components/PublicIntake";
import { IntakeNotice } from "./_components/IntakeShell";
import "../intake-public.css";

/**
 * `/i/<slug>` — a firm's public intake. No login: the published slug of a
 * LIVE form is the whole key. Outside `/dashboard`, so nothing of the firm
 * workspace (session, rail, queue) runs or hints at itself here.
 *
 * All database access is in src/lib/intake-forms/public.ts (service role,
 * exact slug, explicit columns, every write fenced on the form's own org).
 * Read that file's header before changing anything here.
 *
 *  - not live / unknown / malformed → `notFound()`, all identical.
 *  - unconfigured / unavailable     → a "can't load" notice, never a 404:
 *    telling a prospect the firm has no intake because we couldn't reach the
 *    database would be the wrong answer.
 *  - live → `publicConfig()` and the visible fee packages, nothing else.
 *
 * Who may FRAME this page (`?embed=1`, public/embed.js) is decided by the
 * proxy's `frame-ancestors` header from the form's allowed domains.
 */
export const dynamic = "force-dynamic";

const read = cache((slug: string) => readPublicIntake(slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await read(slug);
  return {
    title: r.status === "ok" ? `${r.view.firmName} · Intake` : "Intake",
    description: r.status === "ok" ? r.view.headline : undefined,
    // An intake is a form, not content: keep it out of search results.
    robots: { index: false, follow: false },
  };
}

export default async function PublicIntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ embed?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const r = await read(slug);
  if (r.status === "not_found") notFound();
  if (r.status !== "ok") {
    return (
      <IntakeNotice
        title="We can't load this intake right now"
        body="The link is fine. Something on our side isn't responding. Please try again in a few minutes. Nothing has been sent."
      />
    );
  }

  // The stamp carries the render time (minimum fill time) and where the
  // visitor came from (source_host). A Referer from this app itself — a
  // reload, the Preview button — is not a source.
  const h = await headers();
  const own = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
  const from = refererHost(h.get("referer"));
  const stamp = renderStamp(r.handle.formId, from && from !== own ? from : null);

  return (
    <PublicIntake
      slug={r.handle.slug}
      view={r.view}
      packages={r.packages}
      stamp={stamp}
      embed={sp.embed === "1"}
    />
  );
}
