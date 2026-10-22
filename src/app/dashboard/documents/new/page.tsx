import Link from "next/link";
import { redirect } from "next/navigation";
import { listMatters } from "@/lib/matters";
import { isOpenMatter, matterLabel } from "@/lib/matters/docket-summary";
import { getLead, listLeads } from "@/lib/pipeline";
import { leadOptionLabel } from "@/lib/proposals/lead-label";
import { pickerHref, proposalLeadRecord, proposalMatterRecord, type ListRead } from "@/lib/proposals/new-picker";
import { buildLetterPicker, letterKind, NEW_LETTER_PATH, routeLead, type LeadMatter } from "@/lib/documents/new-picker";
import { normalizeTerm } from "@/lib/skills/pick";
import type { RecordKind } from "@/lib/skills/catalog";
import { WhoIsThisFor } from "@/components/proposal-editor/WhoIsThisFor";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("New letter") };

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

type Search = { lead?: string | string[]; kind?: string | string[]; q?: string | string[] };

/** A list read, in the states it can end in. A failed read is never an empty list. Matters are the open ones, as before. */
async function readRecords(kind: RecordKind): Promise<ListRead> {
  try {
    const records =
      kind === "lead" ? (await listLeads()).map(proposalLeadRecord) : (await listMatters()).filter(isOpenMatter).map(proposalMatterRecord);
    return { status: "ok", records };
  } catch {
    return { status: "failed" };
  }
}

/** The lead's own open matters, through the caller's scoped client. */
async function readLeadMatters(leadId: string): Promise<{ status: "ok"; open: LeadMatter[] } | { status: "failed" }> {
  try {
    const matters = (await listMatters({ leadId })).filter(isOpenMatter);
    return {
      status: "ok",
      open: matters.map((m) => ({ id: m.id, label: matterLabel(m), detail: [m.matter_number, m.owner_name].filter(Boolean).join(" · ") || null })),
    };
  } catch {
    return { status: "failed" };
  }
}

/**
 * New letter. "Who is this for?" is New proposal's picker (Leads | Matters, search, the 8 most recent, "Showing
 * N of M"). A matter goes to its template choice; a lead goes to `?lead=<id>`, which finds that lead's open
 * matters: one goes straight to its template choice, several are listed, none says to open a matter first.
 * The Document Center module gate is the segment layout's, unchanged.
 */
export default async function NewLetterPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const term = normalizeTerm(params.q);
  const leadRaw = first(params.lead);

  // A lead was chosen: find its matter. redirect() throws, so it stays outside any try.
  let leadNote: string | null = null;
  let leadView: { label: string; body: ReturnType<typeof routeLead> } | null = null;
  if (leadRaw) {
    if (!UUID.test(leadRaw)) leadNote = "That lead link isn't valid.";
    else {
      let lead: Awaited<ReturnType<typeof getLead>> = null;
      let leadFailed = false;
      try {
        lead = await getLead(leadRaw);
      } catch {
        leadFailed = true;
      }
      if (leadFailed) leadNote = "That lead couldn't be loaded just now.";
      else if (!lead) leadNote = "That lead couldn't be found.";
      else {
        const label = leadOptionLabel(lead);
        const body = routeLead({ leadId: lead.id, leadLabel: label, matters: await readLeadMatters(lead.id) });
        if (body.kind === "redirect") redirect(body.href);
        leadView = { label, body };
      }
    }
  }

  const kind = leadView ? "lead" : letterKind(params.kind);
  const [leads, matters] = leadView ? [null, null] : await Promise.all([readRecords("lead"), readRecords("matter")]);
  const view = leads && matters ? buildLetterPicker({ kind, term, leads, matters }) : null;

  return (
    <>
      <Link href="/dashboard/documents/" className="lx-back">
        ← Documents
      </Link>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Document Center</div>
          <h1 className="lx-h1">New letter</h1>
          <p className="lx-sub">Choose who it is for. Every letter is drafted into the approval queue; the file is made once an attorney approves it.</p>
        </div>
      </div>
      {leadNote && (
        <p className="lx-note" role="alert">
          {leadNote}
        </p>
      )}
      <WhoIsThisFor
        view={view}
        chosen={leadView ? { kind: "chosen", label: leadView.label, changeHref: pickerHref("lead", term, NEW_LETTER_PATH) } : null}
        basePath={NEW_LETTER_PATH}
        intro="Pick a matter, or a lead to find its matter. Letters are drafted on a matter."
      />
      {leadView?.body.kind === "none" && (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {leadView.body.message}
          </h2>
          <p style={{ margin: 0 }}>
            <Link href={leadView.body.leadHref}>Open {leadView.label}</Link>
          </p>
        </div>
      )}
      {leadView?.body.kind === "failed" && (
        <div role="alert" className="lx-banner lx-banner-risk">
          {leadView.body.message}
        </div>
      )}
      {leadView?.body.kind === "choose" && (
        <section className="lx-card" aria-label={`Open matters for ${leadView.label}`}>
          <p className="lx-note">{leadView.label} has more than one open matter. Which is the letter for?</p>
          <ul className="lx-list">
            {leadView.body.matters.map((m) => (
              <li key={m.id}>
                <Link href={m.href}>{m.label}</Link>
                {m.detail && <span className="lx-note"> · {m.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
