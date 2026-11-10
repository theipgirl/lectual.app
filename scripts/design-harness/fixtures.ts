/**
 * Sample data for the owner screens. INVENTED names only (the mockups' own: Maya Chen, CRUMB & CO., Lena Ortiz ...).
 * The clock is frozen at Monday 10 Nov 2026, 9:30 AM Eastern (render.render.tsx).
 */
import type { User } from "@supabase/supabase-js";
import type { QueueItem } from "@/lib/queue/api";
import type { MemberIdentity } from "@/lib/members/directory";
import type { ReviewRow } from "@/lib/review/buckets";
import type { ReviewLoad } from "@/lib/review/load";
import type { ConsultItem } from "@/lib/calendar/consult-sources";
import type { OwnerDeadline, OwnerProposal } from "@/lib/today/owner-rules";
import type { FirmSession } from "@/lib/firm/session";

export const NOW = new Date("2026-11-10T14:30:00Z");
export const ORG = { id: "00000000-0000-4000-8000-000000000001", name: "RPB Law", slug: "rpb", modules: ["role-views", "mailbox", "proposals", "agents", "document-center", "agent-toolkit"] };
export const OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
export const MODULES = ORG.modules;

export const members: MemberIdentity[] = [
  { userId: OWNER_ID, email: "rebecca@rpb.example", displayName: "Rebecca Ames", role: "owner", identified: true },
  { userId: "00000000-0000-4000-8000-0000000000a2", email: "dana@rpb.example", displayName: "Dana Brook", role: "admin", identified: true },
  { userId: "00000000-0000-4000-8000-0000000000a3", email: "sam@rpb.example", displayName: "Sam Ortiz", role: "paralegal", identified: true },
];

export const user = { id: OWNER_ID, email: "rebecca@rpb.example", user_metadata: { full_name: "Rebecca Ames" } } as unknown as User;

export const session: FirmSession = {
  kind: "ok",
  user,
  member: { role: "owner", org_id: ORG.id },
  org: ORG,
  role: "owner",
  isPlatformAdmin: false,
  actingAsStaff: false,
  switchableFirms: [],
  displayName: "Rebecca Ames",
};

/* ── Today ── */
export const consults: ConsultItem[] = [
  { key: "outlook:1", source: "outlook", title: "Strategy session · Maya Chen", startsAt: "2026-11-10T16:00:00Z", allDay: false, joinUrl: "https://zoom.example/j/111", leadId: null, leadName: "Maya Chen" },
  { key: "outlook:2", source: "outlook", title: "Discovery call · Jonah Reyes", startsAt: "2026-11-10T19:30:00Z", allDay: false, joinUrl: null, leadId: null, leadName: "Jonah Reyes" },
];
export const deadlines: OwnerDeadline[] = [
  { key: "d1", href: "/dashboard/matters/m1/", name: "Office action response", detail: "TM-1042 · LUMEN TEA", dueDate: "2026-11-09", overdueDays: 1 },
  { key: "d2", href: "/dashboard/matters/m2/", name: "Statement of use", detail: "TM-1038 · OAT & ORCHARD", dueDate: "2026-11-12", overdueDays: 0 },
  { key: "d3", href: "/dashboard/matters/m3/", name: "Registration maintenance", detail: "TM-0991 · NORTHFIELD GOODS", dueDate: "2026-11-17", overdueDays: 0 },
  { key: "d4", href: "/dashboard/matters/m4/", name: "Extension request", detail: "TM-1020 · HALCYON PRESS", dueDate: "2026-11-21", overdueDays: 0 },
];
export const proposals: OwnerProposal[] = [
  { id: "p1", href: "/dashboard/proposals/p1/", client: "Maya Chen", title: "CRUMB & CO. · Enhanced", expiry: "Last day Nov 11", expired: false, expiresOn: "2026-11-11" },
  { id: "p2", href: "/dashboard/proposals/p2/", client: "Lena Ortiz", title: "HALCYON PRESS · Essential", expiry: "Expired Nov 5", expired: true, expiresOn: "2026-11-05" },
];

/* ── Approval deck ── */
const base = {
  org_id: ORG.id,
  matter_id: null,
  summary: null,
  final_body: null,
  status: "pending" as const,
  subject: null,
  proposed_send_at: null,
  attachments: null,
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
};
export function queueItem(over: Partial<QueueItem> & Pick<QueueItem, "id" | "headline">): QueueItem {
  return { ...base, agent: "post-consult", type: "CLIENT_EMAIL", draft_body: "", created_at: "2026-11-10T10:00:00Z", client_name: null, recipient: null, ...over };
}
export const pending: QueueItem[] = [
  queueItem({
    id: "q1",
    headline: "Send Maya Chen her proposal for CRUMB & CO.",
    client_name: "Maya Chen",
    recipient: "maya@crumbandco.example",
    summary: "First step: Check the package. Enhanced was named on the call.",
    draft_body: "Hi Maya,\n\nThank you for meeting with us on the 9th. As promised, your proposal is ready to review at the link below.\n\nBest,\nRebecca",
    created_at: "2026-11-10T09:00:00Z",
  }),
  queueItem({ id: "q2", headline: "Follow up with Sam Lee about LUMEN TEA", agent: "morning-brief", type: "CLIENT_EMAIL", client_name: "Sam Lee", recipient: "sam@lumentea.example", draft_body: "Hi Sam,\n\nJust checking in on the next step for LUMEN TEA.\n\nBest,\nRebecca", created_at: "2026-11-10T09:05:00Z" }),
  queueItem({ id: "q3", headline: "Morning brief for Monday, Nov 10", agent: "morning-brief", type: "BRIEFING", draft_body: "For the firm only. 2 consults today, 4 deadlines in the next 14 days, 6 cards waiting on you.", created_at: "2026-11-10T09:10:00Z" }),
  queueItem({ id: "q4", headline: "Welcome Lena Ortiz to the firm", agent: "welcome", client_name: "Lena Ortiz", recipient: "lena@halcyonpress.example", draft_body: "Hi Lena,\n\nWelcome aboard.", created_at: "2026-11-10T09:15:00Z" }),
  queueItem({ id: "q5", headline: "Filing follow-up for NORTHFIELD GOODS", agent: "filing-followup", client_name: "Jonah Reyes", recipient: "jonah@northfield.example", draft_body: "Hi Jonah,\n\nYour application was filed.", created_at: "2026-11-10T09:20:00Z" }),
  queueItem({ id: "q6", headline: "Reply to Priya Nair about OAT & ORCHARD", agent: "inbox-summary", client_name: "Priya Nair", recipient: "priya@oatorchard.example", draft_body: "Hi Priya,\n\nThanks for your note.", created_at: "2026-11-10T09:25:00Z" }),
];
export const approved: QueueItem[] = [
  queueItem({ id: "q7", headline: "Engagement letter for HALCYON PRESS", status: "approved", client_name: "Lena Ortiz", resolved_by: "rebecca@rpb.example", resolved_at: "2026-11-10T13:00:00Z", agent: "document-center", type: "ENGAGEMENT_LETTER" }),
];

/* ── Weekly review ── */
export const REVIEW_TODAY = "2026-11-10";
const contact = (date: string, type: "email_sent" | "email_received" = "email_sent") => ({ date, type }) as ReviewRow["lastContact"];
function row(over: Partial<ReviewRow> & Pick<ReviewRow, "id" | "client">): ReviewRow {
  return {
    key: `${over.kind ?? "matter"}:${over.id}`,
    kind: "matter",
    href: "#",
    mark: null,
    stageLabel: null,
    stageDays: null,
    stageNote: null,
    stageOrder: 1,
    assignedTo: null,
    contactKnown: true,
    lastContact: contact("2026-11-05"),
    waiting: null,
    lastDirection: null,
    nextStep: null,
    deadline: null,
    ...over,
  };
}
const ME = OWNER_ID;
const DANA = members[1].userId;
const SAM = members[2].userId;
export const reviewRows: ReviewRow[] = [
  row({ id: "r1", client: "Maya Chen", kind: "lead", mark: "CRUMB & CO.", stageLabel: "Proposal sent", nextStep: { id: "t1", title: "Call about the proposal", dueDate: "2026-11-07", assigneeId: ME }, waiting: "us", proposalExpiry: { text: "Proposal expires Nov 11", expiresOn: "2026-11-11", expired: false } as ReviewRow["proposalExpiry"] }),
  row({ id: "r2", client: "Lena Ortiz", mark: "HALCYON PRESS", stageLabel: "Awaiting filing", nextStep: { id: "t2", title: "Send filing receipt", dueDate: "2026-11-12", assigneeId: ME }, waiting: "us" }),
  row({ id: "r3", client: "Sam Lee", kind: "lead", mark: "LUMEN TEA", stageLabel: "Consult held", nextStep: null, waiting: "us", stageDays: 9 }),
  row({ id: "r4", client: "Jonah Reyes", mark: "NORTHFIELD GOODS", stageLabel: "Office action", nextStep: { id: "t4", title: "Review examiner letter", dueDate: "2026-11-13", assigneeId: DANA }, waiting: "client", lastOutbound: "2026-11-04", lastContact: contact("2026-11-04") }),
  row({ id: "r5", client: "Priya Nair", mark: "OAT & ORCHARD", stageLabel: "Statement of use", nextStep: { id: "t5", title: "Confirm specimen", dueDate: "2026-11-19", assigneeId: DANA }, waiting: "client", lastOutbound: "2026-10-28", lastContact: contact("2026-10-28") }),
  row({ id: "r6", client: "Theo Marsh", mark: "BLUE HERON", stageLabel: "Published", nextStep: { id: "t6", title: "Watch for opposition", dueDate: "2026-12-01", assigneeId: SAM }, waiting: "uspto", deadline: { dueDate: "2026-12-01", title: "Opposition window" } }),
  row({ id: "r7", client: "Ines Walker", kind: "lead", mark: "PAPER MOON", stageLabel: "Questionnaire sent", nextStep: { id: "t7", title: "Nudge for the questionnaire", dueDate: "2026-11-08", assigneeId: SAM }, waiting: "us" }),
  row({ id: "r8", client: "Omar Haddad", mark: "SALT LINE", stageLabel: "Filed", nextStep: { id: "t8", title: "Check status", dueDate: "2026-12-10", assigneeId: null }, assignedTo: SAM, lastContact: contact("2026-11-09") }),
];
export const review: ReviewLoad = {
  status: "ok",
  rows: reviewRows,
  today: REVIEW_TODAY,
  timeZone: "America/New_York",
  members: members.map((m) => ({ userId: m.userId, name: m.displayName ?? "", role: m.role })),
  failed: [],
  closeStages: [],
};

/* ── Default loader state; screens override pieces in prepare() ── */
import { state } from "./state";
export function resetState() {
  Object.assign(state, {
    pathname: "/dashboard/",
    pending,
    approved,
    rejected: [],
    cardState: { status: "ok", events: [] },
    deckSummary: { status: "ok", count: 6, minutes: 8, dealLabel: "7:00 AM", nextDealLabel: "2:00 PM", laterArrivals: 0 },
    consults: { consults, outlook: "ok", zoom: "ok" },
    deadlines,
    proposals,
    review,
  });
}
