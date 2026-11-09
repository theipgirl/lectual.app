import type { ReviewRow } from "./buckets";

/**
 * The Sheet view: the Excel tracker as one table, in two sections. Pure.
 * Trademarks = every lead plus every TM / CR / PATENT matter (a matter with no type reads as TM);
 * Contracts = any other matter type. Rows run in stage pipeline order, then client name.
 */
export const IP_MATTER_TYPES: readonly string[] = ["TM", "CR", "PATENT"];

export type SheetSections = { trademarks: ReviewRow[]; contracts: ReviewRow[] };

export function isTrademarkRow(row: Pick<ReviewRow, "kind" | "matterType">): boolean {
  return row.kind === "lead" || IP_MATTER_TYPES.includes(row.matterType ?? "TM");
}

function compare(a: ReviewRow, b: ReviewRow): number {
  const oa = a.stageOrder ?? Number.POSITIVE_INFINITY;
  const ob = b.stageOrder ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa < ob ? -1 : 1;
  return a.client.localeCompare(b.client, "en") || a.key.localeCompare(b.key);
}

export function sheetSections(rows: readonly ReviewRow[]): SheetSections {
  const trademarks: ReviewRow[] = [];
  const contracts: ReviewRow[] = [];
  for (const r of rows) (isTrademarkRow(r) ? trademarks : contracts).push(r);
  return { trademarks: trademarks.sort(compare), contracts: contracts.sort(compare) };
}

export const SHEET_COLUMNS = ["Client", "Mark", "Status", "Next step", "Whose court", "Waiting on", "Source", "Last contact"] as const;

/** "Us", "Client · followed up Nov 4", "USPTO", "Approval" or "—". Pure; `shortDate` is passed in to keep this file import-free. */
export function waitingCell(row: Pick<ReviewRow, "waiting" | "contactKnown" | "lastOutbound">, fmt: (date: string) => string): string {
  switch (row.waiting) {
    case "us": return "Us";
    case "uspto": return "USPTO";
    case "approval": return "Approval";
    case "client":
      return !row.contactKnown ? "Client" : row.lastOutbound ? `Client · followed up ${fmt(row.lastOutbound)}` : "Client · no follow-up recorded";
    default: return "—";
  }
}
