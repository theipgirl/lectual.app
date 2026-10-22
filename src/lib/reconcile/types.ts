/**
 * Shapes shared by the stage reconciliation screen. Pure types, safe for the browser: the plan
 * the server builds is plain JSON (no Map, Set or Date) because it crosses a server action twice.
 */

/** One of the firm's own stages, as the screen needs it. */
export type StageOpt = {
  id: string;
  name: string;
  category: string;
  orderIndex: number;
};

import type { Milestone } from "./milestones";

/** The three places a stage can be read from. */
export type SourceName = "sheet" | "lawmatics" | "email";

export const SOURCE_LABEL: Record<SourceName, string> = {
  sheet: "Sheet",
  lawmatics: "Lawmatics",
  email: "Email / calendar",
};

/**
 * What one source says about one lead. The five states stay apart on purpose: "unavailable" (the
 * source could not be read) is never "none" (it was read and said nothing), and an unmapped name
 * never votes.
 */
export type SourceSignal =
  | { kind: "unavailable"; reason: string }
  | { kind: "none"; note?: string }
  | { kind: "stage"; stageId: string; stageName: string; wording: string; date?: string | null }
  | { kind: "unmapped"; wording: string }
  /** "Hired" in Lawmatics, or a client status code on the sheet. Never a stage to move to. */
  | { kind: "needs_matter"; wording: string };

export type ProposeSources = { sheet: SourceSignal; lawmatics: SourceSignal; email: SourceSignal };

/**
 * `sheet_only`: only the sheet has evidence. `single_source`: only Lawmatics or mail does. `agree`: two or
 * more sources, each at the proposed stage. `conflict`: a source points somewhere else (often backward).
 */
export type Confidence = "agree" | "sheet_only" | "single_source" | "conflict" | "no_evidence";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  agree: "Agree",
  sheet_only: "Sheet only",
  single_source: "One source",
  conflict: "Conflict",
  no_evidence: "No evidence",
};

/** How a piece of evidence was read. */
export type EvidenceVia = "status" | "note" | "stage" | "mail" | "mailbox" | "agent";

/**
 * One dated fact about a person: a status code, a note, a Lawmatics stage or note, a mail. `snippet` is at
 * most 140 characters of a NOTE and exists only in the preview that is on the screen: nothing stores it.
 */
export type EvidenceItem = {
  source: SourceName;
  via: EvidenceVia;
  milestone: Milestone | null;
  label: string;
  date: string | null;
  /** The firm's stage this evidence names, or null when it names none (or none the firm has). */
  stageId: string | null;
  /** The evidence says the person is a client: never a stage, always "Open a matter". */
  matter?: boolean;
  snippet?: string;
};

/** What the on-demand search of the firm's Microsoft mailboxes found for one person. */
export type MailboxSearchState =
  | { status: "ok"; messages: number; sent: number; received: number; truncated: boolean; mailboxes: number; unread: number }
  | {
      status: "unavailable";
      code: "no-address" | "no-mailbox" | "module-off" | "gmail-only" | "scope-missing" | "reauth" | "failed" | "limit" | "not-run";
      reason: string;
    };

/** Lawmatics notes for the people on the table. */
export type NotesState =
  | { status: "ok"; records: number; notes: number; truncated: boolean }
  | { status: "unavailable"; reason: string }
  | { status: "not-read"; reason: string };

export type ProposalKind = "stage" | "needs_matter" | "no_proposal";

export type Proposal = {
  kind: ProposalKind;
  /** The stage to move to; null unless kind is "stage". Always one of the firm's non-won stages. */
  stage: { id: string; name: string } | null;
  /** Null only when kind is "needs_matter": that state has its own label. */
  confidence: Confidence | null;
  reasons: string[];
  /** The date the winning source can honestly give for when the stage was entered; null if none. */
  evidenceDate: string | null;
  unavailable: SourceName[];
  /** Every dated fact the proposal rests on, newest first, so the screen can cite each one. */
  evidence?: EvidenceItem[];
};

/** One row of the table. */
export type ReconcileRow = {
  leadId: string;
  leadName: string;
  currentStageId: string;
  currentStageName: string;
  sheet: SourceSignal;
  lawmatics: SourceSignal;
  email: SourceSignal;
  proposal: Proposal;
  /** Notes, mail and stages cited as evidence (the proposal's evidence list). */
  evidence?: EvidenceItem[];
  /** The newest dated evidence across the sources, never in the future; null when there is none. */
  lastTouch?: string | null;
  mailbox?: MailboxSearchState;
  /** Lawmatics notes for this person: read (and how many), or why not. Never "none" for a failed read. */
  notes?: { status: "ok"; count: number } | { status: "unavailable"; reason: string } | { status: "not-read" };
};

/** The part of a row that is fingerprinted and posted back for apply. */
export type PlanRow = {
  leadId: string;
  /** The stage the lead was in when the plan was made. */
  fromStageId: string;
  /** The stage the plan proposed, or null when it proposed none. */
  proposedStageId: string | null;
  evidenceDate: string | null;
  confidence: Confidence | null;
  /** The proposed last touch (ISO), or null. Apply sets it only when it is newer than what the lead holds. */
  lastTouch?: string | null;
};

/** What the person decided for one row. A skipped row has no entry. */
export type Decision = { stageId: string; evidenceDate: string | null; picked: boolean };
export type Decisions = Record<string, Decision>;

/** A move the browser asks for. The date is never sent: the server takes it from the plan. */
export type MoveRequest = { leadId: string; stageId: string };

export type LawmaticsState =
  | { status: "ok"; matched: number; records: number }
  | { status: "not-connected"; reason: string }
  | { status: "unavailable"; reason: string };

export type EmailState =
  | { status: "ok"; leadsWithMail: number; note: string | null }
  | { status: "unavailable"; reason: string };

/** A lead as the screen reads it (a subset of crm_lead). */
export type LeadRow = {
  id: string;
  lastActivityAt?: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  currentStageId: string;
  sheetKey: string | null;
  lawmaticsId: string | null;
  practiceArea: string | null;
};

export type SheetRowRef = { row: number; owner: string; mark: string | null; status: string };
export type RefusedSheetRow = { row: number; reason: string; status: string | null };

/** A person the sources know and the app does not. Listed with a Create lead button; never created unasked. */
export type NotInLectualItem = {
  key: string;
  found: "sheet" | "lawmatics" | "mailbox";
  name: string;
  detail: string;
  /** What to file them as; the server validates it again before writing. */
  candidate: CreateLeadCandidate;
  evidence: EvidenceItem[];
  lastTouch: string | null;
  mailbox?: MailboxSearchState;
};

/** The facts the Create lead action needs. The browser sends them back; the server checks every one. */
export type CreateLeadCandidate = {
  found: "sheet" | "lawmatics" | "mailbox";
  firstName: string;
  lastName: string;
  businessName: string | null;
  email: string | null;
  sheetKey: string | null;
  lawmaticsId: string | null;
  /** A stage id from the preview, or null for the firm's first open stage. */
  stageId: string | null;
  practiceArea: string | null;
};

export type ReconcileSummary = {
  fileName: string;
  /** "Read: Trademark intake (3 sections, 1,170 rows). Skipped: Tasks, Contracts." */
  sectionsLine?: string | null;
  notes?: NotesState;
  mailbox?: { searched: number; unavailable: number; note: string | null };
  /** A sentence when the firm's own stage mapping could not be read and the default names were used. */
  mappingNote?: string | null;
  notInLectual?: NotInLectualItem[];
  notInLectualTotal?: number;
  confidence: Record<Confidence, number>;
  needsMatter: number;
  alreadyThere: number;
  lawmatics: LawmaticsState;
  email: EmailState;
  sheet: { rowsRead: number; intakeRows: number; blankRows: number };
  sheetRowsWithoutLead: SheetRowRef[];
  refused: RefusedSheetRow[];
  /** Sheet keys that more than one lead shares, or that match more than one sheet row. */
  ambiguousLeads: number;
  leadsTruncated: boolean;
};

export type ReconcileView = {
  rows: ReconcileRow[];
  /** The firm's stages a person may pick, in pipeline order; no stage that opens a matter. */
  pickable: { id: string; name: string }[];
  summary: ReconcileSummary;
};

export type PreviewResult =
  | { ok: true; view: ReconcileView; plan: PlanRow[]; fingerprint: string }
  | { ok: false; error: string };

export type RowOutcome =
  | { leadId: string; status: "moved"; stageName: string; lastTouchSet?: boolean }
  | { leadId: string; status: "already"; stageName: string; lastTouchSet?: boolean }
  | { leadId: string; status: "failed"; error: string };

export type ApplyResult =
  | {
      ok: true;
      outcomes: RowOutcome[];
      totals: { moved: number; already: number; failed: number };
    }
  | { ok: false; error: string; stale?: boolean; outcomes?: RowOutcome[] };
