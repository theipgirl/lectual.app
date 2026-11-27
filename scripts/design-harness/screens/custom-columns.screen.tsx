import ReviewPage from "@/app/dashboard/review/page";
import { ReviewCardAside } from "@/components/review/ReviewCardExtras";
import { sheetStatusStore } from "@/components/review/sheet-status-store";
import type { SheetEditInitial } from "@/components/review/SheetEditTable";
import type { ReviewRow } from "@/lib/review/buckets";
import type { StageChoice } from "@/lib/review/sheet-edit";
import { firmColumnsBlock, type CustomColumnsState, type CustomValue } from "@/lib/custom-columns/rules";
import { state } from "../state";
import { OWNER_ID, resetState, review } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

/**
 * Sprint 3: the owner Sheet with custom-cell editors open beside the Sprint 1 Source and Next step editors (for the computed-style
 * comparison), and the opened card's editable Firm columns. (Settings -> Columns is gone: columns are changed from the List's own menu.) Not a design board: checked by
 * `columns-check.mjs`. Invented names only.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const F = { fee: id(7101), priority: id(7102) };

/* ── The owner Sheet with custom editors open ── */
const contact = (date: string) => ({ date, type: "email_sent" }) as ReviewRow["lastContact"];
function row(n: number, over: Partial<ReviewRow> & Pick<ReviewRow, "client">): ReviewRow {
  const kind = over.kind ?? "matter";
  return { key: `${kind}:${n}`, kind, id: id(n), href: "#", mark: null, stageLabel: null, stageDays: null, stageNote: null, stageOrder: n, assignedTo: null, contactKnown: true, lastContact: contact("2026-11-05"), waiting: "us", lastDirection: null, nextStep: null, deadline: null, ...over };
}
const rows: ReviewRow[] = [
  row(1, { client: "Acme Studio", mark: "ACME", stageLabel: "Filed", stageId: id(601), source: "Referral", nextStep: { id: id(901), title: "Send the filing receipt", dueDate: "2026-11-14", assigneeId: OWNER_ID } }),
  row(2, { client: "Northwind Tea", mark: "NORTHWIND", stageLabel: "Filed", stageId: id(601), source: "Website" }),
  row(3, { kind: "lead", client: "Bluebird Bakery", mark: "BLUEBIRD", stageLabel: "Consult booked", stageId: id(501), source: "Event" }),
  row(4, { client: "Cedar Works", mark: "CEDAR", stageLabel: "Filed", stageId: id(601), source: "Referral", nextStep: { id: id(904), title: "Call about the specimen", dueDate: "2026-11-18", assigneeId: OWNER_ID } }),
];
const v = (vid: string, over: Partial<CustomValue> & { fieldId: string }): CustomValue => ({ id: vid, leadId: null, matterId: null, text: null, date: null, cents: null, choice: null, userId: null, updatedAt: "2026-11-01T10:00:00Z", ...over });
const CUSTOM: CustomColumnsState = {
  status: "ok",
  fields: [
    { id: F.priority, section: "trademarks", label: "Priority", kind: "choice", position: 0, options: ["High", "Medium", "Low"] },
    { id: F.fee, section: "both", label: "Quoted fee", kind: "money", position: 1, options: [] },
  ],
  values: [v("v1", { fieldId: F.priority, matterId: id(1), choice: "High" }), v("v2", { fieldId: F.fee, matterId: id(2), cents: 125000 })],
  mergedInto: {},
  leadOfMatter: {},
};
const OPEN: SheetEditInitial = {
  open: [
    { rowKey: "matter:1", col: `cf:${F.priority}` },
    { rowKey: "matter:2", col: `cf:${F.fee}` },
    { rowKey: "lead:3", col: "source" },
    { rowKey: "matter:4", col: "next" },
  ],
};
const LEAD_STAGES: StageChoice[] = [{ id: id(501), name: "Consult booked", category: "open" }];
const MATTER_STAGES: StageChoice[] = [{ id: id(601), name: "Filed" }];
const prepareSheet = () => {
  resetState();
  state.pathname = "/dashboard/review/";
  state.review = { ...review, rows, custom: CUSTOM } as typeof review;
  Object.assign(state, { sheetStages: { matter: MATTER_STAGES, lead: LEAD_STAGES }, sheetEditInitial: OPEN });
  sheetStatusStore.set(null);
};

/* ── The opened card's editable Firm columns (an attorney) ── */
const card = () => {
  const block = firmColumnsBlock(CUSTOM, { kind: "matter", id: id(1), matterType: "TM" }, [{ userId: OWNER_ID, name: "Rebecca Ames" }], "2026-11-10", true);
  return (
    <div className="lx-card" style={{ maxWidth: 420, margin: 24, padding: 20 }}>
      <ReviewCardAside open={{ kind: "matter", id: id(1) }} row={rows[0]} members={[{ userId: OWNER_ID, name: "Rebecca Ames" }]} today="2026-11-10" stagesFailed={false} closeStages={[]} firmColumns={block} />
    </div>
  );
};

export const screens: Screen[] = [
  {
    id: "review-sheet-edit-custom",
    title: "Owner Sheet: Priority (choice) and Quoted fee (money) editors open, beside Source and Next step",
    designBoard: "none",
    viewport: "desktop",
    pathname: "/dashboard/review/",
    prepare: prepareSheet,
    render: async () => <OwnerShell>{await ReviewPage({ searchParams: Promise.resolve({ view: "sheet" }) })}</OwnerShell>,
    shell: "none",
  },
  { id: "record-card-firm-columns-edit", title: "Opened card: Firm columns, editable (attorney)", designBoard: "none", viewport: "desktop", pathname: "/dashboard/review/", prepare: () => resetState(), render: card, shell: "none" },
];
