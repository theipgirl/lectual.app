import Link from "next/link";
import { currentRole } from "@/lib/auth/current-role";
import { getFirmTimeZone } from "@/lib/org/profile";
import { firmCivilDate } from "@/lib/quotes/firm-time";
import { formatDollars } from "@/lib/proposal-editor/events";
import { firstNameOf } from "@/lib/proposal-editor/labels";
import { listMemberDirectory } from "@/lib/members/directory";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { getProposalSettings, listLatestProposalEvents, listProposals, listStepActivity, type ProposalListItem, type StepActivity } from "@/lib/proposals/store";
import { PROPOSAL_PAID_ROLES } from "@/lib/proposals/paid";
import { PROPOSAL_ADMIN_ROLES, PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { normalisePackages } from "@/lib/proposals/package-list";
import { buildProposalRowView, type ProposalRowView } from "@/lib/proposals/list-rows";
import type { ActivityEvent } from "@/lib/proposals/list-labels";
import {
  PROPOSAL_SEGMENTS,
  SEGMENT_LABEL,
  inSegment,
  outWithClientsCents,
  parseSegment,
  type ProposalSegment,
} from "@/lib/proposals/segments";
import { loadConsultsStrip, type ConsultsStripData } from "@/lib/proposals/consults-load";
import { loadLeadOptions } from "@/lib/proposals/lead-options";
import { loadDraftBlock } from "@/lib/consult-proposal/draft-gate";
import { DRAFT_BLOCK_NOTE } from "@/lib/consult-proposal/draft-availability";
import { MAX_PASTED_TRANSCRIPT_CHARS } from "@/lib/consult-proposal/types";
import { TranscriptDraft } from "@/components/proposal-editor/TranscriptDraft";
import { ConsultsStrip } from "@/components/proposal-list/ConsultsStrip";
import { ProposalsTable } from "@/components/proposal-list/ProposalsTable";
import { SegmentColumn } from "@/components/proposal-list/SegmentColumn";
import { requireProposalsModule } from "./gate";
import "./proposals.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Client proposals") };

export const dynamic = "force-dynamic";

/**
 * Quotes & proposals — one row per client offer (its newest version), over a three-state
 * read: rows, empty, or "couldn't load". An unreachable database never renders as "No
 * proposals yet", an unreachable queue of proposals never as "$0.00".
 *
 * The page follows the approved design: a left column of five segments (Everything, Out with a
 * client, Drafts and blocked, Accepted, Expired; counts from the unfiltered set; `?segment=`),
 * the "Out with clients" dollar tile (the cheapest offered package's legal fee per Sent
 * proposal, never a USPTO fee), the consults strip (Zoom / Fathom imports and their next step)
 * and a seven-column table with the legal fee at signing and the USPTO fees at filing as two
 * separate figures. The statuses are the ones the firm uses, derived by `proposalDisplayStatus`.
 * An older `?status=` link is mapped onto the matching segment.
 *
 * Reads that only decorate (the newest event per proposal, member names, the settings'
 * figures) degrade on their own: a failed events read leaves every Last activity cell with a
 * derived line, and a failed settings read drops the dollar figures from the subtitle,
 * footer and note rather than inventing defaults.
 *
 * Gate: the `proposals` module (notFound when off, so one firm cannot learn what another has).
 * Reading is for the whole firm (0089's select policy is org members); starting a proposal is
 * for the staff roles, and the actions re-check that.
 */
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ segment?: string; status?: string }> }) {
  await requireProposalsModule();
  const sp = await searchParams;
  const segment: ProposalSegment = parseSegment(sp.segment) ?? parseSegment(sp.status) ?? "everything";

  const role = await currentRole();
  const canWrite = !!role && PROPOSAL_STAFF_WRITE_ROLES.includes(role);
  const canDraftFromTranscript = canWrite && CAN_WRITE_LEAD.includes(role);

  const nowDate = new Date();
  const now = nowDate.getTime();
  const [tz, listedRead, settingsRead] = await Promise.all([
    getFirmTimeZone(),
    listProposals().then(
      (rows) => ({ ok: true as const, rows }),
      () => ({ ok: false as const }),
    ),
    getProposalSettings().then(
      (row) => ({ ok: true as const, row }),
      () => ({ ok: false as const }),
    ),
  ]);
  const listed: ProposalListItem[] = listedRead.ok ? listedRead.rows : [];
  const failed = !listedRead.ok;
  const today = firmCivilDate(nowDate, tz);

  const [eventsRead, names, strip, leadsRead, draftBlock, stepRead] = await Promise.all([
    listedRead.ok && listed.length > 0 ? readEvents(listed) : Promise.resolve(new Map<string, ActivityEvent>() as ReadonlyMap<string, ActivityEvent> | "unavailable"),
    readNames(),
    loadStrip(listed, now, tz),
    canDraftFromTranscript ? loadLeadOptions() : Promise.resolve(null),
    canDraftFromTranscript ? loadDraftBlock() : Promise.resolve(null),
    readStepActivity(listed),
  ]);
  const events = withStepActivity(eventsRead, stepRead);
  const canMarkPaid = !!role && PROPOSAL_PAID_ROLES.includes(role);

  const all = listed.map((item) => ({
    item,
    view: buildProposalRowView(item, { today, tz, now, events, names, paid: stepRead === "unavailable" ? "unavailable" : new Map([...stepRead].map(([id, a]) => [id, a.paid])), canMarkPaid }),
  }));
  const counts = failed
    ? null
    : (Object.fromEntries(PROPOSAL_SEGMENTS.map((s) => [s, all.filter((r) => inSegment(s, r.view.key)).length])) as Record<ProposalSegment, number>);
  const out = outWithClientsCents(failed ? null : all.map((r) => ({ displayKey: r.view.key, offered: r.item.offered })));
  const rows: ProposalRowView[] = all.filter((r) => inSegment(segment, r.view.key)).map((r) => r.view);

  // The default package's figures, from the firm's own settings; none (never defaults) when they couldn't be read.
  const packages = settingsRead.ok ? normalisePackages(settingsRead.row?.pricing ?? {}) : null;
  const first = packages?.[0] ?? null;
  const subtitle = `${packages ? `${packages.length} published ${packages.length === 1 ? "package" : "packages"}, priced` : "Published packages, priced"} per class. Legal fees fall due at signing, USPTO fees at filing, and the two never add into one number.`;
  const note = first
    ? `Legal fees and USPTO fees never add into one number. Every class past the package adds ${formatDollars(first.per_class_cents)} legal and ${formatDollars(first.gov_per_class_cents)} government.`
    : "Legal fees and USPTO fees never add into one number.";
  const footerRight = first
    ? `Government filing fees are ${formatDollars(first.gov_per_class_cents)} per class, paid before the application goes in.`
    : "Government filing fees are paid before the application goes in.";
  const footerLeft = segment === "everything" ? `All ${all.length} proposals` : `${rows.length} of ${all.length} proposals`;

  const paste = canDraftFromTranscript
    ? draftBlock ? (
        <p className="lx-note" style={{ margin: 0 }} data-draft-block={draftBlock}>
          {DRAFT_BLOCK_NOTE[draftBlock]}
          {draftBlock === "no-settings" && (
            <>
              {" "}
              <Link href="/dashboard/settings/proposals/">Open the settings</Link>
            </>
          )}
        </p>
      ) : leadsRead?.status === "ok" ? (
        <TranscriptDraft leads={leadsRead.leads} maxChars={MAX_PASTED_TRANSCRIPT_CHARS} />
      ) : (
        <p className="lx-note" style={{ margin: 0 }}>
          The leads couldn&apos;t be loaded just now, so this form isn&apos;t offered. This is a problem reaching the database, not an empty list. Try again shortly.
        </p>
      )
    : null;

  return (
    <div className="pq-layout">
      <SegmentColumn active={segment} counts={counts} out={out} note={note} />

      <div className="pq-main">
        <div className="lx-page-head">
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 className="lx-h1" data-tour="proposals-head">Quotes &amp; proposals</h1>
            <p className="lx-sub">{subtitle}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {role && PROPOSAL_ADMIN_ROLES.includes(role) && (
              <Link href="/dashboard/settings/proposals/" className="lx-btn lx-btn-sec">
                Settings
              </Link>
            )}
            {canWrite && (
              <Link href="/dashboard/proposals/new/" className="lx-btn lx-btn-pri">
                New proposal
              </Link>
            )}
          </div>
        </div>

        <ConsultsStrip data={strip} canDraft={canDraftFromTranscript} draftNote={draftBlock ? DRAFT_BLOCK_NOTE[draftBlock] : null} paste={paste} />

        {failed ? (
          <div className="lx-card lx-empty-card">
            <h2 className="lx-h2" style={{ fontSize: 25 }}>
              Proposals couldn&apos;t be loaded
            </h2>
            <p className="lx-note" style={{ margin: 0 }}>
              This is a problem reaching the database, not an empty list. Try again shortly.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="lx-card lx-empty-card">
            <h2 className="lx-h2" style={{ fontSize: 25 }}>
              {all.length === 0 ? "No proposals yet" : "Nothing matches"}
            </h2>
            <p className="lx-note" style={{ margin: 0 }}>
              {all.length === 0
                ? canWrite
                  ? "Start one from a consult above, a lead, or with New proposal. It stays a draft until a named approver approves it."
                  : "When one is started it will be listed here."
                : `Nothing is under ${SEGMENT_LABEL[segment]}. Every proposal is still under Everything.`}
            </p>
          </div>
        ) : (
          <ProposalsTable rows={rows} footerLeft={footerLeft} footerRight={footerRight} />
        )}
      </div>
    </div>
  );
}

/** The newest event per proposal; "unavailable" when the read fails, so every cell falls back to a derived line. */
async function readEvents(listed: ProposalListItem[]): Promise<ReadonlyMap<string, ActivityEvent> | "unavailable"> {
  try {
    return await listLatestProposalEvents(listed.map((r) => r.id));
  } catch {
    return "unavailable";
  }
}

/** Each accepted row's paid state and newest step event; "unavailable" when that read fails, so no row reads "Not paid" on a guess. */
async function readStepActivity(listed: ProposalListItem[]): Promise<ReadonlyMap<string, StepActivity> | "unavailable"> {
  const accepted = listed.filter((r) => r.status === "accepted").map((r) => r.id);
  if (accepted.length === 0) return new Map();
  try {
    return await listStepActivity(accepted);
  } catch {
    return "unavailable";
  }
}

/**
 * An accepted row's Last activity names what a teammate did after the acceptance ("Marked paid"):
 * its newest step event, with the payload the plain events read leaves out, replaces the plain one.
 */
function withStepActivity(
  events: ReadonlyMap<string, ActivityEvent> | "unavailable",
  steps: ReadonlyMap<string, StepActivity> | "unavailable",
): ReadonlyMap<string, ActivityEvent> | "unavailable" {
  if (events === "unavailable" || steps === "unavailable") return events;
  const merged = new Map(events);
  for (const [id, a] of steps) {
    if (a.newest && a.newest.actor === "staff") {
      merged.set(id, { type: "edited", actor: a.newest.actor, actor_user_id: a.newest.actor_user_id, created_at: a.newest.created_at, payload: a.newest.payload });
    }
  }
  return merged;
}

/** user id -> a first name, for "Edited 3h ago · Taylor". Best effort: a failed read drops names, never shows ids. */
async function readNames(): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>();
  try {
    for (const m of await listMemberDirectory()) {
      const name = firstNameOf(m.displayName) ?? firstNameOf(m.email);
      if (name) out.set(m.userId, name);
    }
  } catch {
    /* names are cosmetic */
  }
  return out;
}

/** The consults strip's data. Never throws: an unexpected failure is the strip's own "couldn't load". */
async function loadStrip(listed: ProposalListItem[], now: number, tz: string): Promise<ConsultsStripData> {
  try {
    return await loadConsultsStrip({
      now,
      tz,
      proposals: listed.map((r) => ({ id: r.id, leadId: r.lead_id, createdAt: r.created_at, source: r.source })),
    });
  } catch {
    return { header: { title: "Consults", status: { kind: "unavailable", text: "connection status couldn't be loaded" } }, meetings: { status: "unavailable" } };
  }
}
