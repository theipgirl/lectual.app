import type { ReactElement } from "react";
import { OwnerToday } from "@/components/today/OwnerToday";
import DeckPage from "@/app/dashboard/queue/deck/page";
import QueueItemPage from "@/app/dashboard/queue/[id]/page";
import ReviewPage from "@/app/dashboard/review/page";
import IntakePage from "@/app/dashboard/intake/page";
import MattersPage from "@/app/dashboard/matters/page";
import MatterPage from "@/app/dashboard/matters/[id]/page";
import LeadPage from "@/app/dashboard/leads/[id]/page";
import PipelinePage from "@/app/dashboard/pipeline/page";
import ProposalsPage from "@/app/dashboard/proposals/page";
import MeetingsPage from "@/app/dashboard/meetings/page";
import CalendarPage from "@/app/dashboard/calendar/page";
import DocumentsPage from "@/app/dashboard/documents/page";
import NotificationsPage from "@/app/dashboard/notifications/page";
import AgentsPage from "@/app/dashboard/agents/page";
import ReportsIndexPage from "@/app/dashboard/reports/page";
import ReportPage from "@/app/dashboard/reports/[key]/page";
import SettingsLayout from "@/app/dashboard/settings/layout";
import IntegrationsPage from "@/app/dashboard/settings/integrations/page";
import TeamPage from "@/app/dashboard/settings/team/page";
import { L, M, tables } from "../mono-data";
import { NOW, OWNER_ID, ORG, pending, proposals, resetState, review, session } from "../fixtures";
import type { FirmSession } from "@/lib/firm/session";
import type { ReviewRow } from "@/lib/review/buckets";
import type { ReviewLoad } from "@/lib/review/load";
import { state } from "../state";
import { OwnerShell } from "../shell";
import { TechShell } from "../mono-shell";
import { screens as formsScreens } from "./forms-owner.screen";
import { screens as mergeScreens } from "./merge.screen";
import type { Screen } from "../registry";

/**
 * Visual review of the "one consistent look" job (2026-11-17): every page area the harness can reach, in the owner shell
 * at 1440 / 1280 / 375, plus the technician shell for the pages with a view switch. Ids `vr-<page>-<shell>-<d|m|p>`.
 * Shot by vr-shoot.mjs (measures the real layout, then lets the page grow for a full-page JPEG). INVENTED names only.
 */
type Render = () => Promise<ReactElement> | ReactElement;
type Page = { key: string; pathname: string; render: Render; prepare?: () => void; tech?: boolean };

const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
const a = (p: unknown) => p as Promise<ReactElement>;
const O = ORG.id;
const t = (d: string) => `2026-${d}`;

/** Sample rows for tables only these pages read (meetings, letters, notifications, assistant runs). */
const extra: Record<string, Record<string, unknown>[]> = {
  crm_meeting: [
    { id: "00000000-0000-4000-8000-00000000e001", org_id: O, provider: "zoom", title: "Strategy session · Maya Chen", started_at: t("11-09T15:00:00Z"), duration_seconds: 2460, attendees: [{ name: "Maya Chen", email: "maya@crumb.example" }], share_url: "https://zoom.us/rec/1", lead_id: L.maya, matter_id: null, suggested_lead_id: null, suggested_matter_id: null, link_source: "manual", summary: "x", transcript: [{ speaker: "A", text: "Hi" }] },
    { id: "00000000-0000-4000-8000-00000000e002", org_id: O, provider: "fathom", title: "Discovery call · Jonah Reyes", started_at: t("11-06T18:30:00Z"), duration_seconds: 1500, attendees: [], share_url: null, lead_id: null, matter_id: null, suggested_lead_id: L.jonah, suggested_matter_id: null, link_source: null, summary: null, transcript: null },
    { id: "00000000-0000-4000-8000-00000000e003", org_id: O, provider: "zoom", title: "Office action walkthrough · LUMEN TEA", started_at: t("11-03T16:00:00Z"), duration_seconds: 1800, attendees: [], share_url: null, lead_id: null, matter_id: M.lumen, suggested_lead_id: null, suggested_matter_id: null, link_source: "manual", summary: null, transcript: [{ speaker: "A", text: "Hi" }] },
  ],
  crm_document_draft: [
    { id: "00000000-0000-4000-8000-00000000f001", org_id: O, matter_id: M.lumen, doc_type: "opinion_letter", status: "queued", file_name: "LUMEN-TEA-opinion.docx", queue_item_id: "q2", error_message: null, created_at: t("11-09T15:00:00Z"), updated_at: t("11-09T15:00:00Z") },
    { id: "00000000-0000-4000-8000-00000000f002", org_id: O, matter_id: M.halcyon, doc_type: "loe_trademark_current", status: "generated", file_name: "HALCYON-PRESS-LOE.docx", queue_item_id: "q7", error_message: null, created_at: t("11-04T15:00:00Z"), updated_at: t("11-05T15:00:00Z") },
    { id: "00000000-0000-4000-8000-00000000f003", org_id: O, matter_id: M.north, doc_type: "trademark_clearance", status: "failed", file_name: null, queue_item_id: "q5", error_message: "template missing", created_at: t("10-30T15:00:00Z"), updated_at: t("10-30T15:00:00Z") },
  ],
  crm_notification: [
    { id: "00000000-0000-4000-8000-00000000c001", org_id: O, user_id: OWNER_ID, kind: "assigned", lead_id: L.maya, matter_id: null, activity_id: null, actor_id: "00000000-0000-4000-8000-0000000000a2", payload: { preview: "Maya Chen" }, read_at: null, created_at: t("11-10T13:00:00Z") },
    { id: "00000000-0000-4000-8000-00000000c002", org_id: O, user_id: OWNER_ID, kind: "lead_replied", lead_id: L.sam, matter_id: null, activity_id: null, actor_id: null, payload: { subject: "Re: your proposal" }, read_at: t("11-09T20:00:00Z"), created_at: t("11-09T19:00:00Z") },
    { id: "00000000-0000-4000-8000-00000000c003", org_id: O, user_id: OWNER_ID, kind: "time_running", lead_id: null, matter_id: M.lumen, activity_id: null, actor_id: null, payload: { title: "Office action response" }, read_at: null, created_at: t("11-08T12:00:00Z") },
  ],
  agent_setting: [
    { agent: "morning-brief", enabled: true, autonomy: "draft" },
    { agent: "stage-keeper", enabled: true, autonomy: "act" },
  ],
  agent_run: [
    { id: "00000000-0000-4000-8000-00000000b001", agent: "morning-brief", trigger: "cron", status: "ok", started_at: t("11-10T12:00:00Z"), finished_at: t("11-10T12:01:10Z"), items_in: 14, drafts_out: 3, summary: "Brief written; 3 follow-ups drafted.", error: null },
    { id: "00000000-0000-4000-8000-00000000b002", agent: "stage-keeper", trigger: "cron", status: "error", started_at: t("11-10T11:00:00Z"), finished_at: t("11-10T11:00:20Z"), items_in: 0, drafts_out: 0, summary: null, error: "Did not finish within the time limit" },
  ],
};

async function withExtra<T>(fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(extra).map((k) => [k, tables[k]]));
  Object.assign(tables, extra);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete tables[k];
      else tables[k] = v;
    }
  }
}

/** The sample review load is always "ok"; narrowed here so its rows can be read. */
const okReview = review as Extract<ReviewLoad, { status: "ok" }>;

/** A review row whose id is a real (fixture) matter id, so ?open= parses and the real record-card loader can read it. */
const openRow = { ...okReview.rows[1], id: M.lumen, key: `matter:${M.lumen}`, client: "Sam Lee", mark: "LUMEN TEA" } as ReviewRow;

const reuse = (list: Screen[], id: string): Pick<Page, "render" | "prepare"> => {
  const s = list.find((x) => x.id === id)!;
  return { prepare: s.prepare, render: s.render };
};

const pages: Page[] = [
  {
    key: "today",
    pathname: "/dashboard/",
    prepare: () => {
      state.proposals = proposals.map((p, i) => ({ ...p, title: p.title.split(" · ")[0], opens: i === 0 ? 2 : 0 }));
    },
    render: () => <OwnerToday userId={OWNER_ID} role="owner" email="rebecca@rpb.example" metadata={{ full_name: "Rebecca Ames" }} now={NOW} />,
  },
  { key: "approvals-cards", pathname: "/dashboard/queue/deck/", render: () => a(DeckPage({ searchParams: sp({ view: "cards", at: "q1" }) })) },
  { key: "approvals-list", pathname: "/dashboard/queue/deck/", render: () => a(DeckPage({ searchParams: sp({ view: "list" }) })) },
  { key: "approvals-board", pathname: "/dashboard/queue/deck/", render: () => a(DeckPage({ searchParams: sp({ view: "board" }) })) },
  { key: "approvals-item", pathname: "/dashboard/queue/q2/", prepare: () => (state.pending = pending), render: () => a(QueueItemPage({ params: Promise.resolve({ id: "q2" }), searchParams: sp() })) },
  { key: "review-board", pathname: "/dashboard/review/", render: () => a(ReviewPage({ searchParams: sp() })), tech: true },
  { key: "review-list", pathname: "/dashboard/review/", render: () => a(ReviewPage({ searchParams: sp({ view: "sheet" }) })), tech: true },
  { key: "review-cards", pathname: "/dashboard/review/", render: () => a(ReviewPage({ searchParams: sp({ view: "cards" }) })), tech: true },
  {
    key: "review-card",
    pathname: "/dashboard/review/",
    prepare: () => {
      state.review = { ...okReview, rows: [...okReview.rows, openRow] };
    },
    render: () => a(ReviewPage({ searchParams: sp({ open: `matter:${M.lumen}` }) })),
  },
  { key: "intake-board", pathname: "/dashboard/intake/", render: () => a(IntakePage({ searchParams: sp() })), tech: true },
  { key: "intake-list", pathname: "/dashboard/intake/", render: () => a(IntakePage({ searchParams: sp({ view: "table" }) })), tech: true },
  { key: "lead-page", pathname: `/dashboard/leads/${L.maya}/`, render: () => a(LeadPage({ params: Promise.resolve({ id: L.maya }), searchParams: sp() } as never)) },
  { key: "matters-board", pathname: "/dashboard/matters/", render: () => a(MattersPage({ searchParams: sp() })), tech: true },
  { key: "matters-list", pathname: "/dashboard/matters/", render: () => a(MattersPage({ searchParams: sp({ view: "table" }) })), tech: true },
  { key: "matter-page", pathname: `/dashboard/matters/${M.lumen}/`, render: () => a(MatterPage({ params: Promise.resolve({ id: M.lumen }) } as never)) },
  { key: "pipeline", pathname: "/dashboard/pipeline/", render: () => a(PipelinePage({ searchParams: sp() })) },
  { key: "proposals", pathname: "/dashboard/proposals/", render: () => a(ProposalsPage({ searchParams: sp() } as never)) },
  { key: "meetings", pathname: "/dashboard/meetings/", render: () => a(MeetingsPage({ searchParams: sp() })) },
  { key: "calendar-month", pathname: "/dashboard/calendar/", render: () => a(CalendarPage({ searchParams: sp({ d: "2026-11-10" }) })) },
  { key: "calendar-week", pathname: "/dashboard/calendar/", render: () => a(CalendarPage({ searchParams: sp({ view: "week", d: "2026-11-10" }) })) },
  { key: "documents", pathname: "/dashboard/documents/", render: () => a(DocumentsPage({ searchParams: sp() })) },
  { key: "notifications", pathname: "/dashboard/notifications/", render: () => a(NotificationsPage({ searchParams: sp() } as never)) },
  { key: "assistants", pathname: "/dashboard/agents/", render: () => a(AgentsPage()) },
  { key: "reports", pathname: "/dashboard/reports/", render: () => a(ReportsIndexPage()) },
  { key: "report-intake", pathname: "/dashboard/reports/intake/", render: () => a(ReportPage({ params: Promise.resolve({ key: "intake" }), searchParams: sp() } as never)) },
  { key: "settings-integrations", pathname: "/dashboard/settings/integrations/", render: async () => a(SettingsLayout({ children: await IntegrationsPage({ searchParams: sp() } as never) })) },
  { key: "settings-team", pathname: "/dashboard/settings/team/", render: async () => a(SettingsLayout({ children: await TeamPage() })) },
];

/** Technician shell: the firm without `role-views`, so the page draws its technician layout. */
async function asTech<T>(fn: () => Promise<T>): Promise<T> {
  const live = session as Extract<FirmSession, { kind: "ok" }>;
  const before = live.org;
  (live as { org: typeof ORG }).org = { ...ORG, modules: ORG.modules.filter((m) => m !== "role-views") };
  try {
    return await fn();
  } finally {
    live.org = before;
  }
}

const VPS = [["d", "desktop"], ["m", "desktop1280"], ["p", "phone"]] as const;

const ownerScreens: Screen[] = pages.flatMap((p) =>
  VPS.map(([tag, viewport]) => ({
    id: `vr-${p.key}-owner-${tag}`,
    title: `${p.key} (owner, ${viewport})`,
    designBoard: "none",
    viewport,
    pathname: p.pathname,
    shell: "none" as const,
    prepare: () => {
      resetState();
      state.pathname = p.pathname;
      p.prepare?.();
    },
    render: async () => <OwnerShell>{await withExtra(async () => p.render())}</OwnerShell>,
  })),
);

const techScreens: Screen[] = pages
  .filter((p) => p.tech)
  .flatMap((p) =>
    (["d", "p"] as const).map((tag) => ({
      id: `vr-${p.key}-tech-${tag}`,
      title: `${p.key} (technician, ${tag === "d" ? "desktop" : "phone"})`,
      designBoard: "none",
      viewport: tag === "d" ? ("desktop" as const) : ("phone" as const),
      pathname: p.pathname,
      shell: "none" as const,
      prepare: () => {
        resetState();
        state.pathname = p.pathname;
        p.prepare?.();
      },
      render: async () => asTech(async () => <TechShell>{await withExtra(async () => p.render())}</TechShell>),
    })),
  );

/** Forms and Merge already have owner-shell screens; reuse their data at the three widths. */
const reused: Screen[] = [
  ["forms", reuse(formsScreens, "forms-list-1440"), "/dashboard/forms/"],
  ["intake-merge", reuse(mergeScreens, "m5-screen-d"), "/dashboard/intake/"],
].flatMap(([key, r, pathname]) => {
  const { prepare, render } = r as Pick<Page, "render" | "prepare">;
  return VPS.map(([tag, viewport]) => ({
    id: `vr-${key}-owner-${tag}`,
    title: `${key} (owner, ${viewport})`,
    designBoard: "none",
    viewport,
    pathname: pathname as string,
    shell: "none" as const,
    prepare,
    render: render as Screen["render"],
  }));
});

export const screens: Screen[] = [...ownerScreens, ...techScreens, ...reused];
