import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

type Setting = { agent: string; enabled: boolean; autonomy: string };
type Run = { id: string; agent: string; trigger: string; status: string; started_at: string; finished_at: string | null; items_in: number; drafts_out: number; summary: string | null; error: string | null };

type Case = {
  settings?: Setting[] | "error";
  runs?: Run[];
  modules?: string[];
  connections?: { ok: true; connections: { status: string }[] } | { ok: false; error: string };
  queue?: { status: "ok" | "unconfigured" | "unavailable"; items: unknown[] };
  ai?: boolean;
};

/** A scoped client whose chains all resolve to the table's canned result. */
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
  const loadActiveQueue = vi.fn(async () => c.queue ?? { status: "ok", items: [] });
  const listConnections = vi.fn(async () => c.connections ?? { ok: true as const, connections: [] });
  vi.doMock("next/navigation", () => ({
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () =>
      fakeClient({
        agent_setting: settings === "error" ? { data: null, error: { message: "boom" } } : { data: settings, error: null },
        agent_run: { data: c.runs ?? [], error: null },
      }),
    ),
  }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner" })) }));
  const modules = c.modules ?? ["agents", "mailbox"];
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => modules.includes(m)) }));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: vi.fn(() => c.ai ?? true) }));
  vi.doMock("@/lib/agents/autopilot", () => ({ loadAutopilot: vi.fn(async () => ({ status: "missing" })) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue }));
  vi.doMock("@/lib/mailbox/connections", () => ({ listConnections }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/app/dashboard/agents/actions", () => ({
    saveAgentSettingAction: vi.fn(),
    runAgentNowAction: vi.fn(),
    setAutopilotAction: vi.fn(),
    saveMinutesPerTaskAction: vi.fn(),
  }));
  const { default: Page } = await import("../../src/app/dashboard/agents/page");
  return { html: renderToStaticMarkup(await Page()), loadActiveQueue, listConnections };
}

const on = (agent: string): Setting => ({ agent, enabled: true, autonomy: "draft" });
const off = (agent: string): Setting => ({ agent, enabled: false, autonomy: "draft" });
const card = (html: string, name: string) => {
  const start = html.indexOf(name, html.indexOf("lx-agrid"));
  return html.slice(html.lastIndexOf("<section", start), html.indexOf("</section>", start));
};

describe("Agents page: a failed settings read (S3)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("says it couldn't read the settings instead of drawing every agent Off", async () => {
    const { html } = await render({ settings: "error" });
    expect(html).toContain("couldn&#x27;t read agent settings");
    expect(html).toContain("Agent settings unavailable");
    expect(html).not.toContain("0 of 3 on");
    expect(html).not.toContain(">Off<");
    expect(html).not.toContain("lx-agent off");
    expect(html).not.toContain('aria-checked="false"');
    expect(html).not.toContain('role="switch"');
  });

  it("still renders the rest of the page", async () => {
    const { html } = await render({ settings: "error" });
    expect(html).toContain("Autopilot");
    expect(html).toContain("Recent runs");
    expect(html).toContain("Email → client intel");
    expect(html).toContain("Intake triage");
  });

  it("does not go looking for mailboxes or the queue it can't ask about", async () => {
    const { listConnections, loadActiveQueue } = await render({ settings: "error" });
    expect(listConnections).not.toHaveBeenCalled();
    expect(loadActiveQueue).not.toHaveBeenCalled();
  });
});

describe("Agents page: honest 'On' (S4)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("email-intel enabled with no active mailbox is waiting for one", async () => {
    const { html } = await render({ settings: [on("email-intel")], connections: { ok: true, connections: [] } });
    const c = card(html, "Email → client intel");
    expect(c).toContain("On · waiting for a mailbox");
    expect(c).toContain("Blocked");
  });

  it("a reconnect-needed mailbox is not an active one", async () => {
    const { html } = await render({ settings: [on("email-intel")], connections: { ok: true, connections: [{ status: "reauth" }] } });
    expect(card(html, "Email → client intel")).toContain("waiting for a mailbox");
  });

  it("an unreadable mailbox list is 'couldn't check', not 'waiting' and not 'On'", async () => {
    const { html } = await render({ settings: [on("email-intel")], connections: { ok: false, error: "x" } });
    const c = card(html, "Email → client intel");
    expect(c).toContain("couldn&#x27;t check mailboxes");
    expect(c).not.toContain("waiting for a mailbox");
  });

  it("a firm without the Mailboxes module sees that on the card, without asking for mailboxes", async () => {
    const { html, listConnections } = await render({ settings: [on("email-intel")], modules: ["agents"] });
    expect(card(html, "Email → client intel")).toContain("Needs the Mailboxes module");
    expect(listConnections).not.toHaveBeenCalled();
  });

  it("one ready and one enabled-but-blocked agent: the header says both", async () => {
    const { html } = await render({ settings: [on("intake-triage"), on("email-intel")], connections: { ok: true, connections: [] } });
    expect(html).toContain("1 of 3 on");
    expect(html).toContain("1 on but blocked");
  });

  it("every enabled agent ready: no 'blocked' anywhere", async () => {
    const { html } = await render({
      settings: [on("intake-triage"), on("email-intel"), off("post-consult")],
      connections: { ok: true, connections: [{ status: "active" }] },
    });
    expect(html).toContain("2 of 3 on");
    expect(html).not.toContain("blocked");
    expect(html).not.toContain("Blocked");
  });

  it("an enabled, ready agent with a last run still shows 'Ran …'", async () => {
    const started = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const { html } = await render({
      settings: [on("intake-triage")],
      runs: [{ id: "r1", agent: "intake-triage", trigger: "cron", status: "ok", started_at: started, finished_at: started, items_in: 2, drafts_out: 0, summary: null, error: null }],
    });
    expect(card(html, "Intake triage")).toContain("Ran ");
  });

  it("an enabled agent that never ran, and is ready, says so", async () => {
    const { html } = await render({ settings: [on("intake-triage")] });
    expect(card(html, "Intake triage")).toContain("On · not run yet");
  });

  it("a switched-off agent says Off", async () => {
    const { html } = await render({ settings: [off("intake-triage")] });
    expect(card(html, "Intake triage")).toContain(">Off<");
  });

  it("post-consult reads the queue only through loadActiveQueue, and reports the three states", async () => {
    for (const [status, text] of [
      ["unconfigured", "needs an approval queue"],
      ["unavailable", "couldn&#x27;t reach the queue"],
    ] as const) {
      vi.resetModules();
      const { html, loadActiveQueue } = await render({ settings: [on("post-consult")], queue: { status, items: [] } });
      expect(loadActiveQueue).toHaveBeenCalled();
      expect(card(html, "Post-consult drafter")).toContain(text);
    }
  });

  it("a switched-on agent without the AI key is blocked", async () => {
    const { html } = await render({ settings: [on("intake-triage")], ai: false });
    expect(card(html, "Intake triage")).toContain("On · needs the AI key");
    expect(html).toContain("1 on but blocked");
  });

  it("does not import listQueue directly (the queue is read only through loadActiveQueue)", () => {
    const src = readFileSync("src/app/dashboard/agents/page.tsx", "utf8");
    expect(src).not.toMatch(/\blistQueue\b/);
    expect(src).toContain("@/lib/queue/load");
  });
});
