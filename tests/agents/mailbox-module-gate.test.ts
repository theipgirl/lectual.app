import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sealToken } from "@/lib/mailbox/crypto";
import { buildRunDigest } from "@/lib/agents/digest";
import { AGENT_IDS, agentNeedsAi } from "@/lib/agents/types";
import { fakeAdmin, type Handler, type Recorded } from "../mailbox/fake-db";
import { fakeLlm, NOW } from "./helpers";
import { memDb, type Tables } from "./mem-db";

/**
 * Sprint 17 registry, Run now and the Mailboxes module gate, through BOTH entry points: the cron's
 * runAllAgents and the Agents page's runAgentNowAction. Both end in runOneAgent, which reads the firm's
 * module list in the single crm_org statement it already makes.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const root = randomBytes(32);

const state = vi.hoisted(() => ({
  deps: null as unknown,
  ai: true,
  settingEnabled: true,
  autonomy: "draft",
  autopilot: { status: "ok", state: { paused: false } } as unknown,
}));

vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => m === "agents" }));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: async () => ({ kind: "ok", org: { id: "11111111-1111-1111-1111-111111111111" }, user: { id: "user-1" }, role: "owner" }),
}));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => state.ai }));
vi.mock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => state.deps }));
vi.mock("@/lib/agents/autopilot", () => ({ loadAutopilot: async () => state.autopilot }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.settingEnabled ? { enabled: true, autonomy: state.autonomy } : { enabled: false, autonomy: "draft" }, error: null }) }) }),
    }),
  }),
}));

const { runAgentNowAction } = await import("@/app/dashboard/agents/actions");
const { runAllAgents, runOneAgent } = await import("@/lib/agents/runner");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const form = (e: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(e)) fd.set(k, v);
  return fd;
};

/** A populated firm: a stalled lead, a consult in 5 hours, a needs-you email, a pending queue item. */
function world(opts: { modules: string[] | "missing" | "error"; settings?: Array<[string, boolean]>; llm?: unknown[] }) {
  const tables: Tables = {
    // "missing" and "error" still give the cron a firm that holds `agents`; it is the per-run read of the firm's own row that fails.
    crm_org: [{ id: ORG, queue_org_key: "firm-queue-key", modules: opts.modules === "error" || opts.modules === "missing" ? ["agents"] : opts.modules }],
    agent_setting: (opts.settings ?? AGENT_IDS.map((a): [string, boolean] => [a, ["morning-brief", "consult-prep", "inbox-summary"].includes(a)])).map(([agent, enabled]) => ({ org_id: ORG, agent, enabled, autonomy: "draft" })),
    agent_run: [],
    agent_autopilot: [],
    mailbox_connection: [
      {
        id: "c1",
        org_id: ORG,
        provider: "microsoft",
        email: "attorney@firm.example",
        scope: "personal",
        status: "active",
        access_token_enc: sealToken(root, "tok"),
        refresh_token_enc: sealToken(root, "r"),
        token_expires_at: "2099-01-01T00:00:00Z",
        scopes: [],
      },
    ],
    crm_stage: [{ id: "s1", org_id: ORG, name: "Discovery", category: "open", aging_threshold_days: 14 }],
    crm_lead: [
      {
        id: "lead-1",
        org_id: ORG,
        first_name: "Dana",
        last_name: "Ruiz",
        business_name: "Sankofa",
        email: "dana@client.example",
        practice_area: "Trademark",
        mark_text: "SANKOFA",
        current_stage_id: "s1",
        stage_entered_at: daysAgo(9),
        last_activity_at: daysAgo(9),
        last_inbound_at: daysAgo(3),
        last_outbound_at: daysAgo(9),
        created_at: daysAgo(30),
        referral_source: null,
        referral_detail: null,
        phone: null,
      },
    ],
    crm_calendar_event: [{ id: "e1", org_id: ORG, lead_id: "lead-1", source: "outlook", is_consult: true, starts_at: new Date(NOW + 5 * 3_600_000).toISOString(), join_url: null, all_day: false }],
    crm_matter_deadline: [{ id: "d1", org_id: ORG, matter_id: "m1", kind: "other", title: "A deadline", due_date: "2026-09-30", attorney_confirmed: true, status: "open" }],
    crm_matter: [{ id: "m1", org_id: ORG, matter_number: "TM-1", title: "T", mark_text: "SANKOFA" }],
    crm_activity: [],
    crm_org_profile: [],
    crm_intake_submission: [],
    crm_intake_form: [],
    crm_booth_scorecard: [],
    crm_meeting: [],
  };
  const db = memDb(tables, { failures: opts.modules === "error" ? (q) => (q.table === "crm_org" && q.filters.some((f) => f.column === "id") ? { message: "boom" } : undefined) : undefined });
  const handler: Handler = (q) => (opts.modules === "missing" && q.table === "crm_org" && q.filters.some((f) => f.column === "id") ? { data: null, error: null } : db.handler(q));
  const { client, log } = fakeAdmin(handler);
  const requests: Array<{ url: string; method: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (init?.method === "POST") return json({ id: "draft-1", webLink: "https://outlook.example/d" }, 201);
    if (url.includes("/mailFolders/inbox/messages?"))
      return json({ value: [{ id: "N1", conversationId: "c-n1", subject: "Please advise", bodyPreview: "p", from: { emailAddress: { name: "Pat", address: "pat@client.example" } }, toRecipients: [], receivedDateTime: hoursAgo(2) }] });
    if (url.includes("/mailFolders/drafts/messages?")) return json({ value: [] });
    return json({ body: { contentType: "text", content: "Hello" } });
  }) as typeof fetch;
  const createDraft = vi.fn<(d: { type: string; agent: string }) => Promise<{ id: string }>>(async () => ({ id: `q-${log.length}` }));
  // One canned answer that satisfies every agent's schema (reply, follow-up fields, generated text).
  const canned = { reply: "Thanks.\n\nBest,\n[Attorney name]", text: "Dear Dana,\n\nPlease bring the name.\n\nWarm regards", subject: "Checking in", body: "Hello.\n\nBest,\n[Attorney name]", internal_summary: "Quiet for a while." };
  const { llm } = fakeLlm(...(opts.llm ?? [canned]));
  const admin = client as unknown as SupabaseClient;
  const deps = {
    admin,
    llm,
    createDraft,
    listPending: async () => [],
    fetchImpl,
    now: () => NOW,
    mailbox: { admin, root, credentials: () => ({ clientId: "c", clientSecret: "s" }) },
  };
  state.deps = deps;
  return { db, log, requests, createDraft, deps };
}

const crmOrgOneRow = (log: Recorded[]) => log.filter((q) => q.table === "crm_org" && q.action === "select" && q.filters.some((f) => f.column === "id" && f.op === "eq"));
const updates = (log: Recorded[]) => log.filter((q) => q.table === "agent_run" && q.action === "update").map((q) => q.values as { status: string; summary: string | null; error: string | null; items_in: number; drafts_out: number });
const THREE = ["morning-brief", "consult-prep", "inbox-summary"] as const;

beforeEach(() => {
  state.ai = true;
  state.settingEnabled = true;
  state.autonomy = "draft";
  state.autopilot = { status: "ok", state: { paused: false } };
});

/** Drives one agent for the firm through the named entry point and returns what happened. */
async function drive(entry: "cron" | "run-now", agent: (typeof THREE)[number], w: ReturnType<typeof world>) {
  if (entry === "cron") {
    const outcomes = await runAllAgents(w.deps as never);
    return outcomes.find((o) => o.agent === agent)!;
  }
  const res = await runAgentNowAction({}, form({ agent }));
  const row = updates(w.log).at(-1)!;
  return { agent, status: row.status as "ok" | "error" | "skipped", result: { summary: row.summary ?? "" }, res };
}

describe.each(["cron", "run-now"] as const)("F21: the Mailboxes module gate at run time, through %s", (entry) => {
  const only = (agent: (typeof THREE)[number]): Array<[string, boolean]> => AGENT_IDS.map((a): [string, boolean] => [a, a === agent]);

  it("(i) inbox-summary: skipped with 'the Mailboxes module is off', ZERO provider requests, no Outlook draft, no queue draft", async () => {
    const w = world({ modules: ["agents"], settings: only("inbox-summary") });
    const out = await drive(entry, "inbox-summary", w);
    expect(out.status).toBe("skipped");
    expect(out.result!.summary).toContain("the Mailboxes module is off");
    expect(w.requests).toHaveLength(0);
    expect(w.createDraft).not.toHaveBeenCalled();
    expect(w.log.some((q) => q.table === "mailbox_connection")).toBe(false);
  });

  it("(ii) consult-prep: skipped with the same reason, not 'no consults', and no calendar, lead, answers or timeline statement", async () => {
    const w = world({ modules: ["agents"], settings: only("consult-prep") });
    const out = await drive(entry, "consult-prep", w);
    expect(out.status).toBe("skipped");
    expect(out.result!.summary).toContain("the Mailboxes module is off");
    expect(out.result!.summary).not.toMatch(/no consults/i);
    expect(w.log.filter((q) => ["crm_calendar_event", "crm_lead", "crm_intake_submission", "crm_activity", "crm_meeting"].includes(q.table))).toHaveLength(0);
    expect(w.createDraft).not.toHaveBeenCalled();
  });

  it("(iii) morning-brief: still writes the brief, its consults section says the module is off, no calendar statement, the other five sections are populated", async () => {
    const w = world({ modules: ["agents"], settings: only("morning-brief") });
    const out = await drive(entry, "morning-brief", w);
    expect(out.status).toBe("ok");
    const brief = w.createDraft.mock.calls.map((c) => c[0] as unknown as { type: string; draftBody: string }).find((d) => d.type === "BRIEFING")!;
    const body = brief.draftBody;
    expect(body).toContain("Today's consults (not read)");
    expect(body).toContain("Not read: the Mailboxes module is off.");
    expect(body).not.toContain("Nothing today.\n\nLeads waiting"); // the consults section is neither empty...
    expect(body).not.toMatch(/Today's consults \(could not be read\)/); // ...nor failed
    expect(w.log.some((q) => q.table === "crm_calendar_event")).toBe(false);
    expect(body).toContain("Leads waiting on a reply (1)");
    expect(body).toContain("Stalled leads (1)");
    expect(body).toContain("Matters with deadlines in the next 14 days (1)");
    expect(body).toContain("Pending stage suggestions (0)");
    expect(body).toContain("The queue (0)");
  });

  it("(iv) with the module present the same fixtures run normally", async () => {
    const w = world({ modules: ["agents", "mailbox"], settings: AGENT_IDS.map((a): [string, boolean] => [a, true]) });
    if (entry === "cron") {
      const outcomes = await runAllAgents(w.deps as never);
      const by = Object.fromEntries(outcomes.map((o) => [o.agent, o.status]));
      expect(by).toMatchObject({ "morning-brief": "ok", "consult-prep": "ok", "inbox-summary": "ok" });
    } else {
      for (const agent of THREE) {
        state.settingEnabled = true;
        const res = await runAgentNowAction({}, form({ agent }));
        expect(res.ok).toBe(true);
      }
    }
    expect(w.requests.some((r) => r.url.includes("/mailFolders/inbox/messages?"))).toBe(true);
    expect(w.log.some((q) => q.table === "crm_calendar_event")).toBe(true);
    const brief = w.createDraft.mock.calls.map((c) => c[0] as unknown as { type: string; draftBody: string }).find((d) => d.draftBody.includes("Morning brief") || d.draftBody.startsWith("Today's consults"))!;
    expect(brief.draftBody).toContain("Today's consults (1)");
  });

  it.each([
    ["the read fails", "error" as const],
    ["the firm has no row", "missing" as const],
  ])("(v) when %s the modules reading is 'could not be read': all three act as if the module were off and say 'couldn't check the Mailboxes module'", async (_name, modules) => {
    const w = world({ modules, settings: THREE.map((a): [string, boolean] => [a, true]) });
    const outcomes: Array<{ agent: string; status: string; summary: string }> = [];
    for (const agent of THREE) {
      const out = await drive(entry, agent, w);
      outcomes.push({ agent, status: out.status, summary: (out as { result?: { summary?: string } }).result?.summary ?? "" });
    }
    const by = Object.fromEntries(outcomes.map((o) => [o.agent, o]));
    expect(by["inbox-summary"].status).toBe("skipped");
    expect(by["inbox-summary"].summary).toContain("couldn't check the Mailboxes module");
    expect(by["consult-prep"].status).toBe("skipped");
    expect(by["consult-prep"].summary).toContain("couldn't check the Mailboxes module");
    expect(w.requests).toHaveLength(0);
    expect(w.log.some((q) => q.table === "crm_calendar_event")).toBe(false);
    // The same read that failed also carried the queue key, so the brief cannot be filed: it says why, in the same words.
    expect(by["morning-brief"].status).toBe("skipped");
    expect(by["morning-brief"].summary).toContain("couldn't check the Mailboxes module");
    expect(w.createDraft).not.toHaveBeenCalled();
  });

  it("(vi) a firm with Mailboxes off still has the other agents unaffected", async () => {
    const w = world({ modules: ["agents"], settings: AGENT_IDS.map((a): [string, boolean] => [a, a === "intake-triage"]) });
    w.db.tables.crm_lead[0].ai_enriched_at = daysAgo(1); // nothing left to triage: the run is quiet, not blocked
    const out = entry === "cron" ? (await runAllAgents(w.deps as never)).find((o) => o.agent === "intake-triage")! : await runOneAgent(w.deps as never, { orgId: ORG, agent: "intake-triage", autonomy: "draft", trigger: "manual" });
    expect(out.status).toBe("ok");
  });

  it("(vii) the module list rides on the ONE crm_org statement the runner already makes", async () => {
    const w = world({ modules: ["agents", "mailbox"], settings: only("inbox-summary") });
    await drive(entry, "inbox-summary", w);
    const reads = crmOrgOneRow(w.log);
    expect(reads).toHaveLength(1);
    expect(reads[0].columns).toContain("modules");
    expect(reads[0].columns).toContain("queue_org_key");
  });

  it("(viii) a skipped run still writes its counts-only agent_run row, and the Overnight digest shows the reason in words", async () => {
    const w = world({ modules: ["agents"], settings: only("inbox-summary") });
    await drive(entry, "inbox-summary", w);
    const [row] = updates(w.log);
    expect(row).toMatchObject({ status: "skipped", items_in: 0, drafts_out: 0, error: null });
    expect(row.summary).toBe("Skipped: the Mailboxes module is off.");
    const digest = buildRunDigest([{ agent: "inbox-summary", status: row.status, started_at: new Date(NOW - 60_000).toISOString(), items_in: 0, drafts_out: 0, summary: row.summary, error: null }], new Date(NOW));
    expect(digest).toMatchObject({ status: "ok" });
    const lines = (digest as { lines: Array<{ text: string }> }).lines;
    expect(lines[0].text).toBe("didn't run: Skipped: the Mailboxes module is off.");
  });
});

describe("F21 (vii): the module name is defined in one place", () => {
  it('grep -rn "\\"mailbox\\"" src/lib/agents finds only the gate', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && readFileSync(p, "utf8").includes('"mailbox"')) hits.push(p);
      }
    };
    walk("src/lib/agents");
    expect(hits).toEqual([path.join("src/lib/agents", "mailbox-gate.ts")]);
  });
});

describe("F18: the seven-agent registry through the cron", () => {
  it("has seven agents and runs the three new ones for a firm that enabled them", async () => {
    expect(AGENT_IDS).toHaveLength(7);
    const w = world({ modules: ["agents", "mailbox"] });
    const outcomes = await runAllAgents(w.deps as never);
    expect(outcomes.map((o) => o.agent)).toEqual(["morning-brief", "consult-prep", "inbox-summary"]);
    expect(outcomes.every((o) => o.status === "ok")).toBe(true);
  });

  it("runs none of them for a firm that did not enable them, or that lacks the agents module", async () => {
    const off = world({ modules: ["agents", "mailbox"], settings: AGENT_IDS.map((a): [string, boolean] => [a, false]) });
    expect(await runAllAgents(off.deps as never)).toEqual([]);
    const none = world({ modules: ["mailbox"] });
    none.db.tables.crm_org = []; // the cron selects firms that hold `agents`: there are none
    expect(await runAllAgents(none.deps as never)).toEqual([]);
  });

  it("a paused Autopilot stops them like every other agent", async () => {
    const w = world({ modules: ["agents", "mailbox"] });
    w.db.tables.agent_autopilot = [{ org_id: ORG, paused: true }];
    expect(await runAllAgents(w.deps as never)).toEqual([]);
    expect(w.createDraft).not.toHaveBeenCalled();
    expect(w.requests).toHaveLength(0);
  });

  it("one agent failing does not stop the next, and each run row carries counts only", async () => {
    const w = world({ modules: ["agents", "mailbox"] });
    // morning-brief fails: every source it reads is down
    w.db.tables.crm_stage = undefined as never;
    const real = w.db.handler;
    const failing = fakeAdmin((q) => (["crm_stage", "crm_calendar_event", "crm_matter_deadline"].includes(q.table) || (q.table === "crm_activity" && q.filters.some((f) => f.value === "ai_insight")) ? { data: null, error: { message: "down: planted-secret" } } : real(q)));
    const deps = { ...(w.deps as object), admin: failing.client as unknown as SupabaseClient, listPending: async () => Promise.reject(new Error("down")) };
    const outcomes = await runAllAgents(deps as never);
    expect(outcomes.map((o) => `${o.agent}:${o.status}`)).toEqual(["morning-brief:error", "consult-prep:error", "inbox-summary:ok"]);
    const rows = updates(failing.log);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/planted-secret|Dana|client\.example|Pat/);
  });
});

describe("F20: Run now for each new agent", () => {
  it.each(THREE)("%s still needs the AI key, the setting being on, and Autopilot not paused; and returns the counts-only summary", async (agent) => {
    expect(agentNeedsAi(agent)).toBe(true);
    const w = world({ modules: ["agents", "mailbox"], settings: THREE.map((a): [string, boolean] => [a, true]) });

    state.ai = false;
    expect(await runAgentNowAction({}, form({ agent }))).toEqual({ error: "The AI key isn't configured on this deployment." });
    state.ai = true;

    state.settingEnabled = false;
    expect(await runAgentNowAction({}, form({ agent }))).toEqual({ error: "Switch the agent on first." });
    state.settingEnabled = true;

    state.autopilot = { status: "ok", state: { paused: true } };
    expect((await runAgentNowAction({}, form({ agent }))).error).toMatch(/Autopilot is paused/);
    state.autopilot = { status: "ok", state: { paused: false } };
    expect(w.createDraft).not.toHaveBeenCalled();

    const res = await runAgentNowAction({}, form({ agent }));
    expect(res.ok).toBe(true);
    expect(res.message).toBeTruthy();
    expect(res.message).not.toMatch(/Dana|Ruiz|Pat|client\.example|Sankofa/);
  });
});
