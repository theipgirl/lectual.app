import { isTrademarkIntake } from "@/lib/intake/scope";
import { namesMatch } from "@/lib/intake/email-match";
import { SHEET_PRACTICE_AREA, splitOwnerName } from "@/lib/intake/sheet-import";
import { describeSections, type SheetContact } from "@/lib/intake/sheet-sections";
import type { SheetEntry, SheetRead } from "@/lib/intake/sheet-read";
import { notesKey } from "@/lib/lawmatics/notes-key";
import type { NotesRead, NotesTarget, RecordNotes } from "@/lib/lawmatics/notes";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";
import { resolveStage } from "@/lib/lawmatics/stage-map";
import { emailSignalFor, type AgentEvidence, type StoredMail } from "./email";
import { collapseEvidence, lastTouchOf, lawmaticsEvidence, mailEvidence, sheetNoteEvidence } from "./evidence";
import { indexLawmatics, isHiredStage, lawmaticsSignalFor, matchLawmatics, type LawmaticsIndex } from "./lawmatics";
import {
  MAX_PEOPLE_PER_PREVIEW,
  MAILBOX_REASONS,
  searchableAddress,
  type MailboxSearch,
} from "./mailbox-search";
import type { MilestoneMapping } from "./milestones";
import { isAlreadyThere, proposeStage } from "./propose";
import { matchSheetToLeads, sheetSignalFor } from "./sheet-match";
import type {
  Confidence,
  CreateLeadCandidate,
  EmailState,
  EvidenceItem,
  LawmaticsState,
  LeadRow,
  MailboxSearchState,
  NotInLectualItem,
  NotesState,
  PlanRow,
  ReconcileRow,
  ReconcileView,
  SourceSignal,
  StageOpt,
} from "./types";

/**
 * Builds the table the screen shows, from what the readers returned. Pure apart from the three reads it
 * is handed (mail, Lawmatics notes, the mailbox search).
 *
 * One row per lead in intake scope (a stage before the first "won" stage, trademark or unset
 * practice area) plus any lead the sheet matched, wherever it sits. A source that could not be read
 * is carried as "unavailable" on every row: it is never turned into "none". People the sources know
 * and the app does not are listed under "Not in Lectual yet" and never created from here.
 */

export type LawmaticsInput =
  | { status: "ok"; records: LawmaticsSourceRecord[] }
  | { status: "not-connected"; reason: string }
  | { status: "unavailable"; reason: string };

export type EmailInput =
  | { status: "ok"; byLead: Map<string, StoredMail[]>; total: number; agent?: Map<string, AgentEvidence[]> }
  | { status: "unavailable"; reason: string };

/** Most people listed under "Not in Lectual yet" from Lawmatics; the total is still counted. */
export const NOT_IN_LECTUAL_CAP = 100;

export type PlanInput = {
  fileName: string;
  stages: readonly StageOpt[];
  leads: readonly LeadRow[];
  leadsTruncated: boolean;
  sheet: SheetRead;
  lawmatics: LawmaticsInput;
  /** Reads mail for the leads on the table, which this function chooses; so it is asked for them. */
  readEmail: (leadIds: string[]) => Promise<EmailInput>;
  /** The firm brain's milestone-to-stage entries (empty means "use the default names"). */
  mapping?: MilestoneMapping;
  mappingNote?: string | null;
  /** Reads Lawmatics notes for the people this function chooses. Absent: notes are "not read". */
  readLawmaticsNotes?: (targets: NotesTarget[]) => Promise<NotesRead>;
  /** Searches the firm's mailboxes for one address. Absent: the mailbox search is "not run". */
  searchMail?: (address: string) => Promise<MailboxSearch>;
  now?: Date;
};

/** Stage ids that count as intake: open or nurture stages before the first "won" stage. */
export function intakeStageIdSet(stages: readonly StageOpt[]): Set<string> {
  const won = stages.filter((s) => s.category === "won").map((s) => s.orderIndex);
  const firstWon = won.length > 0 ? Math.min(...won) : null;
  return new Set(
    stages
      .filter((s) => (s.category === "open" || s.category === "nurture") && (firstWon === null || s.orderIndex < firstWon))
      .map((s) => s.id),
  );
}

/** The leads on the table: intake scope, plus any lead the sheet matched. */
export function tableLeads(
  stages: readonly StageOpt[],
  leads: readonly LeadRow[],
  matched: ReadonlySet<string>,
): LeadRow[] {
  const intake = intakeStageIdSet(stages);
  return leads.filter(
    (l) => matched.has(l.id) || (intake.has(l.currentStageId) && isTrademarkIntake({ practice_area: l.practiceArea })),
  );
}

/** The firm's first open stage: where a person is filed when nothing says better. */
export function firstOpenStage(stages: readonly StageOpt[]): StageOpt | null {
  return [...stages].filter((s) => s.category === "open").sort((a, b) => a.orderIndex - b.orderIndex)[0] ?? null;
}

function leadName(lead: LeadRow): string {
  return `${lead.firstName} ${lead.lastName}`.trim() || lead.email || "(no name)";
}

function rank(row: ReconcileRow): number {
  const { kind, confidence } = row.proposal;
  if (kind === "stage") return confidence === "agree" ? 0 : confidence === "sheet_only" || confidence === "single_source" ? 1 : 2;
  if (kind === "needs_matter") return 3;
  return confidence === "no_evidence" ? 5 : 4;
}

const unavailable = (reason: string): SourceSignal => ({ kind: "unavailable", reason });

/** The one address on a contact list that belongs to this name; two different addresses means none. */
export function contactEmailFor(name: string, contacts: readonly SheetContact[]): string | null {
  const addresses = new Set(contacts.filter((c) => namesMatch(name, c.name)).map((c) => c.email));
  return addresses.size === 1 ? [...addresses][0] : null;
}

type Reads = { notes: NotesRead | null; notesFailed: string | null; mail: Map<string, MailboxSearch>; capped: Set<string> };

const NOT_RUN: MailboxSearchState = { status: "unavailable", code: "not-run", reason: MAILBOX_REASONS.notRun };

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export async function buildPlan(input: PlanInput): Promise<{ view: ReconcileView; plan: PlanRow[] }> {
  const { stages, leads, sheet } = input;
  const now = input.now ?? new Date();
  const mapping = input.mapping ?? {};
  const ctx = { stages, mapping, now };
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const contacts = sheet.contacts ?? [];

  const match = matchSheetToLeads(
    sheet.entries,
    leads.map((l) => ({ id: l.id, sheetKey: l.sheetKey })),
  );
  const onTable = tableLeads(stages, leads, new Set(match.byLead.keys()));

  const email = onTable.length > 0 ? await input.readEmail(onTable.map((l) => l.id)) : ({ status: "ok", byLead: new Map(), total: 0 } as EmailInput);
  const lawmaticsIndex = input.lawmatics.status === "ok" ? indexLawmatics(input.lawmatics.records) : null;

  // Who the Lawmatics records belong to: a lead (by id or email), or nobody yet.
  const claimedRecords = new Set<string>();
  const recordOf = new Map<string, LawmaticsSourceRecord>();
  if (lawmaticsIndex) {
    for (const lead of leads) {
      const m = matchLawmatics({ lawmaticsId: lead.lawmaticsId, email: lead.email }, lawmaticsIndex);
      if (m.kind === "record") {
        claimedRecords.add(m.record.lawmaticsId);
        recordOf.set(lead.id, m.record);
      }
    }
  }

  // The sheet rows with no lead, and the Lawmatics records with no lead and no sheet row to join.
  const sheetOnly = match.withoutLead;
  const lawmaticsOnly: LawmaticsSourceRecord[] =
    input.lawmatics.status === "ok"
      ? input.lawmatics.records
          .filter((r) => !claimedRecords.has(r.lawmaticsId) && !(r.stageName && isHiredStage(r.stageName)) && !isWonStageName(r.stageName, stages))
          .sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? "") || 0)
      : [];

  // ── the reads that need to know who is on the table ─────────────────────────
  const reads: Reads = { notes: null, notesFailed: null, mail: new Map(), capped: new Set() };
  // Each pulled person is asked about twice: the notes on the prospect and the notes on their contact.
  const pulled = [
    ...onTable.flatMap((l) => (recordOf.has(l.id) ? [recordOf.get(l.id)!] : [])),
    ...lawmaticsOnly.slice(0, NOT_IN_LECTUAL_CAP),
  ];
  const notesTargets: NotesTarget[] = pulled.flatMap((r) => [
    { id: r.lawmaticsId, kind: "Prospect" as const },
    ...(r.contactId ? [{ id: r.contactId, kind: "Contact" as const }] : []),
  ]);
  if (input.readLawmaticsNotes && input.lawmatics.status === "ok" && notesTargets.length > 0) {
    try {
      reads.notes = await input.readLawmaticsNotes(notesTargets);
    } catch {
      reads.notesFailed = "Lawmatics notes couldn't be read. This is not an empty notes list.";
    }
  }

  const addressOfLead = (lead: LeadRow) =>
    searchableAddress(lead.email) ?? searchableAddress(recordOf.get(lead.id)?.email) ?? searchableAddress(contactEmailFor(leadName(lead), contacts));
  const addressOfSheetOnly = (e: SheetEntry) => searchableAddress(contactEmailFor(e.ownerName, contacts));
  const addressOfLawmaticsOnly = (r: LawmaticsSourceRecord) => searchableAddress(r.email);

  if (input.searchMail) {
    const wanted: Array<{ key: string; address: string }> = [];
    const seen = new Set<string>();
    const want = (key: string, address: string | null) => {
      if (address && !seen.has(address)) {
        seen.add(address);
        wanted.push({ key, address });
      }
    };
    for (const lead of onTable) want(lead.id, addressOfLead(lead));
    for (const e of sheetOnly) want(`sheet:${e.row}`, addressOfSheetOnly(e));
    for (const r of lawmaticsOnly.slice(0, NOT_IN_LECTUAL_CAP)) want(`lm:${r.lawmaticsId}`, addressOfLawmaticsOnly(r));
    const searched = wanted.slice(0, MAX_PEOPLE_PER_PREVIEW);
    for (const w of wanted.slice(MAX_PEOPLE_PER_PREVIEW)) reads.capped.add(w.address);
    await mapLimit(searched, 4, async (w) => {
      reads.mail.set(w.address, await input.searchMail!(w.address));
    });
  }

  const mailboxFor = (address: string | null): MailboxSearch | null => (address ? (reads.mail.get(address) ?? null) : null);
  const mailboxStateFor = (address: string | null): MailboxSearchState => {
    if (!address) return { status: "unavailable", code: "no-address", reason: MAILBOX_REASONS.noAddress };
    if (reads.capped.has(address)) return { status: "unavailable", code: "limit", reason: MAILBOX_REASONS.limit };
    return mailboxFor(address)?.state ?? NOT_RUN;
  };

  /** The prospect's notes and the contact's, as one. Unavailable if either read failed; undefined if either wasn't read. */
  const notesFor = (record: LawmaticsSourceRecord | undefined): RecordNotes | undefined => {
    if (!record || !reads.notes) return undefined;
    const byRecord = reads.notes.byRecord;
    const parts = [byRecord.get(notesKey({ id: record.lawmaticsId, kind: "Prospect" }))];
    if (record.contactId) parts.push(byRecord.get(notesKey({ id: record.contactId, kind: "Contact" })));
    const failed = parts.find((p) => p?.status === "unavailable");
    if (failed && failed.status === "unavailable") return failed;
    if (parts.some((p) => !p)) return undefined;
    const ok = parts as Array<Extract<RecordNotes, { status: "ok" }>>;
    return { status: "ok", notes: ok.flatMap((p) => p.notes), truncated: ok.some((p) => p.truncated) };
  };
  const rowNotes = (record: LawmaticsSourceRecord | undefined): ReconcileRow["notes"] => {
    if (!record) return undefined;
    if (reads.notesFailed) return { status: "unavailable", reason: reads.notesFailed };
    const n = notesFor(record);
    if (!n) return { status: "not-read" };
    return n.status === "ok" ? { status: "ok", count: n.notes.length } : { status: "unavailable", reason: n.reason };
  };

  // ── one row per lead ────────────────────────────────────────────────────────
  const rows: ReconcileRow[] = onTable.map((lead) => {
    const sheetMatch = match.byLead.get(lead.id);
    const entry = sheetMatch?.kind === "entry" ? sheetMatch.entry : null;
    const sheetSignal = sheetSignalFor(sheetMatch);
    const record = recordOf.get(lead.id);
    const lawmaticsSignal =
      lawmaticsIndex && input.lawmatics.status === "ok"
        ? lawmaticsSignalFor({ lawmaticsId: lead.lawmaticsId, email: lead.email }, lawmaticsIndex, stages)
        : unavailable(input.lawmatics.status === "ok" ? "" : input.lawmatics.reason);
    const mail = email.status === "ok" ? (email.byLead.get(lead.id) ?? []) : [];
    const emailSignal =
      email.status === "ok" ? emailSignalFor(mail, stages, email.agent?.get(lead.id) ?? []) : unavailable(email.reason);

    const address = addressOfLead(lead);
    const search = mailboxFor(address);
    const extra = collapseEvidence([
      ...sheetNoteEvidence(entry, ctx),
      ...lawmaticsEvidence(record, notesFor(record), lawmaticsSignal.kind === "unmapped", ctx),
      ...mailEvidence(mail, search?.hits ?? [], ctx),
    ]);
    const proposal = proposeStage(
      { currentStageId: lead.currentStageId },
      { sheet: sheetSignal, lawmatics: lawmaticsSignal, email: emailSignal },
      stages,
      extra,
    );
    const evidence = proposal.evidence ?? extra;
    const lastTouch = lastTouchOf(
      evidence,
      [
        sheetSignal.kind === "stage" ? sheetSignal.date : null,
        ...mail.filter((m) => !m.sensitive).map((m) => m.at),
        ...(search?.hits ?? []).map((h) => h.at),
      ],
      now,
    );
    return {
      leadId: lead.id,
      leadName: leadName(lead),
      currentStageId: lead.currentStageId,
      currentStageName: stageName.get(lead.currentStageId) ?? "Unknown stage",
      sheet: sheetSignal,
      lawmatics: lawmaticsSignal,
      email: emailSignal,
      proposal,
      evidence,
      lastTouch,
      mailbox: mailboxStateFor(address),
      notes: rowNotes(record),
    };
  });
  rows.sort((a, b) => rank(a) - rank(b) || a.leadName.localeCompare(b.leadName) || (a.leadId < b.leadId ? -1 : 1));

  const confidence: Record<Confidence, number> = { agree: 0, sheet_only: 0, single_source: 0, conflict: 0, no_evidence: 0 };
  for (const row of rows) if (row.proposal.confidence) confidence[row.proposal.confidence] += 1;

  const lawmatics: LawmaticsState =
    input.lawmatics.status === "ok"
      ? {
          status: "ok",
          records: input.lawmatics.records.length,
          matched: rows.filter((r) => ["stage", "unmapped", "needs_matter"].includes(r.lawmatics.kind)).length,
        }
      : { status: input.lawmatics.status, reason: input.lawmatics.reason };

  const emailState: EmailState =
    email.status === "ok"
      ? {
          status: "ok",
          leadsWithMail: email.byLead.size,
          note:
            email.total === 0 && rows.length > 0
              ? "No synced mail was found for these leads. If mail sync isn't connected that is expected. Nothing failed."
              : null,
        }
      : { status: "unavailable", reason: email.reason };

  // ── people with no lead ─────────────────────────────────────────────────────
  const notIn: NotInLectualItem[] = [];
  const joinedRecords = new Set<string>();
  for (const e of sheetOnly) {
    const reading = e.reading;
    if (reading.kind !== "ok") continue;
    const split = splitOwnerName(e.ownerName);
    const address = addressOfSheetOnly(e);
    const joined = lawmaticsOnly.find(
      (r) =>
        !joinedRecords.has(r.lawmaticsId) &&
        ((r.email && address && r.email.toLowerCase() === address) || namesMatch(e.ownerName, [r.firstName, r.lastName].filter(Boolean).join(" "))),
    );
    if (joined) joinedRecords.add(joined.lawmaticsId);
    const search = mailboxFor(address ?? addressOfLawmaticsOnly(joined ?? ({ email: null } as LawmaticsSourceRecord)));
    const sheetSignal: SourceSignal = { kind: "stage", stageId: reading.stageId, stageName: reading.stageName, wording: reading.wording, date: reading.date };
    const evidence = collapseEvidence([
      ...proposeEvidence(sheetSignal),
      ...sheetNoteEvidence(e, ctx),
      ...lawmaticsEvidence(joined, joined ? notesFor(joined) : undefined, false, ctx),
      ...mailEvidence([], search?.hits ?? [], ctx),
    ]);
    notIn.push({
      key: `sheet:${e.row}`,
      found: "sheet",
      name: e.ownerName,
      detail: `Sheet row ${e.row}: ${reading.wording}${e.markText ? ` (${e.markText})` : ""}`,
      candidate: {
        found: "sheet",
        firstName: split.firstName,
        lastName: split.lastName,
        businessName: split.parenthetical,
        email: address ?? joined?.email ?? null,
        sheetKey: e.exactKey,
        lawmaticsId: joined?.lawmaticsId ?? null,
        stageId: reading.stageId,
        practiceArea: SHEET_PRACTICE_AREA,
      },
      evidence,
      lastTouch: lastTouchOf(evidence, [reading.date, ...(search?.hits ?? []).map((h) => h.at)], now),
      mailbox: mailboxStateFor(address ?? (joined ? addressOfLawmaticsOnly(joined) : null)),
    });
  }
  const lawmaticsListed = lawmaticsOnly.filter((r) => !joinedRecords.has(r.lawmaticsId));
  for (const r of lawmaticsListed.slice(0, NOT_IN_LECTUAL_CAP)) {
    const address = addressOfLawmaticsOnly(r);
    const search = mailboxFor(address);
    const resolved = r.stageName ? resolveStage(r.stageName, stages) : null;
    const unmappedStage = !!r.stageName && !resolved?.ok;
    const evidence = collapseEvidence([
      ...(resolved?.ok
        ? [{ source: "lawmatics" as const, via: "stage" as const, milestone: null, label: r.stageName!, date: null, stageId: resolved.stage.id }]
        : []),
      ...lawmaticsEvidence(r, notesFor(r), unmappedStage, ctx),
      ...mailEvidence([], search?.hits ?? [], ctx),
    ]);
    const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.matterName || "Unnamed";
    notIn.push({
      key: `lm:${r.lawmaticsId}`,
      found: "lawmatics",
      name,
      detail: `Lawmatics${r.stageName ? `, stage "${r.stageName}"` : ", no stage"}`,
      candidate: {
        found: "lawmatics",
        firstName: r.firstName ?? "",
        lastName: r.lastName ?? "",
        businessName: r.businessName,
        email: r.email,
        sheetKey: null,
        lawmaticsId: r.lawmaticsId,
        stageId: resolved?.ok && stages.find((s) => s.id === resolved.stage.id)?.category === "open" ? resolved.stage.id : null,
        practiceArea: r.practiceArea,
      },
      evidence,
      lastTouch: lastTouchOf(evidence, [r.updatedAt, ...(search?.hits ?? []).map((h) => h.at)], now),
      mailbox: mailboxStateFor(address),
    });
  }

  const notesState = notesStateOf(input, reads, notesTargets.length);
  const searchedStates = [...rows.map((r) => r.mailbox), ...notIn.map((n) => n.mailbox)].filter((s): s is MailboxSearchState => !!s);
  const mailboxSummary = {
    searched: searchedStates.filter((s) => s.status === "ok").length,
    unavailable: searchedStates.filter((s) => s.status === "unavailable" && s.code !== "no-address").length,
    note: firstMailboxNote(searchedStates),
  };

  const plan: PlanRow[] = rows.map((r) => ({
    leadId: r.leadId,
    fromStageId: r.currentStageId,
    proposedStageId: r.proposal.stage?.id ?? null,
    evidenceDate: r.proposal.evidenceDate,
    confidence: r.proposal.confidence,
    lastTouch: r.lastTouch ?? null,
  }));

  const view: ReconcileView = {
    rows,
    pickable: stages.filter((s) => s.category !== "won").map((s) => ({ id: s.id, name: s.name })),
    summary: {
      fileName: input.fileName,
      sectionsLine: sheet.sections ? describeSections(sheet.sections) : null,
      notes: notesState,
      mailbox: mailboxSummary,
      mappingNote: input.mappingNote ?? null,
      notInLectual: notIn,
      notInLectualTotal: notIn.length + Math.max(0, lawmaticsListed.length - NOT_IN_LECTUAL_CAP),
      confidence,
      needsMatter: rows.filter((r) => r.proposal.kind === "needs_matter").length,
      alreadyThere: rows.filter((r) => isAlreadyThere(r.proposal)).length,
      lawmatics,
      email: emailState,
      sheet: { rowsRead: sheet.rowsRead, intakeRows: sheet.intakeRows, blankRows: sheet.blankRows },
      sheetRowsWithoutLead: match.withoutLead.map((e) => ({
        row: e.row,
        owner: e.ownerName,
        mark: e.markText,
        status: e.reading.wording,
      })),
      refused: sheet.refused.map((r) => ({ row: r.row, reason: r.reason, status: r.statusText ?? null })),
      ambiguousLeads: match.ambiguousLeads,
      leadsTruncated: input.leadsTruncated,
    },
  };
  return { view, plan };
}

function isWonStageName(name: string | null, stages: readonly StageOpt[]): boolean {
  if (!name) return false;
  const resolved = resolveStage(name, stages);
  return resolved.ok && stages.find((s) => s.id === resolved.stage.id)?.category === "won";
}

function proposeEvidence(signal: SourceSignal): EvidenceItem[] {
  return signal.kind === "stage"
    ? [{ source: "sheet", via: "status", milestone: null, label: signal.wording, date: signal.date ?? null, stageId: signal.stageId }]
    : [];
}

function notesStateOf(input: PlanInput, reads: Reads, targets: number): NotesState {
  if (input.lawmatics.status !== "ok") return { status: "not-read", reason: "Lawmatics isn't available, so its notes weren't read." };
  if (!input.readLawmaticsNotes) return { status: "not-read", reason: "Lawmatics notes weren't read in this preview." };
  if (reads.notesFailed) return { status: "unavailable", reason: reads.notesFailed };
  if (!reads.notes) return { status: "ok", records: 0, notes: 0, truncated: false };
  const entries = [...reads.notes.byRecord.values()];
  const ok = entries.filter((e): e is Extract<RecordNotes, { status: "ok" }> => e.status === "ok");
  if (targets > 0 && ok.length === 0) {
    const first = entries.find((e) => e.status === "unavailable");
    return { status: "unavailable", reason: first && first.status === "unavailable" ? first.reason : "Lawmatics notes couldn't be read." };
  }
  return {
    status: "ok",
    records: ok.length,
    notes: ok.reduce((n, e) => n + e.notes.length, 0),
    truncated: reads.notes.skippedForLimit > 0 || ok.some((e) => e.truncated) || ok.length < entries.length,
  };
}

function firstMailboxNote(states: readonly MailboxSearchState[]): string | null {
  const blocked = states.find((s) => s.status === "unavailable" && s.code !== "no-address" && s.code !== "limit" && s.code !== "not-run");
  if (blocked && blocked.status === "unavailable") return blocked.reason;
  if (states.some((s) => s.status === "unavailable" && s.code === "limit")) return MAILBOX_REASONS.limit;
  return null;
}

export type { CreateLeadCandidate, LawmaticsIndex };
