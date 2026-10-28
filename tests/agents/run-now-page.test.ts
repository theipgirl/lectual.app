import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Setting = { agent: string; enabled: boolean; autonomy: string };
type Case = {
  settings?: Setting[] | "error";
  role?: string;
  ai?: boolean;
  autopilot?: { status: "ok"; state: { paused: boolean; minutesPerTask: Record<string, number>; reason: null; pausedBy: null } } | { status: "missing" } | { status: "unavailable" };
  /** The calendar probe: the Outlook columns exist, or are missing (lectual 0098 not applied). */
  update?: "applied" | "pending";
  connections?: { ok: true; connections: { status: string }[] };
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

async function render(c: Case) {
  const settings = c.settings ?? [];
  vi.doMock("next/navigation", () => ({
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () =>
      fakeClient({
        agent_setting: settings === "error" ? { data: null, error: { message: "boom" } } : { data: settings, error: null },
        agent_run: { data: [], error: null },
        crm_calendar_event: c.update === "pending" ? { data: null, error: { code: "42703", message: "no column" } } : { data: [{ id: "e1" }], error: null },
      }),
    ),
  }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: c.role ?? "owner" })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => ["agents", "mailbox"].includes(m)) }));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: vi.fn(() => c.ai ?? true) }));
  vi.doMock("@/lib/agents/autopilot", () => ({
    loadAutopilot: vi.fn(async () => c.autopilot ?? { status: "missing" }),
  }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "ok", items: [] })) }));
  vi.doMock("@/lib/mailbox/connections", () => ({ listConnections: vi.fn(async () => c.connections ?? { ok: true as const, connections: [{ status: "active" }] }) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/app/dashboard/agents/actions", () => ({
    saveAgentSettingAction: vi.fn(),
    runAgentNowAction: vi.fn(),
    setAutopilotAction: vi.fn(),
    saveMinutesPerTaskAction: vi.fn(),
  }));
  const { default: Page } = await import("../../src/app/dashboard/agents/page");
  return renderToStaticMarkup(await Page());
}

const on = (agent: string): Setting => ({ agent, enabled: true, autonomy: "draft" });
const off = (agent: string): Setting => ({ agent, enabled: false, autonomy: "draft" });
const card = (html: string, name: string) => {
  const start = html.indexOf(name, html.indexOf("lx-agrid"));
  return html.slice(html.lastIndexOf("<section", start), html.indexOf("</section>", start));
};
const runButton = (c: string) => /<button[^>]*>Run now<\/button>/.exec(c)?.[0] ?? null;
const paused = { status: "ok" as const, state: { paused: true, minutesPerTask: {}, reason: null, pausedBy: null } };
const running = { status: "ok" as const, state: { paused: false, minutesPerTask: {}, reason: null, pausedBy: null } };

const TRIAGE = "Intake triage";

describe("Run now on the Agents page: the enabled regression", () => {
  beforeEach(() => vi.resetModules());

  it("an owner, the AI agent on, Autopilot not set up: Run now is enabled and says nothing beside it", async () => {
    const c = card(await render({ settings: [on("intake-triage")] }), TRIAGE);
    const button = runButton(c);
    expect(button).not.toBeNull();
    expect(button).not.toContain("disabled");
    expect(button).not.toContain("aria-describedby");
    expect(c).not.toContain("run-reason-");
    expect(c).not.toContain("Switch the assistant on first.");
    expect(c).not.toContain("Only an owner");
  });

  it("the same with Autopilot on (a row that is not paused)", async () => {
    const c = card(await render({ settings: [on("intake-triage")], autopilot: running }), TRIAGE);
    expect(runButton(c)).not.toContain("disabled");
    expect(c).not.toContain("run-reason-");
  });

  it("the Stage Keeper with the AI key missing is still enabled", async () => {
    const c = card(await render({ settings: [on("stage-keeper")], ai: false }), "Automatic stage moves");
    expect(runButton(c)).not.toContain("disabled");
    expect(c).not.toContain("run-reason-");
  });

  it("an admin and a senior admin can run it too", async () => {
    for (const role of ["admin", "senior_admin"]) {
      vi.resetModules();
      const c = card(await render({ settings: [on("intake-triage")], role }), TRIAGE);
      expect(runButton(c), role).not.toContain("disabled");
    }
  });
});

describe("Run now on the Agents page: each blocked state is a disabled button with its sentence beside it", () => {
  beforeEach(() => vi.resetModules());

  const blockedCard = async (c: Case, name = TRIAGE) => {
    const html = card(await render(c), name);
    const button = runButton(html);
    return { html, button };
  };
  const reasonOf = (html: string, agent: string) => {
    const m = new RegExp(`<p id="run-reason-${agent}"[^>]*>([^<]*)</p>`).exec(html);
    return m ? m[1].replace(/&#x27;/g, "'") : null;
  };

  it("off", async () => {
    const { html, button } = await blockedCard({ settings: [off("intake-triage")] });
    expect(button).toContain("disabled");
    expect(button).toContain('aria-describedby="run-reason-intake-triage"');
    expect(reasonOf(html, "intake-triage")).toBe("Switch the assistant on first.");
  });

  it("an agent with no setting row is off", async () => {
    const { html, button } = await blockedCard({ settings: [] });
    expect(button).toContain("disabled");
    expect(reasonOf(html, "intake-triage")).toBe("Switch the assistant on first.");
  });

  it("Autopilot paused", async () => {
    const { html, button } = await blockedCard({ settings: [on("intake-triage")], autopilot: paused });
    expect(button).toContain("disabled");
    expect(reasonOf(html, "intake-triage")).toBe("Assistants paused for your firm, so none of them run. Resume them first.");
  });

  it("Autopilot unreadable is a warning line", async () => {
    const { html, button } = await blockedCard({ settings: [on("intake-triage")], autopilot: { status: "unavailable" } });
    expect(button).toContain("disabled");
    expect(reasonOf(html, "intake-triage")).toBe("We couldn't check whether assistants are paused, so nothing will run.");
    expect(html).toMatch(/<p id="run-reason-intake-triage"[^>]*color:var\(--warn\)/);
  });

  it("AI not configured", async () => {
    const { html, button } = await blockedCard({ settings: [on("intake-triage")], ai: false });
    expect(button).toContain("disabled");
    expect(reasonOf(html, "intake-triage")).toBe("AI isn't switched on for your firm yet. Lectual will turn it on.");
  });

  it("role: a viewer sees the button, disabled, with the role sentence", async () => {
    const { html, button } = await blockedCard({ settings: [on("intake-triage")], role: "viewer" });
    expect(button).toContain("disabled");
    expect(reasonOf(html, "intake-triage")).toBe("Only an owner, admin or senior admin can run assistants.");
  });

  it("database update pending: the three newest agents, with the shared wording", async () => {
    for (const [agent, name] of [["morning-brief", "Morning brief"], ["consult-prep", "Consult prep"], ["inbox-summary", "Inbox summary"]]) {
      vi.resetModules();
      const { html, button } = await blockedCard({ settings: [on(agent)], update: "pending" }, name);
      expect(button, agent).toContain("disabled");
      expect(reasonOf(html, agent), agent).toBe("This isn't switched on for your firm yet. Lectual will turn it on.");
    }
  });

  it("database update pending does not block an agent that predates it", async () => {
    const { button } = await blockedCard({ settings: [on("intake-triage")], update: "pending" });
    expect(button).not.toContain("disabled");
  });

  it("the reason is visible text, not only a tooltip", async () => {
    const { html } = await blockedCard({ settings: [off("intake-triage")] });
    expect(reasonOf(html, "intake-triage")).toBeTruthy();
    expect(runButton(html)).not.toContain("title=");
  });

  it("two causes at once: off beats paused, role beats off", async () => {
    const a = await blockedCard({ settings: [off("intake-triage")], autopilot: paused });
    expect(reasonOf(a.html, "intake-triage")).toBe("Switch the assistant on first.");
    vi.resetModules();
    const b = await blockedCard({ settings: [off("intake-triage")], role: "viewer" });
    expect(reasonOf(b.html, "intake-triage")).toBe("Only an owner, admin or senior admin can run assistants.");
  });

  it("the same card shows four different sentences across off, paused, no AI key and role", async () => {
    const cases: Case[] = [
      { settings: [off("intake-triage")] },
      { settings: [on("intake-triage")], autopilot: paused },
      { settings: [on("intake-triage")], ai: false },
      { settings: [on("intake-triage")], role: "viewer" },
    ];
    const seen = new Set<string | null>();
    for (const c of cases) {
      vi.resetModules();
      seen.add(reasonOf((await blockedCard(c)).html, "intake-triage"));
    }
    expect(seen.size).toBe(4);
    expect(seen.has(null)).toBe(false);
  });
});

describe("Run now on the Agents page: what stays as it was", () => {
  beforeEach(() => vi.resetModules());

  it("a failed settings read draws no Run now and no On/Off claim", async () => {
    const html = await render({ settings: "error" });
    expect(html).toContain("Settings couldn&#x27;t be read");
    expect(html).not.toContain("Run now</button>");
    expect(html).not.toContain("run-reason-");
    expect(html).not.toContain('role="switch"');
  });

  it("an enabled agent with no mailbox keeps its Blocked pill and readiness line, and Run now is still offered", async () => {
    const c = card(await render({ settings: [on("inbox-summary")], connections: { ok: true, connections: [] } }), "Inbox summary");
    expect(c).toContain("waiting for a mailbox");
    expect(c).toContain("Blocked");
    expect(runButton(c)).not.toContain("disabled");
    expect(c).not.toContain("run-reason-");
  });
});
