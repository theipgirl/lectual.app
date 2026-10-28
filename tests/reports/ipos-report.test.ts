import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportPeriod } from "@/lib/reports/period";

type Table = { data: unknown[] | null; error: { code?: string; message: string } | null; count?: number };

/** A scoped client that answers per table, whatever the query chain. */
function fakeClient(tables: Record<string, Table>) {
  const chain = (result: Table): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        return () => chain(result);
      },
      apply: () => chain(result),
    });
  return { from: (table: string) => chain(tables[table] ?? { data: [], error: null }) };
}

const NOW = new Date("2026-10-20T12:00:00Z");
const period = reportPeriod(30, NOW);
const inPeriod = "2026-10-10T12:00:00Z";

const run = (agent: string, drafts: number, at = inPeriod) => ({ agent, started_at: at, drafts_out: drafts, status: "ok", summary: null });

async function load(opts: {
  queue: { status: "ok" | "unconfigured" | "unavailable"; items: unknown[] };
  settings?: Table;
  runs?: unknown[];
  hasAgents?: boolean;
}) {
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () =>
      fakeClient({
        agent_run: { data: opts.runs ?? [], error: null },
        agent_setting: opts.settings ?? { data: [], error: null },
        crm_firm_brain_entry: { data: [], error: null, count: 7 },
      }),
    ),
  }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => opts.queue) }));
  const { loadIposReport } = await import("@/lib/reports/ipos");
  return loadIposReport(period, { hasAgents: opts.hasAgents ?? true });
}

const kpi = (report: Awaited<ReturnType<typeof load>>, label: string) => report.kpis.find((k) => k.label === label)!;
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}` }));

describe("AI tools report: Waiting in Approvals (S5)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows the queue's real count when it was reached", async () => {
    const report = await load({ queue: { status: "ok", items: items(4) } });
    expect(kpi(report, "Waiting in Approvals").value).toBe(4);
  });

  it("an empty queue that was reached is 0, a real zero", async () => {
    const report = await load({ queue: { status: "ok", items: [] } });
    expect(kpi(report, "Waiting in Approvals").value).toBe(0);
  });

  it("an unreachable queue is unavailable with the reason, never 0", async () => {
    const report = await load({ queue: { status: "unavailable", items: [] } });
    const k = kpi(report, "Waiting in Approvals");
    expect(k.value).toBeNull();
    expect(k.note).toBe("Couldn't check approvals");
  });

  it("no queue connected is unavailable with its own reason", async () => {
    const report = await load({ queue: { status: "unconfigured", items: [] } });
    const k = kpi(report, "Waiting in Approvals");
    expect(k.value).toBeNull();
    expect(k.note).toBe("No approvals connected yet");
  });

  it("keeps the Assistant runs KPI and the Firm notes tile as they were", async () => {
    const report = await load({ queue: { status: "ok", items: [] }, runs: [run("intake-triage", 0), run("email-intel", 0)] });
    expect(kpi(report, "Assistant runs").value).toBe(2);
    expect(report.links.find((l) => l.label === "Firm notes")?.count).toBe(7);
    expect(report.links.map((l) => l.label)).toEqual(["Copilot", "Assistants", "Firm notes"]);
  });
});

describe("AI tools report: the Agents tile (S5)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const agentsTile = (r: Awaited<ReturnType<typeof load>>) => r.links.find((l) => l.label === "Assistants")!;

  it("counts enabled agents, not runs", async () => {
    const report = await load({
      queue: { status: "ok", items: [] },
      settings: { data: [{ agent: "intake-triage", enabled: true }, { agent: "email-intel", enabled: true }, { agent: "post-consult", enabled: false }], error: null },
      runs: [run("intake-triage", 0), run("intake-triage", 0), run("intake-triage", 0), run("email-intel", 0), run("email-intel", 0)],
    });
    expect(kpi(report, "Assistant runs").value).toBe(5);
    expect(agentsTile(report).count).toBe(2);
  });

  it("no enabled agents is a real 0", async () => {
    const report = await load({ queue: { status: "ok", items: [] }, settings: { data: [{ agent: "intake-triage", enabled: false }], error: null } });
    expect(agentsTile(report).count).toBe(0);
  });

  it("a failed settings read shows no count at all, not 0", async () => {
    const report = await load({ queue: { status: "ok", items: [] }, settings: { data: null, error: { message: "boom" } } });
    expect(agentsTile(report).count).toBeNull();
  });

  it("a settings table that isn't in this environment shows no count either", async () => {
    const report = await load({ queue: { status: "ok", items: [] }, settings: { data: null, error: { code: "42P01", message: "relation does not exist" } } });
    expect(agentsTile(report).count).toBeNull();
  });
});

describe("AI tools report: Drafts out says what it counts (S5)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("when the queue holds more than the agents wrote, it says the queue also gets Cowork and staff drafts", async () => {
    const report = await load({ queue: { status: "ok", items: items(9) }, runs: [run("post-consult", 2)] });
    const k = kpi(report, "Drafts out");
    expect(k.value).toBe(2);
    expect(k.sub).toContain("Lectual's own agents");
    expect(k.sub).toContain("Cowork skills and staff actions");
  });

  it("when the queue holds no more, it says only that they are the agents' drafts", async () => {
    const report = await load({ queue: { status: "ok", items: items(2) }, runs: [run("post-consult", 2)] });
    const k = kpi(report, "Drafts out");
    expect(k.sub).toBe("drafts written by Lectual's own agents in the period");
    expect(k.sub).not.toContain("Cowork");
  });

  it("an unreachable queue doesn't claim the queue holds more", async () => {
    const report = await load({ queue: { status: "unavailable", items: [] }, runs: [run("post-consult", 2)] });
    expect(kpi(report, "Drafts out").sub).not.toContain("Cowork");
  });

  it("only drafts from the period count", async () => {
    const report = await load({ queue: { status: "ok", items: [] }, runs: [run("post-consult", 3), run("post-consult", 5, "2026-01-01T00:00:00Z")] });
    expect(kpi(report, "Drafts out").value).toBe(3);
  });
});
