import { renderToStaticMarkup } from "react-dom/server";
import { row, TODAY } from "./fixtures";
import type { SheetPerms } from "@/lib/review/sheet-edit";
import type { CustomColumnsState, CustomField, CustomMember, CustomValue } from "@/lib/custom-columns/rules";

export { TODAY };

/** Invented names only: a trademark matter, a contracts matter and a lead, with every Sprint 1 fact filled in. */
export const FEES = { legal: { text: "$1,250.00", from: "proposal" as const }, legalDue: "Dec 1", gov: { text: "$700.00", from: "proposal" as const }, govDue: null };
export const members = [
  { userId: "u-reb", name: "Rebecca Ames", role: "owner" },
  { userId: "u-sam", name: "Sam Park", role: "paralegal" },
];
export const rows = [
  row({
    key: "m-tm", client: "Acme Studio", mark: "NORTHWIND", matterType: "TM", stageLabel: "Application Filed", source: "Referral",
    serialNumber: "99000001", startDate: "2026-03-04", practiceArea: "Trademark (TM)", officeActionDue: { dueDate: "2026-10-30", confirmed: false },
    fees: FEES, nextStep: { id: "00000000-0000-4000-8000-000000000003", title: "Call back", dueDate: "2026-11-20", assigneeId: "u-sam" },
  }),
  row({
    key: "m-bl", client: "Birch Goods", mark: "Supply agreement", matterType: "BL", stageLabel: "Drafting", id: "00000000-0000-4000-8000-0000000000b1",
    serialNumber: null, startDate: "2026-02-10", practiceArea: "Business law (BL)", officeActionDue: null, fees: { legal: { text: "$4,750", from: "spreadsheet" }, legalDue: "2026-12-01", gov: null, govDue: null },
  }),
  row({
    key: "l-1", kind: "lead", id: "00000000-0000-4000-8000-0000000000d1", client: "Jo Lee", company: "Cedar Works", stageLabel: "Consultation Scheduled", nextStep: null,
    startDate: "2026-09-30", fees: { legal: null, legalDue: null, gov: null, govDue: null },
  }),
];
export const params = { view: "sheet", who: "all", kind: "both", q: "", i: 1, person: null, open: null, since: "default" } as never;
export const STAGE = "00000000-0000-4000-8000-000000000009";
export const OWNER_PERMS: SheetPerms = { writeMatter: true, writeLead: true, moveLead: true, matterStages: [{ id: STAGE, name: "Filed" }], leadStages: [{ id: STAGE, name: "Consult", category: "open" }] };

type CustomOpts = { custom?: CustomColumnsState | null; customMembers?: CustomMember[] | null };

/** `canSeeCustomMoney` defaults to `canSeeMoney` here: the fixture viewer is a real owner (staff are tested on the page). */
export async function renderReadOnly(opts: { canSeeMoney: boolean; canSeeCustomMoney?: boolean; rows?: typeof rows } & CustomOpts) {
  const { SheetView } = await import("@/components/review/SheetView");
  return renderToStaticMarkup(
    <div className="rv-root"><SheetView rows={opts.rows ?? rows} owner={false} today={TODAY} members={members} canWrite={false} params={params} canSeeMoney={opts.canSeeMoney} canSeeCustomMoney={opts.canSeeCustomMoney ?? opts.canSeeMoney} custom={opts.custom} customMembers={opts.customMembers} /></div>,
  );
}

export async function renderOwnerSheet(opts: { canSeeMoney: boolean; canSeeCustomMoney?: boolean; perms?: SheetPerms; rows?: typeof rows } & CustomOpts) {
  const { SheetEdit } = await import("@/components/review/SheetEdit");
  const perms = opts.perms ?? OWNER_PERMS;
  return renderToStaticMarkup(
    <div className="rv-owner"><SheetEdit rows={opts.rows ?? rows} perms={perms} owner today={TODAY} members={members} canWrite={perms.writeMatter} params={params} canSeeMoney={opts.canSeeMoney} canSeeCustomMoney={opts.canSeeCustomMoney ?? opts.canSeeMoney} custom={opts.custom} customMembers={opts.customMembers} /></div>,
  );
}

/* ── Sprint 2: the firm's custom columns over the same three rows (invented data only) ── */

export const CF = {
  priority: "00000000-0000-4000-8000-00000000c001",
  signed: "00000000-0000-4000-8000-00000000c002",
  review: "00000000-0000-4000-8000-00000000c003",
  quote: "00000000-0000-4000-8000-00000000c004",
  reviewer: "00000000-0000-4000-8000-00000000c005",
  note: "00000000-0000-4000-8000-00000000c006",
};
/** The lead behind the TM matter (not a review row) and a duplicate merged into the review's lead. */
export const TM_LEAD = "00000000-0000-4000-8000-00000000e001";
export const DUP_LEAD = "00000000-0000-4000-8000-00000000e002";
const TM_ID = rows[0].id;
const BL_ID = rows[1].id;
const LEAD_ID = rows[2].id;

export const customFields: CustomField[] = [
  // Positions out of label order on purpose: the drawn order is position, then label.
  { id: CF.note, section: "trademarks", label: "Brand note", kind: "text", position: 5, options: [] },
  { id: CF.priority, section: "trademarks", label: "Priority", kind: "choice", position: 1, options: ["High", "Low"] },
  { id: CF.signed, section: "contracts", label: "Signed on", kind: "date", position: 2, options: [] },
  { id: CF.review, section: "both", label: "Review cycle", kind: "text", position: 3, options: [] },
  { id: CF.quote, section: "trademarks", label: "Quoted fee", kind: "money", position: 4, options: [] },
  { id: CF.reviewer, section: "trademarks", label: "Reviewer", kind: "person", position: 6, options: [] },
];

const v = (id: string, over: Partial<CustomValue> & { fieldId: string }): CustomValue => ({ id, leadId: null, matterId: null, text: null, date: null, cents: null, choice: null, userId: null, updatedAt: "2026-11-01T10:00:00Z", ...over });

export const customValues: CustomValue[] = [
  // TM matter: Priority only on its lead (shown "From the lead"), its own Review cycle, a person on the lead.
  v("v01", { fieldId: CF.priority, leadId: TM_LEAD, choice: "High" }),
  v("v02", { fieldId: CF.review, matterId: TM_ID, text: "Quarterly" }),
  v("v03", { fieldId: CF.quote, matterId: TM_ID, cents: 125000 }),
  v("v04", { fieldId: CF.reviewer, matterId: TM_ID, userId: "u-sam" }),
  // BL matter: its own date, and a both field.
  v("v05", { fieldId: CF.signed, matterId: BL_ID, date: "2026-10-15" }),
  v("v06", { fieldId: CF.review, matterId: BL_ID, text: "Yearly" }),
  // The review's lead: a choice no longer in the options (verbatim), a note on a merged duplicate.
  v("v07", { fieldId: CF.priority, leadId: LEAD_ID, choice: "Urgent (old)" }),
  v("v08", { fieldId: CF.note, leadId: DUP_LEAD, text: "Met at the expo" }),
  // A person no longer on the team, on the lead.
  v("v09", { fieldId: CF.reviewer, leadId: LEAD_ID, userId: "u-gone" }),
];

export const customFixture: CustomColumnsState = {
  status: "ok",
  fields: customFields,
  values: customValues,
  mergedInto: { [DUP_LEAD]: LEAD_ID },
  leadOfMatter: { [TM_ID]: TM_LEAD },
};

/* ── tiny HTML readers (the markup is machine-written and regular) ── */
const text = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

/** The header words of each `<table>` of a render, in order, in the order drawn. */
export function tableHeaders(html: string): string[][] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((t) => {
    const head = /<thead>([\s\S]*?)<\/thead>/.exec(t[0])?.[1] ?? "";
    return [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1])).filter((h) => h !== "Note");
  });
}

/** The `<tr>` holding `needle` (a client name), whole. */
export function rowOf(html: string, needle: string): string {
  const at = html.indexOf(needle);
  const start = html.lastIndexOf("<tr", at);
  return html.slice(start, html.indexOf("</tr>", at) + 5);
}

/** The `<td>` carrying this data-label inside a row, or "". */
export function cellOf(rowHtml: string, label: string): string {
  const m = new RegExp(`<td data-label="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?</td>`).exec(rowHtml);
  return m?.[0] ?? "";
}

export const labelsOf = (rowHtml: string) => [...rowHtml.matchAll(/<td data-label="([^"]*)"/g)].map((m) => m[1]);
export { text };
