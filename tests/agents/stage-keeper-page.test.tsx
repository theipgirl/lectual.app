import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_MOVES_TODAY_HREF } from "../../src/lib/stage-keeper/moves";
import { parseIntakeFilters } from "../../src/lib/intake/rows";

/**
 * The Agents page's Stage Keeper card (Sprint 16): "N leads moved today" from the same read and the same
 * pure function as the Intake board, its readiness without the AI key, and the run-log label.
 */

type Row = Record<string, unknown>;
type Case = {
  settings?: { agent: string; enabled: boolean; autonomy: string }[];
  activity?: Row[] | "error";
  runs?: Row[];
  calendar?: Row[] | "error";
  connections?: { ok: true; connections: { status: string }[] } | { ok: false; error: string };
  ai?: boolean;
  modules?: string[];
  now?: string;
};

function fakeClient(tables: Record<string, { data: unknown; error: unknown }>) {
  const chain = (result: { data: unknown; error: unknown }): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        return () => chain(result);
      },
      apply: () => chain(result),
    });
  return { from: (table: string) => chain(tables[table] ?? { data: [], error: null }) };
}

const move = (leadId: string, hoursAgo: number, over: Row = {}): Row => ({
  id: `act-${leadId}-${hoursAgo}`,
  lead_id: leadId,
  type: "stage_changed",
  actor_type: "ai",
  created_at: new Date(Date.parse("2026-09-25T15:00:00Z") - hoursAgo * 3_600_000).toISOString(),
  payload: { actor: "agent:stage-keeper", to_stage: "LOE & Invoice Sent", to_stage_id: "s-loe", signal: "loe-invoice-sent", evidence: { kind: "mail", type: "loe-invoice", direction: "outbound", at: "2026-09-24T10:00:00Z", subject: null } },
  ...over,
});

async function render(c: Case) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(c.now ?? "2026-09-25T15:00:00Z"));
  vi.doMock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () =>
      fakeClient({
        agent_setting: { data: c.settings ?? [], error: null },
        agent_run: { data: c.runs ?? [], error: null },
        crm_activity: c.activity === "error" ? { data: null, error: { message: "boom" } } : { data: c.activity ?? [], error: null },
        crm_calendar_event: c.calendar === "error" ? { data: null, error: { message: "boom", code: "XX000" } } : { data: c.calendar ?? [], error: null },
      }),
    ),
  }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner" })) }));
  const modules = c.modules ?? ["agents", "mailbox"];
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => modules.includes(m)) }));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: vi.fn(() => c.ai ?? true) }));
  vi.doMock("@/lib/agents/autopilot", () => ({ loadAutopilot: vi.fn(async () => ({ status: "missing" })) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "ok", items: [] })) }));
  vi.doMock("@/lib/mailbox/connections", () => ({ listConnections: vi.fn(async () => c.connections ?? { ok: true as const, connections: [{ status: "active" }] }) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/app/dashboard/agents/actions", () => ({ saveAgentSettingAction: vi.fn(), runAgentNowAction: vi.fn(), setAutopilotAction: vi.fn(), saveMinutesPerTaskAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/agents/page");
  const html = renderToStaticMarkup(await Page());
  vi.useRealTimers();
  return html;
}

const on = (agent: string, autonomy = "act") => ({ agent, enabled: true, autonomy });
const card = (html: string, name: string) => {
  const start = html.indexOf(name, html.indexOf("lx-agrid"));
  return html.slice(html.lastIndexOf("<section", start), html.indexOf("</section>", start));
};
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");

beforeEach(() => vi.resetModules());

describe("the Stage Keeper card", () => {
  it("shows '3 leads moved today' linking to the filtered board", async () => {
    const html = await render({ settings: [on("stage-keeper")], activity: [move("a", 1), move("b", 2), move("c", 3), move("d", 80)] });
    const c = card(html, "Automatic stage moves");
    expect(text(c)).toContain("3 leads moved today");
    // Next may print the path without its trailing slash outside the app; the target is the same either way.
    const href = /href="([^"]+)"/.exec(c.slice(c.indexOf("3 leads moved today") - 120))![1].replaceAll("&amp;", "&");
    const url = new URL(href, "https://app.example.test");
    expect(url.pathname.replace(/\/$/, "")).toBe("/dashboard/intake");
    expect(url.searchParams.get("view")).toBe("board");
    expect(url.searchParams.get("agent")).toBe("today");
  });

  it("the link lands on the board with the Today filter on", () => {
    const url = new URL(AGENT_MOVES_TODAY_HREF, "https://app.example.test");
    expect(url.pathname).toBe("/dashboard/intake/");
    expect(url.searchParams.get("view")).toBe("board");
    expect(parseIntakeFilters(Object.fromEntries(url.searchParams)).agent).toBe("today");
  });

  it("says '1 lead moved today' in the singular and '0 leads' when none", async () => {
    expect(text(card(await render({ settings: [on("stage-keeper")], activity: [move("a", 1)] }), "Automatic stage moves"))).toContain("1 lead moved today");
    expect(text(card(await render({ settings: [on("stage-keeper")] }), "Automatic stage moves"))).toContain("0 leads moved today");
  });

  it("a lead the agent moved and a person moved after is not counted", async () => {
    const person = { id: "p", lead_id: "a", type: "stage_changed", actor_type: "user", created_at: "2026-09-25T14:30:00Z", payload: { to_stage: "Elsewhere" } };
    const html = await render({ settings: [on("stage-keeper")], activity: [move("a", 3), person, move("b", 3)] });
    expect(text(card(html, "Automatic stage moves"))).toContain("1 lead moved today");
  });

  it("a failed read says it couldn't be loaded and never shows 0", async () => {
    const c = text(card(await render({ settings: [on("stage-keeper")], activity: "error" }), "Automatic stage moves"));
    expect(c).toContain("couldn't be loaded");
    expect(c).not.toContain("0 leads moved today");
    expect(c).not.toContain("moved today<");
  });

  it("'today' is the firm's civil day: a move at 11pm New York time the night before is not today", async () => {
    // 03:30Z on the 25th is 11:30pm on the 24th in New York; "now" is 15:00Z on the 25th.
    const early = move("a", 0, { created_at: "2026-09-25T03:30:00Z" });
    expect(text(card(await render({ settings: [on("stage-keeper")], activity: [early] }), "Automatic stage moves"))).toContain("0 leads moved today");
  });
});

describe("readiness and the header", () => {
  it("is ready without the AI key", async () => {
    const html = await render({ settings: [on("stage-keeper")], ai: false });
    expect(card(html, "Automatic stage moves")).not.toContain("needs the AI key");
    expect(html).toContain("1 of 7 on");
    expect(html).not.toContain("on but blocked");
  });

  it("is blocked, with a clear label, with no active mailbox and no readable consult", async () => {
    const html = await render({ settings: [on("stage-keeper")], connections: { ok: true, connections: [] }, calendar: [] });
    const c = card(html, "Automatic stage moves");
    expect(c).toContain("On · waiting for a mailbox");
    expect(c).toContain("Blocked");
  });

  it("is ready on readable consults alone", async () => {
    const html = await render({ settings: [on("stage-keeper")], connections: { ok: true, connections: [] }, calendar: [{ id: "e1" }] });
    expect(card(html, "Automatic stage moves")).not.toContain("Blocked");
  });

  it("a failed mailbox or calendar read is 'couldn't check', not 'waiting'", async () => {
    const html = await render({ settings: [on("stage-keeper")], connections: { ok: false, error: "x" }, calendar: "error" });
    const c = text(card(html, "Automatic stage moves"));
    expect(c).toContain("couldn't check");
    expect(c).not.toContain("waiting for a mailbox");
  });

  it("without the Mailboxes module it says so", async () => {
    expect(card(await render({ settings: [on("stage-keeper")], modules: ["agents"] }), "Automatic stage moves")).toContain("Needs the Mailboxes feature");
  });

  it("the card says plainly that it moves leads and never sends, and shows its autonomy hint", async () => {
    const c = text(card(await render({ settings: [on("stage-keeper", "act")] }), "Automatic stage moves"));
    expect(c).toContain("moves the lead forward");
    expect(c).toContain("never sends anything");
    expect(c).toContain("Moves the lead forward itself and logs it");
    const s = text(card(await render({ settings: [on("stage-keeper", "suggest")] }), "Automatic stage moves"));
    expect(s).toContain("Writes a suggestion card on the lead instead of moving it");
  });
});

describe("the run log and the minutes form", () => {
  it("labels a stage-keeper run by name", async () => {
    const run = { id: "r1", agent: "stage-keeper", trigger: "event", status: "ok", started_at: "2026-09-25T14:00:00Z", finished_at: "2026-09-25T14:00:03Z", items_in: 2, drafts_out: 1, summary: "3 lead(s) read: 1 moved, 1 suggestion(s) written.", error: null };
    const html = await render({ settings: [on("stage-keeper")], runs: [run] });
    expect(html).toContain("3 lead(s) read: 1 moved, 1 suggestion(s) written.");
    const row = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    expect(row).toContain("Automatic stage moves");
    expect(row).toContain("Event");
  });

  it("the Hours-saved form has a row for it", async () => {
    vi.doMock("@/app/dashboard/agents/actions", () => ({ saveMinutesPerTaskAction: vi.fn() }));
    const { MinutesPerTaskForm } = await import("../../src/components/agents/MinutesPerTaskForm");
    const { DEFAULT_MINUTES_PER_TASK } = await import("../../src/lib/agents/autopilot-rules");
    const html = text(renderToStaticMarkup(<MinutesPerTaskForm minutes={DEFAULT_MINUTES_PER_TASK} canManage />));
    expect(html).toContain("Automatic stage moves");
    expect(html).toContain("Minutes per lead placed");
    expect(html).toContain('name="minutes-stage-keeper"');
  });
});
