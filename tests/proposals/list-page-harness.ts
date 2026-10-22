import { vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ProposalListItem } from "@/lib/proposals/store";
import type { ConsultsStripData } from "@/lib/proposals/consults-load";

/**
 * Shared by the proposals list page tests: one `renderListPage` that mocks every loader the page
 * reads (the proposals, their newest events, the settings, the member directory, the consults
 * strip, the lead options and the draft gate) so each test can make exactly one of them fail.
 */

export function item(id: string, over: Partial<ProposalListItem> = {}): ProposalListItem {
  return {
    id,
    family_id: `${id.padEnd(8, "0")}-0000-4000-8000-000000000000`,
    version: 1,
    client_name: `Client ${id}`,
    title: "Trademark Proposal",
    status: "draft",
    source: "manual",
    expires_on: "2026-11-30",
    lead_id: null,
    matter_id: null,
    approved_at: null,
    sent_at: null,
    accepted_at: null,
    created_at: "2026-10-19T12:00:00Z",
    updated_at: "2026-10-19T12:00:00Z",
    brands: [],
    offered: [{ name: "Concierge", legalAtSigningCents: 495_000, usptoAtFilingCents: 70_000 }],
    class_count: 2,
    signed_package: null,
    package_basis: null,
    legal_total_cents: 495_000,
    gov_total_cents: 70_000,
    blocking_issue: null,
    ...over,
  };
}

export const ROWS: ProposalListItem[] = [
  item("a1"),
  item("a2", { status: "approved" }),
  item("b1", { blocking_issue: "Add the pay link before creating the link." }),
  item("s1", { status: "sent", expires_on: "2026-10-30" }),
  item("e1", { status: "sent", expires_on: "2026-10-10" }),
  item("e2", { status: "sent", expires_on: "2026-10-19" }),
  item("c1", { status: "accepted", accepted_at: "2026-10-18T15:00:00Z" }),
  item("x1", { status: "withdrawn" }),
];

export const STRIP_OK: ConsultsStripData = {
  header: { title: "Zoom consults", status: { kind: "connected", text: "connected · last sync 6 min ago" } },
  meetings: { status: "ok", rows: [], more: 0 },
};

export type Opts = {
  rows?: ProposalListItem[] | "fail";
  role?: string | null;
  leads?: unknown;
  block?: string | null;
  /** The firm's saved settings row; null = none saved yet; "fail" = the read throws. */
  settings?: unknown;
  events?: Map<string, unknown> | "fail";
  directory?: unknown[] | "fail";
  strip?: ConsultsStripData;
  /** Sprint 19: each accepted row's paid state / newest step event; omitted = nothing marked, "fail" = the read throws. */
  steps?: Record<string, { paid: unknown; newest: unknown }> | "fail";
};

export const PACKAGES = [
  { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
];

export async function renderListPage(search: { segment?: string; status?: string } = {}, opts: Opts = {}) {
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
  vi.doMock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => (opts.role === undefined ? "owner" : opts.role)) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/proposals/store", () => ({
    listProposals: vi.fn(async () => {
      if (opts.rows === "fail") throw new Error("db down");
      return opts.rows ?? ROWS;
    }),
    listLatestProposalEvents: vi.fn(async () => {
      if (opts.events === "fail") throw new Error("events down");
      return opts.events ?? new Map();
    }),
    listStepActivity: vi.fn(async (ids: string[]) => {
      if (opts.steps === "fail") throw new Error("step events down");
      return new Map(ids.map((id) => [id, (opts.steps && opts.steps !== "fail" ? opts.steps[id] : undefined) ?? { paid: { state: "not_paid", undoneAt: null }, newest: null }]));
    }),
    getProposalSettings: vi.fn(async () => {
      if (opts.settings === "fail") throw new Error("settings down");
      return opts.settings === undefined ? { pricing: { packages: PACKAGES }, default_pay_url: null } : opts.settings;
    }),
  }));
  vi.doMock("@/lib/members/directory", () => ({
    listMemberDirectory: vi.fn(async () => {
      if (opts.directory === "fail") throw new Error("directory down");
      return opts.directory ?? [];
    }),
  }));
  vi.doMock("@/lib/proposals/consults-load", () => ({ loadConsultsStrip: vi.fn(async () => opts.strip ?? STRIP_OK) }));
  vi.doMock("@/lib/proposals/lead-options", () => ({
    loadLeadOptions: vi.fn(async () => opts.leads ?? { status: "ok", leads: [{ id: "lead-1", label: "Ana Ruiz" }] }),
  }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: vi.fn(async () => opts.block ?? null) }));
  vi.doMock("@/app/dashboard/proposals/transcript-actions", () => ({ draftProposalFromUploadAction: vi.fn(), draftProposalFromMeetingAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve(search) })));
}

/** The segment links as "Label:count" (a count is absent while the proposals read has failed). */
export function segments(html: string): string[] {
  const nav = html.slice(html.indexOf('aria-label="Segments"'));
  const end = nav.indexOf("</nav>");
  return [...nav.slice(0, end).matchAll(/<a [^>]*><span>([^<]*)<\/span>(?:<span class="pq-count">(\d+)<\/span>)?<\/a>/g)].map((m) => (m[2] === undefined ? m[1] : `${m[1]}:${m[2]}`));
}

/** The HTML of one table row, found by something in it. */
export function rowOf(html: string, needle: string): string {
  const at = html.indexOf(needle);
  const start = html.lastIndexOf("<tr", at);
  return html.slice(start, html.indexOf("</tr>", at));
}
