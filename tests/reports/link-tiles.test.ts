import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { reportPeriod } from "@/lib/reports/period";

/** A scoped-client stand-in: every query chain resolves to `result`. */
function fakeClient(result: { data: unknown[]; error: null; count?: number }) {
  const chain: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
      return () => chain;
    },
    apply: () => chain,
  });
  // The client itself must not be thenable, or `await getScopedClient()` would consume it.
  return { from: () => chain };
}

function mockCommon(opts: { mattersFail?: boolean } = {}) {
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => fakeClient({ data: [], error: null, count: 3 })) }));
  vi.doMock("@/lib/matters", () => ({
    listMatters: vi.fn(async () => {
      if (opts.mattersFail) throw new Error("down");
      return [];
    }),
    listUpcomingDeadlines: vi.fn(async () => []),
    matterLabel: vi.fn(() => "Matter"),
    summarizeDocket: vi.fn(() => ({ open: 0, waitingOn: { firm: 0 } })),
  }));
  vi.doMock("@/lib/pipeline", () => ({ listLeads: vi.fn(async () => []) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "ok", items: [] })) }));
}

const period = reportPeriod(30, new Date("2026-10-20T12:00:00Z"));
const labels = (links: { label: string }[]) => links.map((l) => l.label);
const hrefs = (links: { href: string }[]) => links.map((l) => l.href);

describe("report link tiles hide unbuilt sections (F12)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("matters report: no Client portals tile on the success path", async () => {
    mockCommon();
    const { loadMattersReport } = await import("@/lib/reports/matters");
    const report = await loadMattersReport(period);
    expect(labels(report.links)).toEqual(["All matters", "Pipeline", "Documents"]);
  });

  it("matters report: no Client portals tile when matters fail to load", async () => {
    mockCommon({ mattersFail: true });
    const { loadMattersReport } = await import("@/lib/reports/matters");
    const report = await loadMattersReport(period);
    expect(report.banner).toBe("Matters couldn't be loaded.");
    expect(labels(report.links)).toEqual(["All matters", "Pipeline", "Documents"]);
  });

  it("IP.OS report: no Skills tile, other tiles kept", async () => {
    mockCommon();
    const { loadIposReport } = await import("@/lib/reports/ipos");
    const report = await loadIposReport(period, { hasAgents: true });
    expect(labels(report.links)).toEqual(["AI copilot", "Agents", "Firm brain"]);
    const noAgents = await loadIposReport(period, { hasAgents: false });
    expect(labels(noAgents.links)).toEqual(["AI copilot", "Firm brain"]);
  });

  it("communication report: no SMS tile, other tiles kept", async () => {
    mockCommon();
    const { loadCommunicationReport } = await import("@/lib/reports/communication");
    const report = await loadCommunicationReport(period, { hasMailbox: true, hasAgents: true });
    expect(labels(report.links)).toEqual(["My Mail", "Queue", "Campaigns"]);
  });

  it("no report link points at an unbuilt section", async () => {
    mockCommon();
    const all = [
      ...(await (await import("@/lib/reports/matters")).loadMattersReport(period)).links,
      ...(await (await import("@/lib/reports/ipos")).loadIposReport(period, { hasAgents: true })).links,
      ...(await (await import("@/lib/reports/communication")).loadCommunicationReport(period, { hasMailbox: true, hasAgents: true })).links,
    ];
    for (const href of hrefs(all)) expect(href).not.toMatch(/\/dashboard\/(sms|portals|skills)\//);
  });
});

describe("source references to unbuilt sections", () => {
  it("only src/lib/nav.ts names /dashboard/sms, /portals or /skills", () => {
    const out = execSync(`grep -rln "dashboard/\\(sms\\|portals\\|skills\\)" src || true`, { encoding: "utf8" }).trim();
    expect(out.split("\n").filter(Boolean)).toEqual(["src/lib/nav.ts"]);
  });
});
