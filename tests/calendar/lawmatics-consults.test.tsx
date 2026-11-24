import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { loadTodayConsults, mergeConsults, sourceNote, type ConsultDeps, type ConsultItem, type TodayConsultsResult } from "@/lib/calendar/consult-sources";
import { lawmaticsGateOf, mergeBookedConsults } from "@/lib/calendar/booked-merge";
import type { TodayConsult } from "@/lib/calendar/outlook-read";
import { TodayConsultsView } from "@/components/calendar/TodayConsults";
import { OwnerConsults } from "@/components/today/owner/OwnerConsults";
import { buildNeedsYou, type NeedsYouInput } from "@/lib/today/needs-you";
import { NeedsYouSection } from "@/components/today/NeedsYouSection";
import { OwnerCameBack } from "@/components/today/owner/OwnerCameBack";
import { cameBackItems, isCameBackRow, type CameBackRow } from "@/lib/today/came-back-rules";
import { CAME_BACK_LABEL, CAME_BACK_TIMELINE, CAME_BACK_UNAVAILABLE, LAWMATICS_CONSULTS_NOT_CONNECTED, LAWMATICS_CONSULTS_UNAVAILABLE, cameBackLine } from "@/lib/ui/words";
import { pendingStageSuggestions, consumedSignalKeys } from "@/lib/stage-keeper/moves";
import { pendingProposals } from "@/lib/agents/proposals";
import { agentEvidenceFor } from "@/lib/reconcile/email";
import { didLine } from "@/lib/lead-step/did";
import { describeActivity } from "@/components/leads/describe";
import { readConsultLeadIds } from "@/lib/intake/working-load";

vi.mock("@/lib/calendar/consult-sources-live", () => ({ liveConsultDeps: {} }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn() }));
process.env.__NEXT_TRAILING_SLASH = "true";

/** Invented people only. */
const NOW = new Date("2026-11-23T15:00:00Z");
const TZ = "America/New_York";
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "");

const stored = (id: string, over: Partial<TodayConsult> = {}): TodayConsult => ({
  id,
  title: "30 Minute Consultation - Wren Tester",
  starts_at: "2026-11-24T18:00:00Z",
  ends_at: "2026-11-24T18:30:00Z",
  all_day: false,
  location: null,
  event_type: null,
  contact_name: null,
  matter_id: null,
  source: "lawmatics",
  join_url: null,
  is_consult: true,
  lead_id: null,
  lead_name: null,
  ...over,
});

function deps(over: Partial<ConsultDeps> = {}): ConsultDeps {
  return {
    hasMailboxModule: async () => true,
    outlookConnections: async () => ({ ok: true, active: 1, withCalendar: 1 }),
    outlook: async () => ({ status: "ok", consults: [] }),
    zoomAccess: async () => ({ state: "not-connected" }),
    zoomUpcoming: async () => ({ status: "ok", meetings: [] }),
    zoomLeads: async () => new Map(),
    lawmaticsGate: async () => "active",
    lawmatics: async () => ({ status: "ok", consults: [] }),
    ...over,
  };
}

describe("Today's Consults card: Lawmatics as a third source (37)", () => {
  it("states: connected, not connected, refused key (stored consults still shown), not switched on, couldn't be read", async () => {
    expect((await loadTodayConsults(NOW, TZ, deps())).lawmatics).toBe("ok");
    expect((await loadTodayConsults(NOW, TZ, deps({ lawmaticsGate: async () => "not-connected" }))).lawmatics).toBe("not-connected");
    const refused = await loadTodayConsults(NOW, TZ, deps({ lawmaticsGate: async () => "invalid", lawmatics: async () => ({ status: "ok", consults: [stored("a")] }) }));
    expect(refused.lawmatics).toBe("reconnect");
    expect(refused.consults).toHaveLength(1);
    expect((await loadTodayConsults(NOW, TZ, deps({ lawmatics: async () => ({ status: "database-update-needed" }) }))).lawmatics).toBe("update-needed");
    expect((await loadTodayConsults(NOW, TZ, deps({ lawmatics: async () => ({ status: "unavailable" }) }))).lawmatics).toBe("unavailable");
    expect((await loadTodayConsults(NOW, TZ, deps({ lawmatics: async () => Promise.reject(new Error("x")) }))).lawmatics).toBe("unavailable");
    expect((await loadTodayConsults(NOW, TZ, deps({ lawmaticsGate: async () => "unavailable" }))).lawmatics).toBe("unavailable");
  });

  it("a Lawmatics failure never hides Outlook or Zoom", async () => {
    const r = await loadTodayConsults(
      NOW,
      TZ,
      deps({ lawmatics: async () => ({ status: "unavailable" }), outlook: async () => ({ status: "ok", consults: [stored("o1", { source: "outlook", title: "Strategy Session: Ola" })] }) }),
    );
    expect(r.consults.map((c) => c.source)).toEqual(["outlook"]);
    const html = text(renderToStaticMarkup(createElement(TodayConsultsView, { result: r, timeZone: TZ })));
    expect(html).toContain("Strategy Session: Ola");
    expect(html).toContain(LAWMATICS_CONSULTS_UNAVAILABLE);
    expect(html).not.toContain("No consults in the next");
  });

  const item = (source: ConsultItem["source"], over: Partial<ConsultItem> = {}): ConsultItem => ({
    key: `${source}:${Math.random()}`,
    source,
    title: "Consult",
    startsAt: "2026-11-24T18:00:00Z",
    allDay: false,
    joinUrl: null,
    leadId: null,
    leadName: null,
    ...over,
  });

  it("an Outlook and a Lawmatics row for the same call show once (same join link, or same lead within 15 minutes); Outlook is kept", () => {
    const byLink = mergeConsults([item("outlook", { joinUrl: "https://us02web.zoom.us/j/81111111111" })], [], [item("lawmatics", { joinUrl: "https://zoom.us/j/81111111111?pwd=x", leadId: "L1", leadName: "Wren" })]);
    expect(byLink).toHaveLength(1);
    expect(byLink[0]).toMatchObject({ source: "outlook", leadId: "L1", leadName: "Wren" });
    const byLead = mergeConsults([item("outlook", { leadId: "L1" })], [], [item("lawmatics", { leadId: "L1", startsAt: "2026-11-24T18:10:00Z" })]);
    expect(byLead.map((c) => c.source)).toEqual(["outlook"]);
    const apart = mergeConsults([item("outlook", { leadId: "L1" })], [], [item("lawmatics", { leadId: "L1", startsAt: "2026-11-24T19:00:00Z" })]);
    expect(apart).toHaveLength(2);
    // Twins kept in the order Outlook, Lawmatics, Zoom.
    const three = mergeConsults([], [item("zoom", { key: "zoom:81111111111", joinUrl: "https://zoom.us/j/81111111111" })], [item("lawmatics", { joinUrl: "https://us02web.zoom.us/j/81111111111" })]);
    expect(three.map((c) => c.source)).toEqual(["lawmatics"]);
  });

  it("both layouts label the Lawmatics row and name a Lawmatics source that wasn't read", () => {
    const result: TodayConsultsResult = { consults: [item("lawmatics", { title: "Complimentary Consultation", startsAt: "2026-11-23T18:00:00Z" })], outlook: "ok", zoom: "ok", lawmatics: "ok" };
    const owner = text(renderToStaticMarkup(createElement(OwnerConsults, { result, timeZone: TZ, today: "2026-11-23" })));
    expect(owner).toContain("Complimentary Consultation");
    expect(owner).toContain("Lawmatics");
    const notConnected: TodayConsultsResult = { consults: [], outlook: "ok", zoom: "ok", lawmatics: "not-connected" };
    for (const html of [
      text(renderToStaticMarkup(createElement(TodayConsultsView, { result: notConnected, timeZone: TZ }))),
      text(renderToStaticMarkup(createElement(OwnerConsults, { result: notConnected, timeZone: TZ, today: "2026-11-23" }))),
    ]) {
      expect(html).toContain(LAWMATICS_CONSULTS_NOT_CONNECTED);
      expect(html).toContain("/dashboard/settings/integrations/lawmatics/");
    }
    for (const s of ["not-connected", "reconnect", "update-needed", "unavailable"] as const) expect(sourceNote("lawmatics", s)?.link).not.toBeNull();
    expect(sourceNote("lawmatics", "ok")).toBeNull();
  });
});

describe("Consult booked: two reads, one answer (38)", () => {
  const ev = (id: string, starts_at: string) => ({ ...stored(id, { starts_at }) });
  it("the earliest event found wins; a failed read is never 'no consult'; nothing read is null", () => {
    expect(mergeBookedConsults([null, null])).toBeNull();
    expect(mergeBookedConsults([{ status: "ok", event: ev("b", "2026-11-25T10:00:00Z") }, { status: "ok", event: ev("a", "2026-11-24T10:00:00Z") }])).toMatchObject({ status: "ok", event: { id: "a" } });
    expect(mergeBookedConsults([{ status: "unavailable" }, { status: "ok", event: ev("a", "2026-11-24T10:00:00Z") }])).toMatchObject({ status: "ok", event: { id: "a" } });
    expect(mergeBookedConsults([{ status: "unavailable" }, { status: "ok", event: null }])).toEqual({ status: "unavailable" });
    expect(mergeBookedConsults([null, { status: "ok", event: null }])).toEqual({ status: "ok", event: null });
  });
  it("the Lawmatics gate: active, invalid (reconnect), not connected (none or revoked), unreadable", () => {
    expect(lawmaticsGateOf({ ok: true, connection: { status: "active" } })).toBe("active");
    expect(lawmaticsGateOf({ ok: true, connection: { status: "invalid" } })).toBe("invalid");
    expect(lawmaticsGateOf({ ok: true, connection: { status: "revoked" } })).toBe("not-connected");
    expect(lawmaticsGateOf({ ok: true, connection: null })).toBe("not-connected");
    expect(lawmaticsGateOf({ ok: false })).toBe("unavailable");
  });
});

describe("Calendar page: Lawmatics rows (39)", () => {
  const NOWC = new Date("2026-10-21T12:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOWC);
  });
  afterEach(() => vi.useRealTimers());

  async function render(opts: { mailbox: boolean; base: unknown[]; outlook?: unknown[] }) {
    vi.resetModules();
    vi.doMock("@/lib/matters", () => ({ listUpcomingDeadlines: vi.fn(async () => []), listTasks: vi.fn(async () => []) }));
    vi.doMock("@/lib/calendar/events", () => ({ listCalendarEvents: vi.fn(async () => opts.base) }));
    const listOutlookCalendarEvents = vi.fn(async () => ({ status: "ok", events: opts.outlook ?? [] }));
    vi.doMock("@/lib/calendar/outlook-read", () => ({ listOutlookCalendarEvents }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => m === "mailbox" && opts.mailbox) }));
    vi.doMock("@/lib/org/profile", () => ({ getOrgProfile: vi.fn(async () => ({ time_zone: TZ })) }));
    const { default: Page } = await import("../../src/app/dashboard/calendar/page");
    return { html: text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ view: "week", d: "2026-10-21" }) }))), listOutlookCalendarEvents };
  }
  const lm = { id: "lm1", title: "30 Minute Consultation - Wren Tester", starts_at: "2026-10-22T18:00:00Z", ends_at: null, all_day: false, location: null, event_type: "Complimentary Consultation", contact_name: null, matter_id: null, source: "lawmatics", external_id: "lmsync:9", join_url: "https://zoom.us/j/81111111111", lead_id: "L1", is_consult: true };

  it("shows for a firm without Mailboxes, labelled Lawmatics, linked to its lead", async () => {
    const { html, listOutlookCalendarEvents } = await render({ mailbox: false, base: [lm] });
    expect(listOutlookCalendarEvents).not.toHaveBeenCalled();
    expect(html).toContain("30 Minute Consultation - Wren Tester");
    expect(html).toContain("Lawmatics · Complimentary Consultation");
    expect(html).toContain("/dashboard/leads/L1/");
  });

  it("the same call on Outlook shows once (the Outlook row kept)", async () => {
    const outlook = { ...lm, id: "o1", title: "Strategy Session: Wren", source: "outlook", external_id: "AAMk", join_url: "https://us02web.zoom.us/j/81111111111" };
    const { html } = await render({ mailbox: true, base: [lm, outlook], outlook: [outlook] });
    expect(html).toContain("Strategy Session: Wren");
    expect(html).not.toContain("30 Minute Consultation - Wren Tester");
  });
});

describe("Came back on Today (40)", () => {
  const T = Date.parse("2026-11-23T15:00:00Z");
  const row = (id: string, leadId: string, hoursAgo: number, category = "lost"): CameBackRow => ({
    id,
    lead_id: leadId,
    created_at: new Date(T - hoursAgo * 3_600_000).toISOString(),
    payload: { source: "lawmatics-daily-sync", kind: "came_back", lawmatics_id: `p-${id}`, stage_category: category },
  });
  const leads = [
    { id: "L1", first_name: "Wren", last_name: "Tester", business_name: null, email: null },
    { id: "L2", first_name: "Ola", last_name: "Placeholder", business_name: null, email: null },
    { id: "L3", first_name: "Merged", last_name: "Away", business_name: null, email: null, merged_into_id: "L1" },
  ];

  it("rows of the last 14 days, newest first; dropped after a later stage_changed, when merged, or older", () => {
    const items = cameBackItems(
      [row("a", "L1", 2, "won"), row("b", "L2", 1, "nurture"), row("c", "L3", 1), row("old", "L2", 24 * 15)],
      leads,
      [{ lead_id: "L2", created_at: new Date(T - 0.5 * 3_600_000).toISOString() }],
      T,
    );
    expect(items.map((i) => i.leadId)).toEqual(["L1"]);
    expect(items[0].category).toBe("won");
  });

  it("three states, words from words.ts: rows, nothing drawn, or the fixed line", () => {
    const base: NeedsYouInput = {
      userId: "u",
      now: new Date(T),
      deadlines: [],
      tasks: [],
      queue: { status: "ok", items: [] },
      quotes: [],
      payments: [],
      agentFailures: [],
      connections: [],
      submissions: [],
      hotLeads: [],
      stalled: [],
    };
    const ok = buildNeedsYou({ ...base, cameBack: { status: "ok", items: [{ id: "a", leadId: "L1", name: "Wren Tester", category: "lost", at: "x" }] } });
    expect(ok.items[0]).toMatchObject({ kind: "came-back", action: cameBackLine("Wren Tester", "lost"), subject: CAME_BACK_LABEL, href: "/dashboard/leads/L1/" });
    const none = buildNeedsYou({ ...base, cameBack: { status: "ok", items: [] } });
    expect(none.items).toHaveLength(0);
    expect(none.cameBackUnavailable).toBeUndefined();
    const failed = buildNeedsYou({ ...base, cameBack: { status: "unavailable" } });
    const html = text(renderToStaticMarkup(createElement(NeedsYouSection, { needs: failed, queue: "ok" })));
    expect(html).toContain(CAME_BACK_UNAVAILABLE);
    expect(text(renderToStaticMarkup(createElement(OwnerCameBack, { read: { status: "unavailable" } })))).toContain(CAME_BACK_UNAVAILABLE);
    expect(renderToStaticMarkup(createElement(OwnerCameBack, { read: { status: "ok", items: [] } }))).toBe("");
    expect(cameBackLine("Wren", "won")).toBe("Wren is an existing client with a new enquiry in Lawmatics (possibly a new trademark).");
    expect(cameBackLine("Wren", "nurture")).toBe("Wren came back with a new enquiry in Lawmatics. They were in Nurture.");
  });

  it("every existing ai_insight reader ignores came_back rows; the timeline names it from the glossary", () => {
    const r = { id: "cb1", lead_id: "L1", type: "ai_insight", actor_type: "system", created_at: "2026-11-23T10:00:00Z", payload: { source: "lawmatics-daily-sync", kind: "came_back", lawmatics_id: "7", stage_category: "lost" } };
    expect(isCameBackRow(r)).toBe(true);
    expect(pendingStageSuggestions([r as never])).toEqual([]);
    expect([...consumedSignalKeys([r as never])]).toEqual([]);
    expect(pendingProposals([r as never])).toEqual([]);
    expect(agentEvidenceFor([r as never])).toEqual([]);
    expect(didLine(r as never)).toBeNull();
    expect(describeActivity(r as never).title).toBe(CAME_BACK_TIMELINE);
  });
});

describe("Leads Working set (no change)", () => {
  it("reads every source: no source filter, consults only, so a Lawmatics consult counts and a legacy non-consult row does not", async () => {
    const calls: Array<{ table: string; filters: unknown[] }> = [];
    const q = (table: string) => {
      const rec = { table, filters: [] as unknown[] };
      calls.push(rec);
      const b: Record<string, unknown> = {};
      for (const k of ["select", "order"]) b[k] = () => b;
      for (const k of ["eq", "not", "gte", "in", "is"]) b[k] = (...a: unknown[]) => (rec.filters.push([k, ...a]), b);
      b.range = async () => ({ data: [{ lead_id: "L1", starts_at: "2026-12-01T00:00:00Z" }], error: null });
      return b;
    };
    const ids = await readConsultLeadIds({ from: q } as never, new Date("2026-11-23T00:00:00Z"));
    expect([...ids!]).toEqual(["L1"]);
    const filters = JSON.stringify(calls[0].filters);
    expect(filters).toContain('"is_consult",true');
    expect(filters).not.toContain('"source"');
  });
});
