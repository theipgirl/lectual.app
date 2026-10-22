import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * "Run now isn't working" (RPB, 2026-10-22): an owner, the agent on, Autopilot not paused, 0098 applied, AI
 * configured, and no `agent_run` row with trigger 'manual' at all, and no runtime error. The click never
 * reached the server.
 *
 * Root cause: the Run now button sits in the card's `foot` grid cell, laid over the footer, but the footer
 * comes AFTER it in the markup. Grid items paint in document order, so the footer was painted on top of the
 * button and took every click: the button showed through and could not be pressed. These tests pin the
 * stacking fix, and walk the whole path from the rendered page to `runOneAgent`.
 */

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const m = new RegExp(`(^|\\n)${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[2] : "";
};
const decl = (body: string, prop: string) => new RegExp(`(^|[;\\s])${prop}\\s*:\\s*([^;]+);`).exec(body)?.[2].trim() ?? null;

type Setting = { agent: string; enabled: boolean; autonomy: string };

function fakeClient(tables: Record<string, { data: unknown; error: unknown }>) {
  const chain = (result: { data: unknown; error: unknown }): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        // The action reads one setting row; the page reads the list.
        if (prop === "maybeSingle") return () => chain({ ...result, data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data });
        return () => chain(result);
      },
      apply: () => chain(result),
    });
  return { from: (table: string) => chain(tables[table] ?? { data: [], error: null }) };
}

/** The common world: an owner of a firm with agents + mailbox, Autopilot on and not paused, 0098 applied, AI set. */
function mockWorld(settings: Setting[], runRows: unknown[] = []) {
  // doMock outlives resetModules: start each world from the real actions and runner.
  vi.doUnmock("@/app/dashboard/agents/actions");
  vi.doUnmock("@/lib/agents/runner");
  vi.doUnmock("@/lib/agents/deps");
  vi.doMock("next/navigation", () => ({
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  }));
  vi.doMock("next/cache", () => ({ refresh: vi.fn() }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () =>
      fakeClient({
        agent_setting: { data: settings, error: null },
        agent_run: { data: runRows, error: null },
        crm_calendar_event: { data: [{ id: "e1" }], error: null },
      }),
    ),
  }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner", org: { id: "org-rpb" }, user: { id: "user-taylor" } })),
  }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => ["agents", "mailbox"].includes(m)) }));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: vi.fn(() => true) }));
  vi.doMock("@/lib/agents/autopilot", () => ({
    loadAutopilot: vi.fn(async () => ({ status: "ok", state: { paused: false, minutesPerTask: {}, reason: null, pausedBy: null } })),
  }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "ok", items: [] })) }));
  vi.doMock("@/lib/mailbox/connections", () => ({ listConnections: vi.fn(async () => ({ ok: true, connections: [{ status: "active" }] })) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/stage-keeper/read", () => ({ loadAgentMoves: vi.fn(async () => ({ status: "ok", movedToday: 0 })) }));
}

async function renderPage() {
  vi.doMock("@/app/dashboard/agents/actions", () => ({
    saveAgentSettingAction: vi.fn(),
    runAgentNowAction: vi.fn(),
    setAutopilotAction: vi.fn(),
    saveMinutesPerTaskAction: vi.fn(),
  }));
  const { default: Page } = await import("../../src/app/dashboard/agents/page");
  return renderToStaticMarkup(await Page());
}

const card = (html: string, name: string) => {
  const start = html.indexOf(name, html.indexOf("lx-agrid"));
  return html.slice(html.lastIndexOf("<section", start), html.indexOf("</section>", start));
};

describe("Run now can be clicked: the footer no longer covers it", () => {
  it("the button's slot shares the footer's grid cell and comes first in the markup...", async () => {
    vi.resetModules();
    mockWorld([{ agent: "morning-brief", enabled: true, autonomy: "draft" }]);
    const c = card(await renderPage(), "Morning brief");
    expect(decl(rule(".lx-agent-slot-run"), "grid-area")).toBe("foot");
    expect(decl(rule(".lx-agent-foot"), "grid-area")).toBe("foot");
    expect(c.indexOf("lx-agent-slot-run")).toBeGreaterThan(-1);
    expect(c.indexOf("lx-agent-slot-run")).toBeLessThan(c.indexOf("lx-agent-foot"));
  });

  it("...so it must stack above the footer: positioned, with a z-index above the footer's", () => {
    const slot = rule(".lx-agent-slot-run");
    const foot = rule(".lx-agent-foot");
    expect(decl(slot, "position")).toBe("relative");
    const z = Number(decl(slot, "z-index"));
    expect(z).toBeGreaterThanOrEqual(1);
    const footZ = decl(foot, "z-index");
    expect(footZ === null || Number(footZ) < z).toBe(true);
  });
});

describe("Run now end to end: an owner's click on an enabled agent reaches runOneAgent once, as 'manual'", () => {
  beforeEach(() => vi.resetModules());

  it("the page draws an enabled Run now for the owner, and the form it draws, submitted, runs the agent", async () => {
    const settings = [{ agent: "morning-brief", enabled: true, autonomy: "draft" }];

    // 1. The page, as the owner sees it.
    mockWorld(settings);
    const c = card(await renderPage(), "Morning brief");
    const form = /<div class="lx-agent-slot-run"><form[^>]*>([\s\S]*?)<\/form>/.exec(c)?.[1] ?? "";
    const button = /<button[^>]*>Run now<\/button>/.exec(form)?.[0] ?? null;
    expect(button).not.toBeNull();
    expect(button).not.toContain("disabled");
    expect(c).not.toContain("run-reason-");

    // 2. The form's fields, exactly as rendered, posted to the real action.
    const fd = new FormData();
    for (const m of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)) fd.set(m[1], m[2]);
    expect(fd.get("agent")).toBe("morning-brief");

    vi.resetModules();
    mockWorld(settings);
    const runOneAgent = vi.fn(async () => ({ agent: "morning-brief", orgId: "org-rpb", status: "ok", runId: "run-1", result: { itemsIn: 4, draftsOut: 1, summary: "Brief written with 4 items listed." } }));
    vi.doMock("@/lib/agents/runner", () => ({ runOneAgent }));
    vi.doMock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({}) }));
    const { runAgentNowAction } = await import("../../src/app/dashboard/agents/actions");
    const { AGENT_RUN_BUDGET_MS } = await import("../../src/lib/agents/budget");
    const state = await runAgentNowAction({}, fd);

    expect(runOneAgent).toHaveBeenCalledTimes(1);
    expect(runOneAgent).toHaveBeenCalledWith(
      {},
      { orgId: "org-rpb", agent: "morning-brief", autonomy: "draft", trigger: "manual", triggeredBy: "user-taylor", budgetMs: AGENT_RUN_BUDGET_MS },
    );
    expect(state).toEqual({ ok: true, skipped: false, message: "Brief written with 4 items listed.", itemsIn: 4, draftsOut: 1 });
  });

  it("a run that reaches its time limit comes back as a line on the card, not a hang", async () => {
    mockWorld([{ agent: "morning-brief", enabled: true, autonomy: "draft" }]);
    vi.doMock("@/lib/agents/runner", () => ({
      runOneAgent: vi.fn(async () => ({ agent: "morning-brief", orgId: "org-rpb", status: "error", runId: "run-1", error: "Did not finish within the time limit", reason: "time-limit" })),
    }));
    vi.doMock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({}) }));
    const { runAgentNowAction } = await import("../../src/app/dashboard/agents/actions");
    const { RUN_NOW_TIME_LIMIT } = await import("../../src/lib/agents/run-now");
    const fd = new FormData();
    fd.set("agent", "morning-brief");
    expect(await runAgentNowAction({}, fd)).toEqual({ error: RUN_NOW_TIME_LIMIT });
  });

  it("a request that fails outright (the function stopped, the network dropped) is a line too", async () => {
    vi.doMock("@/app/dashboard/agents/actions", () => ({
      runAgentNowAction: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
      saveAgentSettingAction: vi.fn(),
    }));
    const { runNowOrSay } = await import("../../src/components/agents/AgentControls");
    const { RUN_NOW_NO_ANSWER, runResultLine } = await import("../../src/lib/agents/run-now");
    const state = await runNowOrSay({}, new FormData());
    expect(state).toEqual({ error: RUN_NOW_NO_ANSWER });
    expect(runResultLine(state)).toEqual({ text: RUN_NOW_NO_ANSWER, alert: true });
  });
});

describe("the Agents page shows a stale 'running' row as Didn't finish", () => {
  beforeEach(() => vi.resetModules());

  it("in Recent runs and on the card, never as running", async () => {
    const started = new Date(Date.now() - 2 * 3_600_000).toISOString();
    mockWorld(
      [{ agent: "morning-brief", enabled: true, autonomy: "draft" }],
      [{ id: "r1", agent: "morning-brief", trigger: "cron", status: "running", started_at: started, finished_at: null, items_in: 0, drafts_out: 0, summary: null, error: null }],
    );
    const html = (await renderPage()).replace(/&#x27;/g, "'");
    const table = html.slice(html.indexOf("Recent runs"));
    expect(table).toContain("Didn't finish. It was stopped before it could report back.");
    expect(table).toContain("· Didn't finish");
    expect(table).not.toMatch(/·\s*running/);
    const c = card(html, "Morning brief");
    expect(c).toContain(">Didn't finish<");
    // The digest at the top says it too.
    expect(html).toContain("Morning brief didn't finish its last run");
    // And Run now is still offered.
    expect(/<button[^>]*>Run now<\/button>/.exec(c)?.[0]).not.toContain("disabled");
  });
});
