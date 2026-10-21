import { isTrademarkIntake } from "@/lib/intake/scope";
import type { SheetRead } from "@/lib/intake/sheet-read";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";
import { emailSignalFor, type StoredMail } from "./email";
import { indexLawmatics, lawmaticsSignalFor } from "./lawmatics";
import { proposeStage } from "./propose";
import { matchSheetToLeads, sheetSignalFor } from "./sheet-match";
import type {
  Confidence,
  EmailState,
  LawmaticsState,
  LeadRow,
  PlanRow,
  ReconcileRow,
  ReconcileView,
  SourceSignal,
  StageOpt,
} from "./types";

/**
 * Builds the table the screen shows, from what the three readers returned. Pure.
 *
 * One row per lead in intake scope (a stage before the first "won" stage, trademark or unset
 * practice area) plus any lead the sheet matched, wherever it sits. A source that could not be read
 * is carried as "unavailable" on every row: it is never turned into "none".
 */

export type LawmaticsInput =
  | { status: "ok"; records: LawmaticsSourceRecord[] }
  | { status: "not-connected"; reason: string }
  | { status: "unavailable"; reason: string };

export type EmailInput =
  | { status: "ok"; byLead: Map<string, StoredMail[]>; total: number }
  | { status: "unavailable"; reason: string };

export type PlanInput = {
  fileName: string;
  stages: readonly StageOpt[];
  leads: readonly LeadRow[];
  leadsTruncated: boolean;
  sheet: SheetRead;
  lawmatics: LawmaticsInput;
  /** Reads mail for the leads on the table, which this function chooses; so it is asked for them. */
  readEmail: (leadIds: string[]) => Promise<EmailInput>;
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

function leadName(lead: LeadRow): string {
  return `${lead.firstName} ${lead.lastName}`.trim() || lead.email || "(no name)";
}

function rank(row: ReconcileRow): number {
  const { kind, confidence } = row.proposal;
  if (kind === "stage") return confidence === "agree" ? 0 : confidence === "sheet_only" ? 1 : 2;
  if (kind === "needs_matter") return 3;
  return confidence === "no_evidence" ? 5 : 4;
}

const unavailable = (reason: string): SourceSignal => ({ kind: "unavailable", reason });

export async function buildPlan(input: PlanInput): Promise<{ view: ReconcileView; plan: PlanRow[] }> {
  const { stages, leads, sheet } = input;
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  const match = matchSheetToLeads(
    sheet.entries,
    leads.map((l) => ({ id: l.id, sheetKey: l.sheetKey })),
  );
  const onTable = tableLeads(stages, leads, new Set(match.byLead.keys()));

  const email = onTable.length > 0 ? await input.readEmail(onTable.map((l) => l.id)) : ({ status: "ok", byLead: new Map(), total: 0 } as EmailInput);
  const lawmaticsIndex = input.lawmatics.status === "ok" ? indexLawmatics(input.lawmatics.records) : null;

  const rows: ReconcileRow[] = onTable.map((lead) => {
    const sheetSignal = sheetSignalFor(match.byLead.get(lead.id));
    const lawmaticsSignal =
      lawmaticsIndex && input.lawmatics.status === "ok"
        ? lawmaticsSignalFor({ lawmaticsId: lead.lawmaticsId, email: lead.email }, lawmaticsIndex, stages)
        : unavailable(input.lawmatics.status === "ok" ? "" : input.lawmatics.reason);
    const emailSignal =
      email.status === "ok" ? emailSignalFor(email.byLead.get(lead.id) ?? [], stages) : unavailable(email.reason);
    return {
      leadId: lead.id,
      leadName: leadName(lead),
      currentStageId: lead.currentStageId,
      currentStageName: stageName.get(lead.currentStageId) ?? "Unknown stage",
      sheet: sheetSignal,
      lawmatics: lawmaticsSignal,
      email: emailSignal,
      proposal: proposeStage(
        { currentStageId: lead.currentStageId },
        { sheet: sheetSignal, lawmatics: lawmaticsSignal, email: emailSignal },
        stages,
      ),
    };
  });
  rows.sort((a, b) => rank(a) - rank(b) || a.leadName.localeCompare(b.leadName) || (a.leadId < b.leadId ? -1 : 1));

  const confidence: Record<Confidence, number> = { agree: 0, sheet_only: 0, conflict: 0, no_evidence: 0 };
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

  const plan: PlanRow[] = rows.map((r) => ({
    leadId: r.leadId,
    fromStageId: r.currentStageId,
    proposedStageId: r.proposal.stage?.id ?? null,
    evidenceDate: r.proposal.evidenceDate,
    confidence: r.proposal.confidence,
  }));

  const view: ReconcileView = {
    rows,
    pickable: stages.filter((s) => s.category !== "won").map((s) => ({ id: s.id, name: s.name })),
    summary: {
      fileName: input.fileName,
      confidence,
      needsMatter: rows.filter((r) => r.proposal.kind === "needs_matter").length,
      alreadyThere: rows.filter((r) => r.proposal.kind === "no_proposal" && r.proposal.confidence !== "no_evidence").length,
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
