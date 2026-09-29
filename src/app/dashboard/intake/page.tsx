import { listStages, type Stage } from "@/lib/pipeline";
import type { Lead } from "@/lib/pipeline";
import { listIntakeLeads } from "@/lib/intake/leads";
import { intakeStages } from "@/lib/intake/scope";
import { leadActivitySince, type Activity } from "@/lib/matters";
import { listMemberDirectory, type MemberIdentity } from "@/lib/members/directory";
import { listForLeads, runningForMe } from "@/lib/time/entries";
import { notifyTimeRunning } from "@/lib/notifications/producers";
import { buildIntakeTime, startOfWeek, type IntakeTime } from "@/lib/time";
import {
  buildIntakeRows,
  parseIntakeFilters,
  parseIntakeViewState,
  type IntakeSearchParams,
} from "@/lib/intake/rows";
import { IntakeTopBar } from "@/components/intake/IntakeTopBar";
import IntakeWorkspace from "./_components/IntakeWorkspace";
import "./intake.css";

export const dynamic = "force-dynamic";

/** How far back the "latest note" lookup reaches. */
const NOTE_LOOKBACK_DAYS = 180;

/** Timeline types whose payload carries something worth showing as a next step. */
const NOTE_ACTIVITY_TYPES = new Set(["note", "call_logged", "email_sent", "voice_note"]);

/**
 * Pulls a one-line summary out of an activity payload. The key differs by type
 * (addLeadNote writes `note`, logged calls write `summary`, logged emails write
 * `subject`) — see src/lib/pipeline/notes.ts.
 */
function noteTextOf(activity: Activity): string | null {
  const payload = (activity.payload ?? {}) as Record<string, unknown>;
  for (const key of ["note", "summary", "subject", "transcript", "notes"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * lead id → newest note text. `activities` arrives newest-first from
 * leadActivitySince, so the first hit per lead is the latest one.
 */
function latestNotesByLead(activities: Activity[]): Record<string, string> {
  const byLead: Record<string, string> = {};
  for (const activity of activities) {
    const leadId = activity.lead_id;
    if (!leadId || byLead[leadId]) continue;
    if (!NOTE_ACTIVITY_TYPES.has(activity.type)) continue;
    const text = noteTextOf(activity);
    if (text) byLead[leadId] = text;
  }
  return byLead;
}

/** A card in the canvas tokens — the error and no-stages states both use it. */
function IntakeNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="intake-card" style={{ padding: 26, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 className="intake-serif" style={{ margin: 0, fontSize: 26, lineHeight: 1.1 }}>
        {title}
      </h2>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--ink2)", maxWidth: "68ch" }}>
        {body}
      </p>
    </div>
  );
}

/**
 * The intake list (blueprint §11, canvas 10a–10c) — everyone who is in the
 * pipeline but is not yet a client, as one filterable list a firm can read as
 * a table, a board by stage, or a board by owner.
 *
 * All data fetching stays in this server component. `listStages()` /
 * `listIntakeLeads()` / `listMemberDirectory()` / `leadActivitySince()` are
 * RLS-scoped through the forced-scoped client, so the rows are exactly what the
 * signed-in caller's active org may see, and the stage set is whatever
 * `crm_stage` holds for that firm — never a hardcoded pipeline.
 *
 * THREE-STATE, not two (AGENTS.md): a failed lead read renders the error card.
 * "Nobody is in intake" is only ever printed when the query genuinely came back
 * empty. Telling a firm their Monday queue is clear while the read is broken is
 * the single worst thing this page could do.
 *
 * Ported from lectual src/app/(intake)/intake/page.tsx; in lectual.app it
 * replaces the Leads list and renders inside the app shell.
 */
export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<IntakeSearchParams>;
}) {
  // Next 16: searchParams is a Promise and must be awaited before it is read.
  const params = await searchParams;
  const filters = parseIntakeFilters(params);
  const viewState = parseIntakeViewState(params);

  // One clock for the whole render: the note window, every derived number, and
  // the client's own re-derivations after an optimistic write all read the same
  // instant, so the top-bar line can never disagree with the row it counts.
  const now = new Date();

  // Best-effort, started (not awaited) here so it runs alongside the reads
  // below; the `.catch` is attached immediately so a rejection is never an
  // unhandled one. An unresolved directory costs owner NAMES, not owner data —
  // the row still shows whether someone is assigned — which is a much smaller
  // failure than a dead page.
  const membersPromise: Promise<MemberIdentity[]> = listMemberDirectory().catch(() => []);

  const sinceIso = new Date(now.getTime() - NOTE_LOOKBACK_DAYS * 86_400_000).toISOString();
  // Same best-effort treatment: "Next step" degrades from the latest note to
  // the factual reply state rather than taking the list down.
  const notesPromise: Promise<Activity[]> = leadActivitySince(sinceIso).catch(() => []);

  let stages: Stage[] = [];
  let leads: Lead[] = [];
  let loadError: string | null = null;

  // Stages and leads share one try: intake scope is derived FROM the stages, so
  // without them there is no honest list to draw — only a misleading one.
  try {
    stages = await listStages();
    leads = await listIntakeLeads(stages);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const [members, noteActivity] = await Promise.all([membersPromise, notesPromise]);

  if (loadError) {
    return (
      <div className="intake-root">
        <IntakeTopBar eyebrow="Intake">Couldn&apos;t reach the list</IntakeTopBar>
        <div className="intake-content">
          <IntakeNotice
            title="Couldn't load intake"
            body={`This is a broken read, not an empty pipeline — there may well be leads waiting. ${loadError}`}
          />
        </div>
      </div>
    );
  }

  const columns = intakeStages(stages)
    .slice()
    .sort((a, b) => a.order_index - b.order_index);

  if (columns.length === 0) {
    return (
      <div className="intake-root">
        <IntakeTopBar eyebrow="Intake">No intake stages</IntakeTopBar>
        <div className="intake-content">
          <IntakeNotice
            title="No intake stages yet"
            body="This firm has no pre-conversion stage configured, so there is nothing for a lead to sit in. An owner or admin can set the pipeline up in Settings, and everyone in those stages shows up here."
          />
        </div>
      </div>
    );
  }

  // Time on cards (§13.1). Two reads: this week's entries for the leads on
  // screen, and the caller's own open timer (which may have started before the
  // week began, so it is fetched separately rather than assumed to be in the
  // window).
  //
  // Best-effort, but with an EXPLICIT unknown rather than a silent zero: a
  // failure leaves `time` null and every chip renders an em dash. "0m" over a
  // broken read would tell the firm nobody has touched a lead all week when
  // somebody has — the same three-state rule the queue taught us (AGENTS.md).
  const leadNames: Record<string, string> = {};
  for (const lead of leads) {
    leadNames[lead.id] = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
  }
  let time: IntakeTime | null = null;
  try {
    const [entries, running] = await Promise.all([
      listForLeads(
        leads.map((lead) => lead.id),
        startOfWeek(now),
      ),
      runningForMe(),
    ]);
    time = buildIntakeTime({ entries, running, now, leadNames });

    // §13.3's 8-hour stale-timer nudge, "checked on page load, no cron".
    // The running row is already in hand from the chip's own read, so this
    // costs no extra query. The producer never throws and dedupes on
    // entry_id, so refreshing this page cannot raise a second nudge for the
    // same timer — and it nudges the entry's OWNER, who on this path is the
    // caller, so one person's refresh never rings somebody else's bell.
    if (running) await notifyTimeRunning([running], now);
  } catch {
    time = null;
  }

  const rows = buildIntakeRows({
    leads,
    stages,
    members,
    latestNoteByLeadId: latestNotesByLead(noteActivity),
    now,
  });

  return (
    <div className="intake-root">
    <IntakeWorkspace
      rows={rows}
      stages={stages}
      intakeStages={columns}
      members={members}
      initialFilters={filters}
      initialViewState={viewState}
      time={time}
      now={now.toISOString()}
    />
    </div>
  );
}
