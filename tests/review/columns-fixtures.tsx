import { renderToStaticMarkup } from "react-dom/server";
import { row, TODAY } from "./fixtures";
import type { SheetPerms } from "@/lib/review/sheet-edit";
import type { PrefsDocument } from "@/lib/review/column-prefs-storage";

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

export async function renderReadOnly(opts: { canSeeMoney: boolean; initialPrefs?: PrefsDocument; rows?: typeof rows }) {
  const { SheetView } = await import("@/components/review/SheetView");
  return renderToStaticMarkup(
    <div className="rv-root"><SheetView rows={opts.rows ?? rows} owner={false} today={TODAY} members={members} canWrite={false} params={params} canSeeMoney={opts.canSeeMoney} initialPrefs={opts.initialPrefs} /></div>,
  );
}

export async function renderOwnerSheet(opts: { canSeeMoney: boolean; initialPrefs?: PrefsDocument; perms?: SheetPerms; rows?: typeof rows }) {
  const { SheetEdit } = await import("@/components/review/SheetEdit");
  const perms = opts.perms ?? OWNER_PERMS;
  return renderToStaticMarkup(
    <div className="rv-owner"><SheetEdit rows={opts.rows ?? rows} perms={perms} owner today={TODAY} members={members} canWrite={perms.writeMatter} params={params} canSeeMoney={opts.canSeeMoney} initialPrefs={opts.initialPrefs} /></div>,
  );
}

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
