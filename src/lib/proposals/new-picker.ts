import type { RecordKind } from "@/lib/skills/catalog";
import { leadRecord, matterRecord, normalizeTerm, pickRecords, SEARCH_MAX, type PickRecord } from "@/lib/skills/pick";
import { leadOptionLabel, type LeadLabelRow } from "./lead-label";

/**
 * The "Who is this for?" picker on New proposal. PURE: it takes the two list
 * reads the page already made and builds what the picker draws, so the rules
 * (which list, which search, how many rows, what each link says) are tested
 * without a database.
 *
 * It reuses the Skills picker's helpers as they are. A failed read is its own
 * state for that kind only, never an empty list, and no link carries anything
 * about a record beyond its id (plus the person's own typed search, so Change
 * can return to it).
 */

export const NEW_PROPOSAL_PATH = "/dashboard/proposals/new/";
export { SEARCH_MAX };

/** A list read by the page. A failed read is never `ok` with no records. */
export type ListRead = { status: "ok"; records: PickRecord[] } | { status: "failed" };

export type PickerRow = { id: string; label: string; detail: string | null; href: string };
export type PickerList = { status: "ok"; rows: PickerRow[]; total: number } | { status: "failed" };

export type PickerView = {
  kind: RecordKind;
  /** The trimmed, capped search term (empty when none). */
  term: string;
  /** The selected kind's list, or its failure. */
  list: PickerList;
  /** Kinds whose read failed, selected or not; each is named so a dead tab is never a surprise. */
  failed: RecordKind[];
  switchHrefs: Record<RecordKind, string>;
  blankHref: string;
};

/** `kind` from the URL: only "matter" selects matters; anything else is leads. */
export function pickerKind(raw: string | string[] | undefined | null): RecordKind {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first === "matter" ? "matter" : "lead";
}

/** A lead as the proposals picker names it (the same label the transcript picker uses). */
export function proposalLeadRecord(lead: LeadLabelRow): PickRecord {
  const label = leadOptionLabel(lead);
  const email = lead.email?.trim() || null;
  return { ...leadRecord(lead), label, detail: email && email !== label ? email : null };
}

export { matterRecord as proposalMatterRecord };

function withTerm(base: string, term: string): string {
  return term ? `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(term)}` : base;
}

/** The link that chooses a record: its id, URL-encoded, and the person's own search. Nothing else about the record. */
export function chooseHref(kind: RecordKind, id: string, term = ""): string {
  return withTerm(`${NEW_PROPOSAL_PATH}?${kind}=${encodeURIComponent(id)}`, normalizeTerm(term));
}

/** The picker itself, on the given kind and search. */
export function pickerHref(kind: RecordKind, term = ""): string {
  return withTerm(`${NEW_PROPOSAL_PATH}?kind=${kind}`, normalizeTerm(term));
}

/** The empty form with no list: "Start blank". */
export const BLANK_HREF = `${NEW_PROPOSAL_PATH}?blank=1`;

export function buildPicker(input: { kind: RecordKind; term: string; leads: ListRead; matters: ListRead }): PickerView {
  const term = normalizeTerm(input.term);
  const read = input.kind === "lead" ? input.leads : input.matters;
  let list: PickerList;
  if (read.status === "failed") list = { status: "failed" };
  else {
    // Proposals can start from any matter, so no matter-type filter is passed.
    const picked = pickRecords(read.records, { matterTypes: undefined }, input.kind, term);
    list = {
      status: "ok",
      total: picked.total,
      rows: picked.shown.map((r) => ({ id: r.id, label: r.label, detail: r.detail, href: chooseHref(input.kind, r.id, term) })),
    };
  }
  const failed: RecordKind[] = [];
  if (input.leads.status === "failed") failed.push("lead");
  if (input.matters.status === "failed") failed.push("matter");
  return {
    kind: input.kind,
    term,
    list,
    failed,
    switchHrefs: { lead: pickerHref("lead", term), matter: pickerHref("matter", term) },
    blankHref: BLANK_HREF,
  };
}

/** "Showing 8 of 30." / "Showing 3 of 3." */
export function showingLine(shown: number, total: number): string {
  return `Showing ${shown} of ${total}.`;
}
