import { readFileSync } from "node:fs";
import type { Confidence, PlanRow, SourceSignal, StageOpt } from "../../src/lib/reconcile/types";

/** Fixed UUIDs, because the apply action refuses an id that isn't one. */
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ORG = uuid("aaaaaaaa", 1);
export const OTHER_ORG = uuid("bbbbbbbb", 1);
export const SECRET = "SECRET-constraint-crm_lead_pkey-org-9f8e7d";

export const S = {
  followUp: uuid("5100aaaa", 0),
  pnc: uuid("5100aaaa", 1),
  prelim: uuid("5100aaaa", 2),
  consult: uuid("5100aaaa", 3),
  post: uuid("5100aaaa", 4),
  undecided: uuid("5100aaaa", 5),
  loe: uuid("5100aaaa", 6),
  signed: uuid("5100aaaa", 7),
  lost: uuid("5100aaaa", 8),
} as const;

/** RPB's own intake stages plus a stage that opens a matter ("won") and a lost stage. */
export const STAGES: StageOpt[] = [
  { id: S.followUp, name: "Follow-Up", category: "nurture", orderIndex: 0 },
  { id: S.pnc, name: "Potential New Client", category: "open", orderIndex: 1 },
  { id: S.prelim, name: "Preliminary Search", category: "open", orderIndex: 2 },
  { id: S.consult, name: "Consultation Scheduled", category: "open", orderIndex: 3 },
  { id: S.post, name: "Post Consultation Email Sent", category: "open", orderIndex: 4 },
  { id: S.undecided, name: "Undecided / Questions", category: "open", orderIndex: 5 },
  { id: S.loe, name: "LOE & Invoice Sent", category: "open", orderIndex: 6 },
  { id: S.signed, name: "Signed LOE / Deposit Received", category: "won", orderIndex: 7 },
  { id: S.lost, name: "Lost", category: "lost", orderIndex: 8 },
];

export const stageName = (id: string) => STAGES.find((s) => s.id === id)!.name;

export const NOW = new Date("2026-09-14T12:00:00Z");

export const fixtureText = () => readFileSync(new URL("../fixtures/intake/trademarks-sheet.csv", import.meta.url), "utf8");
export const fixtureBytes = () => readFileSync(new URL("../fixtures/intake/trademarks-sheet.csv", import.meta.url));

// ── signals ──────────────────────────────────────────────────────────────────

export const stageSignal = (id: string, wording?: string, date: string | null = null): SourceSignal => ({
  kind: "stage",
  stageId: id,
  stageName: stageName(id),
  wording: wording ?? stageName(id),
  date,
});
export const none = (note?: string): SourceSignal => ({ kind: "none", note });
export const unavailable = (reason = "it could not be reached"): SourceSignal => ({ kind: "unavailable", reason });
export const unmapped = (wording: string): SourceSignal => ({ kind: "unmapped", wording });
export const matter = (wording: string): SourceSignal => ({ kind: "needs_matter", wording });

export const planRow = (over: Partial<PlanRow> & { leadId: string }): PlanRow => ({
  fromStageId: S.pnc,
  proposedStageId: S.consult,
  evidenceDate: "2026-09-03T00:00:00.000Z",
  confidence: "sheet_only" as Confidence,
  ...over,
});
