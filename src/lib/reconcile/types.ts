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

export type Confidence = "agree" | "sheet_only" | "conflict" | "no_evidence";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  agree: "Agree",
  sheet_only: "Sheet only",
  conflict: "Conflict",
  no_evidence: "No evidence",
};

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

export type ReconcileSummary = {
  fileName: string;
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
  | { leadId: string; status: "moved"; stageName: string }
  | { leadId: string; status: "already"; stageName: string }
  | { leadId: string; status: "failed"; error: string };

export type ApplyResult =
  | {
      ok: true;
      outcomes: RowOutcome[];
      totals: { moved: number; already: number; failed: number };
    }
  | { ok: false; error: string; stale?: boolean; outcomes?: RowOutcome[] };
