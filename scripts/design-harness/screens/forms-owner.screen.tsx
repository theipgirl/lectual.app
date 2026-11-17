import IntakeFormsPage from "@/app/dashboard/forms/page";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { vi } from "vitest";
import { state } from "../state";
import { resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

/**
 * Forms (/dashboard/forms/) inside the OWNER shell, plus the owner rail / phone More sheet that now list Forms.
 * Sample intakes are invented. The forms loaders are mocked in setup.ts and read state.formsList / state.formRecord / state.formStatRows.
 */
const T = "2026-11-01T15:00:00Z";
function rec(over: Partial<IntakeFormRecord> & Pick<IntakeFormRecord, "id" | "name" | "slug">): IntakeFormRecord {
  return {
    sourceTag: null,
    kind: "intake",
    status: "draft",
    config: defaultIntakeConfig(),
    allowedDomains: [],
    receivesReferrals: false,
    agreementSignedAt: null,
    publishedAt: null,
    everSaved: true,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}
const F1 = "00000000-0000-4000-8000-0000000f0001";
const F2 = "00000000-0000-4000-8000-0000000f0002";
const F3 = "00000000-0000-4000-8000-0000000f0003";
const forms: IntakeFormRecord[] = [
  rec({ id: F1, name: "Intake", slug: "intake", status: "live", sourceTag: null, publishedAt: T }),
  rec({ id: F2, name: "Instagram", slug: "instagram", status: "draft", sourceTag: "Instagram bio link" }),
  rec({ id: F3, name: "Masterclass assessment", slug: "masterclass", kind: "assessment", status: "live", sourceTag: "UGW 2026", publishedAt: T }),
];
const statRows = [
  ...Array.from({ length: 14 }, (_, i) => ({ form_id: F1, started_at: `2026-11-0${(i % 8) + 1}T14:00:00Z`, created_at: `2026-11-0${(i % 8) + 1}T14:00:20Z`, submitted_at: i % 3 ? `2026-11-0${(i % 8) + 1}T14:06:00Z` : null, temperature: null })),
  ...Array.from({ length: 9 }, (_, i) => ({ form_id: F3, started_at: `2026-11-0${(i % 8) + 1}T16:00:00Z`, created_at: `2026-11-0${(i % 8) + 1}T16:00:10Z`, submitted_at: i % 4 ? `2026-11-0${(i % 8) + 1}T16:04:00Z` : null, temperature: "warm" })),
];

/** Booth cards for the Forms list (event codes and times only) and for one event's page. */
function listRows(code: string, n: number, newest: string, doneEvery: number) {
  const t0 = Date.parse(newest);
  return Array.from({ length: n }, (_, i) => {
    const created = new Date(t0 - i * 3_600_000 * 5).toISOString();
    return { event_code: code, created_at: created, completed_at: i % doneEvery === 0 ? null : new Date(Date.parse(created) + 240_000).toISOString() };
  });
}
const boothList = [...listRows("legal-assessment", 6, "2026-11-15T17:00:00Z", 6), ...listRows("urban-golf-2026", 146, "2026-10-17T21:00:00Z", 4), ...listRows("story2profit-2026", 17, "2026-09-12T18:00:00Z", 5)];
const ANS = { "1": "business", "2": "no", "3": "4_10", "4": "over_1m", "5": "applied", "6": "partial", "7": "none", "8": "right_away" };
const card = (id: string, o: Record<string, unknown>) => ({ id, event_code: "legal-assessment", track: "business", score: null, band: null, temperature: null, answers: ANS, gaps: [], created_at: "2026-11-15T15:00:00Z", completed_at: null, ...o });
const eventRows = [
  card("e1", { score: 40, band: "partial", temperature: "hot", gaps: ["Your name and logo are not federally registered.", "Only part of your revenue is protected by written contracts."], created_at: "2026-11-15T17:00:00Z", completed_at: "2026-11-15T17:04:00Z" }),
  card("e2", { score: 20, band: "exposed", temperature: "warm", gaps: ["Your name and logo are not federally registered."], created_at: "2026-11-15T16:00:00Z", completed_at: "2026-11-15T16:03:00Z" }),
  card("e3", { score: 75, band: "protected", temperature: "cold", gaps: [], created_at: "2026-11-15T15:00:00Z", completed_at: "2026-11-15T15:05:00Z" }),
  card("e4", { score: 55, band: "partial", temperature: "warm", gaps: ["Your contracts do not cover who owns the work."], created_at: "2026-11-14T15:00:00Z", completed_at: "2026-11-14T15:04:00Z" }),
  card("e5", { score: 30, band: "exposed", temperature: "hot", gaps: ["Your name and logo are not federally registered."], created_at: "2026-11-14T13:00:00Z", completed_at: "2026-11-14T13:06:00Z" }),
  card("e6", { answers: { "1": "business", "2": "no", "3": "4_10" }, created_at: "2026-11-13T12:00:00Z" }),
];

/** Event people: six invented people, mixed hot/warm/cold, one unfinished, one whose lead is missing. */
const eventPeople = {
  cards: eventRows.map((r, i) => ({ id: r.id, lead_id: i === 4 ? "lead-gone" : `lead-${i}`, score: r.score, band: r.band, temperature: r.temperature, created_at: r.created_at, completed_at: r.completed_at, gaps: r.gaps })),
  leads: [
    { id: "lead-0", first_name: "Maya", last_name: "Okafor", business_name: "Okafor Candle Co." },
    { id: "lead-1", first_name: "Theo", last_name: "Lindqvist", business_name: "Northlight Studio" },
    { id: "lead-2", first_name: "Priya", last_name: "Raman", business_name: null },
    { id: "lead-3", first_name: "Jonah", last_name: "Whitfield", business_name: "Whitfield & Daughters Bakery" },
    { id: "lead-5", first_name: "Sofia", last_name: "Brandt", business_name: "Brandt Ceramics" },
  ],
};

const prepare = (record: IntakeFormRecord | null = null) => () => {
  resetState();
  vi.setSystemTime(new Date("2026-11-16T14:00:00Z"));
  state.pathname = "/dashboard/forms/";
  (state as { boothList?: unknown }).boothList = boothList;
  (state as { boothEventRows?: unknown }).boothEventRows = eventRows;
  (state as { eventPeople?: unknown }).eventPeople = eventPeople;
  state.formsList = forms;
  state.formRecord = record;
  (state as { formStatRows?: unknown[] }).formStatRows = statRows;
};
function page(sp: Record<string, string>) {
  return async function renderPage() {
    const content = await IntakeFormsPage({ searchParams: Promise.resolve(sp) });
    return <OwnerShell>{content}</OwnerShell>;
  };
}

/** Let the page grow to its full height so a full-page screenshot shows everything (the shell scrolls inside itself). */
const GROW = "<style>.lx-app{height:auto!important;overflow:visible!important}.lx-content,.lx-page{overflow:visible!important}</style>";

export const screens: Screen[] = [
  { id: "forms-list-1440", title: "Forms list, owner shell, 1440", designBoard: "-", viewport: "desktop", pathname: "/dashboard/forms/", prepare: prepare(), render: page({}), transformHtml: (h) => GROW + h },
  { id: "forms-list-1280", title: "Forms list, owner shell, 1280", designBoard: "-", viewport: "desktop1280", pathname: "/dashboard/forms/", prepare: prepare(), render: page({}), transformHtml: (h) => GROW + h },
  { id: "forms-list-phone", title: "Forms list, owner shell, phone", designBoard: "-", viewport: "phone", pathname: "/dashboard/forms/", prepare: prepare(), render: page({}), transformHtml: (h) => GROW + h },
  { id: "forms-edit-1440", title: "Forms setup, one intake open, 1440", designBoard: "-", viewport: "desktop", pathname: "/dashboard/forms/", prepare: prepare(forms[0]), render: page({ form: F1 }), transformHtml: (h) => GROW + h },
  { id: "forms-edit-phone", title: "Forms setup, one intake open, phone", designBoard: "-", viewport: "phone", pathname: "/dashboard/forms/", prepare: prepare(forms[0]), render: page({ form: F1 }), transformHtml: (h) => GROW + h },
  { id: "event-1440", title: "Event results page, owner shell, 1440", designBoard: "-", viewport: "desktop", pathname: "/dashboard/forms/", prepare: prepare(), render: page({ event: "legal-assessment" }), transformHtml: (h) => GROW + h },
  { id: "event-1280", title: "Event results page, 1280", designBoard: "-", viewport: "desktop1280", pathname: "/dashboard/forms/", prepare: prepare(), render: page({ event: "legal-assessment" }), transformHtml: (h) => GROW + h },
  { id: "event-phone", title: "Event results page, phone", designBoard: "-", viewport: "phone", pathname: "/dashboard/forms/", prepare: prepare(), render: page({ event: "legal-assessment" }), transformHtml: (h) => GROW + h },
  { id: "forms-list-before-1440", title: "Forms list, BEFORE (origin/main EventAssessments + page)", designBoard: "-", viewport: "desktop", pathname: "/dashboard/forms/", prepare: prepare(), render: page({}), transformHtml: (h) => GROW + h },
  {
    id: "owner-more-phone",
    title: "Owner phone More sheet open (lists Forms)",
    designBoard: "-",
    viewport: "phone",
    pathname: "/dashboard/",
    prepare: () => { resetState(); state.pathname = "/dashboard/"; },
    render: () => <OwnerShell moreOpen><div style={{ padding: 16 }}>Page content</div></OwnerShell>,
  },
  {
    id: "owner-rail-1440",
    title: "Owner rail, More menu open (lists Forms)",
    designBoard: "-",
    viewport: "desktop",
    pathname: "/dashboard/",
    prepare: () => { resetState(); state.pathname = "/dashboard/"; },
    render: () => <OwnerShell railPinned={false} railFlyout><div style={{ padding: 16 }}>Page content</div></OwnerShell>,
  },
  {
    id: "owner-more-phone-before",
    title: "Owner phone More sheet open (BEFORE: origin/main views file)",
    designBoard: "-",
    viewport: "phone",
    pathname: "/dashboard/",
    prepare: () => { resetState(); state.pathname = "/dashboard/"; },
    render: () => <OwnerShell moreOpen><div style={{ padding: 16 }}>Page content</div></OwnerShell>,
  },
  {
    id: "owner-rail-1440-before",
    title: "Owner rail, More menu open (BEFORE: origin/main views file)",
    designBoard: "-",
    viewport: "desktop",
    pathname: "/dashboard/",
    prepare: () => { resetState(); state.pathname = "/dashboard/"; },
    render: () => <OwnerShell railPinned={false} railFlyout><div style={{ padding: 16 }}>Page content</div></OwnerShell>,
  },
];
