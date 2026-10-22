import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_DEFS } from "@/lib/agents/types";

type Setting = { agent: string; enabled: boolean; autonomy: string };
type Run = { id: string; agent: string; trigger: string; status: string; started_at: string; finished_at: string | null; items_in: number; drafts_out: number; summary: string | null; error: string | null };

type Case = {
  settings?: Setting[];
  runs?: Run[];
  modules?: string[];
  connections?: { ok: true; connections: { status: string }[] } | { ok: false; error: string };
  queue?: { status: "ok" | "unconfigured" | "unavailable"; items: unknown[] };
  ai?: boolean;
  /** What the Outlook calendar probe finds. */
  calendar?: "events" | "empty" | "error" | "columns-missing";
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

const CALENDAR = {
  events: { data: [{ id: "e1" }], error: null },
  empty: { data: [], error: null },
  error: { data: null, error: { code: "XX000", message: "raw failure: planted-secret" } },
  "columns-missing": { data: null, error: { code: "42703", message: 'column "source" does not exist' } },
} as const;

async function render(c: Case) {
  const loadActiveQueue = vi.fn(async () => c.queue ?? { status: "ok", items: [] });
  const listConnections = vi.fn(async () => c.connections ?? { ok: true as const, connections: [{ status: "active" }] });
  vi.doMock("next/navigation", () => ({
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () =>
      fakeClient({
        agent_setting: { data: c.settings ?? [], error: null },
        agent_run: { data: c.runs ?? [], error: null },
        crm_calendar_event: CALENDAR[c.calendar ?? "events"],
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
  vi.doMock("@/app/dashboard/agents/actions", () => ({ saveAgentSettingAction: vi.fn(), runAgentNowAction: vi.fn(), setAutopilotAction: vi.fn(), saveMinutesPerTaskAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/agents/page");
  return { html: renderToStaticMarkup(await Page()), loadActiveQueue, listConnections };
}

const on = (agent: string): Setting => ({ agent, enabled: true, autonomy: "draft" });
const off = (agent: string): Setting => ({ agent, enabled: false, autonomy: "draft" });
const NAMES = { "morning-brief": "Morning brief", "consult-prep": "Consult prep", "inbox-summary": "Inbox summary" } as const;
const card = (html: string, name: string) => {
  const start = html.indexOf(`>${name}</div>`, html.indexOf("lx-agrid"));
  return html.slice(html.lastIndexOf("<section", start), html.indexOf("</section>", start));
};
const footText = (c: string) => /<span class="lx-note" style="flex:1" title="[^"]*">([^<]*)<\/span>/.exec(c)?.[1] ?? "";
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("Agents page: the three new cards (V1)", () => {
  beforeEach(() => vi.resetModules());

  it("renders seven cards and 'N of 7 on'", async () => {
    const { html } = await render({ settings: [on("morning-brief")] });
    expect(html).toContain("1 of 7 on");
    expect((html.match(/<section class="lx-card lx-agent/g) ?? []).length).toBe(7);
  });

  it("each new card uses the existing card markup: name, reads, description, switch, autonomy with its hint, Run now, status", async () => {
    const { html } = await render({ settings: [on("morning-brief"), on("consult-prep"), on("inbox-summary")] });
    const old = card(html, "Post-consult drafter");
    const shape = (c: string) => [...new Set([...c.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(" ")))].sort();
    for (const [id, name] of Object.entries(NAMES)) {
      const c = card(html, name);
      expect(c).toContain(`Reads · ${AGENT_DEFS[id as keyof typeof NAMES].reads}`);
      expect(c).toContain("lx-agent-desc");
      expect(c).toContain('role="switch"');
      expect(c).toContain("Autonomy");
      expect(c).toContain("Run now");
      expect(c).toContain("lx-agent-foot");
      // the hint under the autonomy control says what Draft does for this agent
      expect(c).toMatch(/nothing is sent/i);
      expect(c).not.toMatch(/style="[^"]*(color|background):/); // no inline restyle beyond what the older cards carry
      // no class the older cards do not also use
      for (const cls of shape(c)) expect(shape(old).concat(["lx-pill", "lx-pill-ok", "lx-pill-warn", "lx-pill-risk", "off"])).toContain(cls);
    }
  });

  it("the text of each new card, once, so a wording change is a deliberate one", async () => {
    const { html } = await render({ settings: [off("morning-brief"), off("consult-prep"), off("inbox-summary")] });
    const text = (name: string) => decode(card(html, name).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    expect(text("Morning brief")).toMatchInlineSnapshot(`"Autonomy Suggest Draft Act Writes the internal briefing and a follow-up email draft for each stalled lead. Everything waits in the approval queue; nothing is sent. Run now Morning brief Reads · Leads, matters, consults and the queue Writes the attorney a daily briefing into the approval queue: today's consults, leads waiting on a reply, stage suggestions, stalled leads, deadlines in the next 14 days and the queue count. For up to five stalled leads a day it also drafts a follow-up email. It only drafts: an attorney reviews and sends everything. Off"`);
    expect(text("Consult prep")).toContain("Reads · Outlook consults and the lead record");
    expect(text("Inbox summary")).toContain("Reads · Connected mailboxes");
  });
});

describe("Agents page: readiness drives each new card (D3)", () => {
  beforeEach(() => vi.resetModules());

  /** Switch on all three, change one thing, and report which of the three cards read which label. */
  async function labels(c: Case) {
    const { html } = await render({ settings: [on("morning-brief"), on("consult-prep"), on("inbox-summary")], ...c });
    return Object.fromEntries(Object.entries(NAMES).map(([id, name]) => [id, decode(footText(card(html, name)))])) as Record<keyof typeof NAMES, string>;
  }

  it("all ready: each reads 'On · not run yet' and the header counts them", async () => {
    const out = await labels({});
    expect(Object.values(out)).toEqual(["On · not run yet", "On · not run yet", "On · not run yet"]);
    const { html } = await render({ settings: [on("morning-brief"), on("consult-prep"), on("inbox-summary")] });
    expect(html).toContain("3 of 7 on");
    expect(html).not.toContain("on but blocked");
  });

  it("no Mailboxes module: inbox-summary and consult-prep need it; morning-brief does not", async () => {
    const out = await labels({ modules: ["agents"] });
    expect(out).toEqual({ "morning-brief": "On · not run yet", "consult-prep": "Needs the Mailboxes module", "inbox-summary": "Needs the Mailboxes module" });
  });

  it("no active mailbox: only inbox-summary is waiting", async () => {
    const out = await labels({ connections: { ok: true, connections: [{ status: "reauth" }] } });
    expect(out["inbox-summary"]).toBe("On · waiting for a mailbox");
    expect(out["consult-prep"]).toBe("On · not run yet");
    expect(out["morning-brief"]).toBe("On · not run yet");
  });

  it("an unreadable mailbox list: only inbox-summary says it couldn't check", async () => {
    const out = await labels({ connections: { ok: false, error: "raw" } });
    expect(out["inbox-summary"]).toBe("On · couldn't check mailboxes");
    expect(out["consult-prep"]).toBe("On · not run yet");
  });

  it("no calendar events: only consult-prep is waiting", async () => {
    const out = await labels({ calendar: "empty" });
    expect(out["consult-prep"]).toBe("On · waiting for calendar events");
    expect(out["inbox-summary"]).toBe("On · not run yet");
    expect(out["morning-brief"]).toBe("On · not run yet");
  });

  it("an unreadable calendar: only consult-prep says it couldn't check, and no raw error reaches the page", async () => {
    const { html } = await render({ settings: [on("consult-prep"), on("inbox-summary")], calendar: "error" });
    expect(decode(footText(card(html, "Consult prep")))).toBe("On · couldn't check the calendar");
    expect(decode(footText(card(html, "Inbox summary")))).toBe("On · not run yet");
    expect(html).not.toContain("planted-secret");
  });

  it("no approval queue: all three need one", async () => {
    const out = await labels({ queue: { status: "unconfigured", items: [] } });
    expect(Object.values(out)).toEqual(["On · needs an approval queue", "On · needs an approval queue", "On · needs an approval queue"]);
  });

  it("an unreachable queue: all three say they couldn't reach it, never 'none'", async () => {
    const out = await labels({ queue: { status: "unavailable", items: [] } });
    expect(Object.values(out)).toEqual(["On · couldn't reach the queue", "On · couldn't reach the queue", "On · couldn't reach the queue"]);
  });

  it("a missing AI key: all three need it", async () => {
    const out = await labels({ ai: false });
    expect(Object.values(out)).toEqual(["On · needs the AI key", "On · needs the AI key", "On · needs the AI key"]);
  });

  it("a pending database update: all three read 'Not available until the database update', on or off, and nothing else does", async () => {
    const onOut = await labels({ calendar: "columns-missing" });
    expect(Object.values(onOut)).toEqual(Array(3).fill("Not available until the database update"));
    const { html } = await render({ settings: [off("morning-brief"), on("stage-keeper")], calendar: "columns-missing" });
    for (const name of Object.values(NAMES)) expect(decode(footText(card(html, name)))).toBe("Not available until the database update");
    expect(decode(footText(card(html, "Email → client intel")))).toBe("Off");
    expect(card(html, "Stage Keeper")).not.toContain("Not available until the database update");
    // the header counts: the Stage Keeper is the only agent on, and it is blocked on its own sources, so none is "ready"
    expect(html).toContain("0 of 7 on");
  });

  it("the header says how many are on but blocked", async () => {
    const { html } = await render({ settings: [on("morning-brief"), on("inbox-summary")], connections: { ok: true, connections: [] } });
    expect(html).toContain("1 of 7 on · 1 on but blocked");
    expect(card(html, "Inbox summary")).toContain("Blocked");
    expect(card(html, "Morning brief")).not.toContain("Blocked");
  });

  it("the queue is read when any agent that writes to it is on, and not otherwise", async () => {
    expect((await render({ settings: [on("inbox-summary")] })).loadActiveQueue).toHaveBeenCalled();
    vi.resetModules();
    expect((await render({ settings: [on("consult-prep")] })).loadActiveQueue).toHaveBeenCalled();
    vi.resetModules();
    expect((await render({ settings: [on("morning-brief")] })).loadActiveQueue).toHaveBeenCalled();
    vi.resetModules();
    expect((await render({ settings: [on("intake-triage")] })).loadActiveQueue).not.toHaveBeenCalled();
  });

  it("the page copy is whole sentences with no raw database wording (V3)", async () => {
    const { html } = await render({ settings: [on("morning-brief"), on("consult-prep"), on("inbox-summary")], calendar: "columns-missing" });
    const text = decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "));
    expect(text).toContain("Ask Lectual to apply the database update");
    expect(text).not.toMatch(/PGRST|42703|23514|violates|does not exist|\bnull\b|undefined|\[object/);
  });
});

describe("Run log and minutes form include the three", () => {
  beforeEach(() => vi.resetModules());

  it("labels a run row with the agent's name, not its id", async () => {
    const run = (agent: string): Run => ({ id: agent, agent, trigger: "cron", status: "ok", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), items_in: 1, drafts_out: 1, summary: "counts only", error: null });
    const { html } = await render({ runs: [run("morning-brief"), run("consult-prep"), run("inbox-summary")] });
    const table = html.slice(html.indexOf("Recent runs"));
    for (const name of Object.values(NAMES)) expect(table).toContain(`<td class="pri">${name}</td>`);
    expect(table).not.toContain('<td class="pri">morning-brief</td>');
  });

  it("Hours saved names the three units", async () => {
    const { html } = await render({});
    const text = decode(html.replace(/<[^>]+>/g, " "));
    expect(text).toContain("5 min per brief or follow-up drafted, 15 min per consult prepped, 3 min per digest or reply drafted");
  });
});
