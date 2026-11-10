import ReviewPage from "@/app/dashboard/review/page";
import { sheetStatusStore } from "@/components/review/sheet-status-store";
import type { SheetEditInitial } from "@/components/review/SheetEditTable";
import type { ReviewRow } from "@/lib/review/buckets";
import type { StageChoice } from "@/lib/review/sheet-edit";
import { state } from "../state";
import { OWNER_ID, resetState, review } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

/** Board 19b, "Weekly review: Sheet, editable". Invented names only (the board's own). */
const CAIT = "00000000-0000-4000-8000-0000000000c2";
const JULES = "00000000-0000-4000-8000-0000000000c3";
const MARCUS = "00000000-0000-4000-8000-0000000000c4";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const contact = (date: string) => ({ date, type: "email_sent" }) as ReviewRow["lastContact"];

function row(n: number, over: Partial<ReviewRow> & Pick<ReviewRow, "client">): ReviewRow {
  const kind = over.kind ?? "matter";
  return {
    key: `${kind}:${n}`,
    kind,
    id: id(n),
    href: "#",
    mark: null,
    stageLabel: null,
    stageDays: null,
    stageNote: null,
    stageOrder: n,
    assignedTo: null,
    contactKnown: true,
    lastContact: contact("2026-11-05"),
    waiting: "us",
    lastDirection: null,
    nextStep: null,
    deadline: null,
    ...over,
  };
}
const step = (n: number, title: string, dueDate: string | null, assigneeId: string | null) => ({ id: id(900 + n), title, dueDate, assigneeId });

const LEAD_STAGES: StageChoice[] = [
  { id: id(501), name: "Consult booked", category: "open" },
  { id: id(502), name: "Opinion letter", category: "open" },
  { id: id(503), name: "Proposal sent", category: "open" },
  { id: id(504), name: "Lost", category: "lost" },
  { id: id(505), name: "Nurture", category: "nurture" },
];
const MATTER_STAGES: StageChoice[] = [
  { id: id(601), name: "Filed" },
  { id: id(602), name: "Office action" },
  { id: id(603), name: "Awaiting registration" },
  { id: id(604), name: "Registered" },
];

const rows: ReviewRow[] = [
  row(1, { kind: "lead", client: "Maya Chen", mark: "CRUMB & CO.", stageLabel: "Proposal sent", stageId: id(503), nextStep: step(1, "Call about the proposal", "2026-11-12", OWNER_ID), waiting: "client", lastOutbound: "2026-11-07", lastContact: contact("2026-11-07"), source: "Website" }),
  row(2, { kind: "lead", client: "Sam Lee", mark: "LUMEN TEA", stageLabel: "Opinion letter", stageId: id(502), nextStep: step(2, "Answer Sam's two questions about class 30 and the opinion letter, then confirm the filing date", "2026-11-12", OWNER_ID), waiting: "approval", lastContact: contact("2026-11-09"), source: "Referral" }),
  row(3, { kind: "lead", client: "Lena Ortiz", mark: "FERN & FOLD", stageLabel: "Consult booked", stageId: id(501), nextStep: step(3, "Hold the discovery call", "2026-11-10", CAIT), waiting: "client", lastOutbound: "2026-11-06", lastContact: contact("2026-11-06"), source: "UGW" }),
  row(4, { client: "Jordan Park", mark: "NORTHFIELD", stageLabel: "Office action", stageId: id(602), nextStep: step(4, "Sign the response", "2026-11-07", OWNER_ID), lastContact: contact("2026-11-03"), source: "Referral" }),
  row(5, { client: "Ana Ruiz", mark: "HALCYON ROAST", stageLabel: "Section 8", nextStep: step(5, "Ask for a new specimen", "2026-11-13", CAIT), lastContact: contact("2026-10-28"), source: "Inbound" }),
  row(6, { client: "Theo Grant", mark: "BRIGHTLINE", stageLabel: "Awaiting registration", stageId: id(603), waiting: "uspto", lastContact: contact("2026-09-30"), source: "Search engine" }),
  row(7, { client: "Priya Shah", mark: "PALOMA STUDIO", stageLabel: "Signed LOE", nextStep: step(7, "Approve engagement letter", null, OWNER_ID), waiting: "approval", lastContact: contact("2026-11-08"), source: "Event" }),
  row(8, { client: "Ines Duarte", matterType: "BL", stageLabel: "Proposal sent", nextStep: step(8, "Follow up", "2026-11-14", CAIT), waiting: "client", contactKnown: false, lastContact: null, source: "Referral" }),
  row(9, { client: "Kofi Mensah", matterType: "BL", stageLabel: "Drafting agreement", nextStep: step(9, "Send first draft", "2026-11-17", OWNER_ID), lastContact: contact("2026-11-05"), source: "Website" }),
];
const members = [
  { userId: OWNER_ID, name: "Rebecca Ames", role: "owner" },
  { userId: CAIT, name: "Caitlyn Ross", role: "paralegal" },
  { userId: JULES, name: "Jules Tran", role: "attorney" },
  { userId: MARCUS, name: "Marcus Hale", role: "intake" },
];

const OPEN: SheetEditInitial = {
  open: [
    { rowKey: "lead:1", col: "next" },
    { rowKey: "matter:4", col: "court" },
    { rowKey: "matter:5", col: "note" },
    { rowKey: "matter:6", col: "status" },
  ],
  nextDraft: { "lead:1": { title: "Follow up on the proposal", dueDate: "2026-11-14" } },
  noteDraft: { "matter:5": "Called Ana, new specimen coming Friday." },
  activeColumn: "next",
  activeRow: "lead:2",
};

/** Popovers on the bottom rows (they must flip up and stay fully visible; placed in the browser by scripts/design-harness: see the README note in the report). */
const LAST_ROW = (col: "note" | "status" | "court" | "source"): SheetEditInitial => ({ open: [{ rowKey: "matter:9", col }], noteDraft: { "matter:9": "Sent the first draft; waiting on comments." } });
const lastRowPrepare = (col: "note" | "status" | "court" | "source") => () => {
  prepare(false)();
  Object.assign(state, { sheetEditInitial: LAST_ROW(col) });
};

const prepare = (withEditors: boolean) => () => {
  resetState();
  state.pathname = "/dashboard/review/";
  state.review = { ...review, rows, members } as typeof review;
  Object.assign(state, { sheetStages: { matter: MATTER_STAGES, lead: LEAD_STAGES }, sheetEditInitial: withEditors ? OPEN : undefined });
  sheetStatusStore.set(withEditors ? { tone: "saved", client: "Lena Ortiz", field: "next" } : null);
};
const render = async () => <OwnerShell>{await ReviewPage({ searchParams: Promise.resolve({ view: "sheet" }) })}</OwnerShell>;
const base = { designBoard: "ReviewSheetEdit", pathname: "/dashboard/review/", render };

export const screens: Screen[] = [
  { ...base, id: "review-sheet-edit", title: "Weekly review, Sheet editable (editors open as on the board)", viewport: "desktop", prepare: prepare(true) },
  { ...base, id: "review-sheet-edit-rest", title: "Weekly review, Sheet editable (at rest)", viewport: "desktop", prepare: prepare(false) },
  { ...base, id: "review-sheet-edit-phone", title: "Weekly review, Sheet editable (phone: stacked, edits in the panel)", viewport: "phone", prepare: prepare(false) },
  { ...base, id: "review-sheet-edit-lastrow-note", title: "Weekly review, Sheet editable: + Note popover on the last row", viewport: "desktop", prepare: lastRowPrepare("note") },
  { ...base, id: "review-sheet-edit-lastrow-court", title: "Weekly review, Sheet editable: person picker on the last row", viewport: "desktop", prepare: lastRowPrepare("court") },
];
