import type { ReviewRow } from "./buckets";
import { shortDate } from "./format";
import type { FactColumnId } from "./sheet-columns";
import { BLANK, COL_COULDNT_LOAD, COL_UNCONFIRMED_SUFFIX, FEE_FROM_PROPOSAL, FEE_FROM_SPREADSHEET } from "@/lib/ui/words";

/**
 * The read-only cells the List's new spreadsheet columns draw. Pure: a row's facts in, plain data out (so the server can hand
 * them to the owner Sheet's client table). Three states, never two: a value, a plain dash (nothing recorded, or a lead where the
 * fact does not exist) and "Couldn't load" (the read behind it failed). Nothing is computed here beyond formatting a date.
 */
export type FactCell = {
  text: string;
  /** Hover text: where a fee came from. */
  title?: string;
  /** Office Action Due Date only: past due. */
  overdue?: boolean;
  tone: "value" | "none" | "failed";
};

export type FactCells = Record<FactColumnId, FactCell>;

const dash: FactCell = { text: BLANK, tone: "none" };
const failed: FactCell = { text: COL_COULDNT_LOAD, tone: "failed" };

export type FactSource = Pick<ReviewRow, "kind" | "serialNumber" | "startDate" | "practiceArea" | "officeActionDue" | "fees">;

function money(cell: NonNullable<ReviewRow["fees"]>["legal"]): FactCell {
  return cell ? { text: cell.text, tone: "value", title: cell.from === "proposal" ? FEE_FROM_PROPOSAL : FEE_FROM_SPREADSHEET } : dash;
}

function ledgerDate(value: string | null | undefined): FactCell {
  return value ? { text: value, tone: "value", title: FEE_FROM_SPREADSHEET } : dash;
}

export function factCells(row: FactSource, today: string): FactCells {
  const fees = row.fees;
  const oa: FactCell =
    row.kind === "lead"
      ? dash
      : row.officeActionDue === undefined
        ? failed
        : row.officeActionDue === null
          ? dash
          : {
              text: `${shortDate(row.officeActionDue.dueDate, today)}${row.officeActionDue.confirmed ? "" : COL_UNCONFIRMED_SUFFIX}`,
              tone: "value",
              overdue: row.officeActionDue.dueDate < today,
            };
  return {
    serial: row.serialNumber ? { text: row.serialNumber, tone: "value" } : dash,
    start: row.startDate ? { text: shortDate(row.startDate, today), tone: "value" } : dash,
    practiceArea: row.practiceArea ? { text: row.practiceArea, tone: "value" } : dash,
    oaDue: oa,
    // An absent `fees` on a row the page asked fees for means the read failed; the money columns are only drawn for a viewer who may see them.
    legalFee: fees ? money(fees.legal) : failed,
    legalFeeDue: fees ? ledgerDate(fees.legalDue) : failed,
    govFee: fees ? money(fees.gov) : failed,
    govFeeDue: fees ? ledgerDate(fees.govDue) : failed,
  };
}
