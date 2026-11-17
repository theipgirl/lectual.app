import type { IntakeRow } from "@/lib/intake/rows";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { pendingFor } from "@/lib/intake/needs-rebecca";
import type { DuplicateOf } from "@/lib/intake/duplicates";
import { buildBoardCard, type CardContext, type CardRead, type CardTask, type CardView } from "./model";
import type { CardApprovals } from "./rules";

/**
 * The per-lead card data the Intake page hands its client workspace (Sprint 10 Part 2): everything `buildBoardCard`
 * decides for a role (which controls, the open link, the next-step line, the bottom line, "Needs attorney · N", the ⋯ menu),
 * plus the open step's due date as YYYY-MM-DD for the inline editor. PURE: reads are passed in. Plain data, so it crosses
 * to the client. The temperature, owner and stage on a row are still taken from the ROW on the client (the workspace edits
 * them optimistically); only the decisions that don't change with an edit come from here.
 */
export type IntakeCardData = CardView & { dueIso: string | null };

export function approvalsFor(row: IntakeRow, approvals: LeadPendingApprovals | undefined): CardApprovals {
  if (!approvals || approvals.status === "unconfigured") return { status: "unconfigured" };
  if (approvals.status === "unavailable") return { status: "unavailable" };
  return { status: "ok", queueIds: pendingFor(approvals, row.lead.id, row.stage ?? undefined).map((p) => p.queueId) };
}

export function buildIntakeCards(opts: {
  rows: readonly IntakeRow[];
  ctx: CardContext;
  steps: CardRead<Record<string, CardTask | null>>;
  approvals: LeadPendingApprovals | undefined;
  duplicates: Record<string, DuplicateOf>;
}): Record<string, IntakeCardData> {
  const out: Record<string, IntakeCardData> = {};
  for (const row of opts.rows) {
    const id = row.lead.id;
    const nextStep: CardRead<CardTask | null> = opts.steps.status === "ok" ? { status: "ok", value: opts.steps.value[id] ?? null } : { status: "unavailable" };
    const view = buildBoardCard(
      {
        kind: "lead",
        lead: row.lead,
        stageName: row.stage?.name ?? null,
        temperature: row.temperature,
        nextStep,
        approvals: approvalsFor(row, opts.approvals),
        duplicateOf: opts.duplicates[id]?.leadId ?? null,
      },
      opts.ctx,
    );
    const due = nextStep.status === "ok" && nextStep.value?.dueAt && /^\d{4}-\d{2}-\d{2}/.test(nextStep.value.dueAt) ? nextStep.value.dueAt.slice(0, 10) : null;
    out[id] = { ...view, dueIso: due };
  }
  return out;
}
