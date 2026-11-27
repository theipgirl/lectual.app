import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnerDeadline, OwnerProposal } from "@/lib/today/owner-rules";
import type { TodayConsultsResult } from "@/lib/calendar/consult-sources";
import type { Role } from "@/lib/auth/roles";

process.env.__NEXT_TRAILING_SLASH = "true";
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "");
const NOW = new Date("2026-11-10T15:00:00Z");

type Reads = {
  queue?: { status: "ok" | "unconfigured" | "unavailable"; items?: unknown[] } | "throw";
  tasks?: unknown[] | "fail";
  consults?: TodayConsultsResult | "fail";
  deadlines?: OwnerDeadline[] | "fail";
  proposals?: OwnerProposal[] | "fail";
  proposalsModule?: boolean;
  ai?: boolean;
  role?: Role;
};

const dl = (over: Partial<OwnerDeadline> = {}): OwnerDeadline => ({ key: "d1", href: "/dashboard/matters/m1/", name: "Office action response", detail: "TM-1 · The Pleat", dueDate: "2026-11-12", overdueDays: 0, ...over });
const task = (over: Record<string, unknown> = {}) => ({ id: "t1", title: "Call the client", status: "open", due_at: "2026-11-09T15:00:00Z", assignee_id: "u1", matter_id: "m1", lead_id: null, ...over });
const okConsults: TodayConsultsResult = { consults: [], outlook: "ok", zoom: "ok" };
const proposalsReader = vi.fn();
const dealSummary = vi.fn();

async function render(r: Reads = {}) {
  vi.resetModules();
  proposalsReader.mockReset();
  dealSummary.mockReset();
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => r.ai ?? true }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => r.proposalsModule ?? true) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: "u1", displayName: "Ann Brown", identified: true }]) }));
  vi.doMock("@/lib/queue/load", () => ({
    loadActiveQueue: vi.fn(async () => {
      if (r.queue === "throw") throw new Error("boom secret");
      return { items: [], ...(r.queue ?? { status: "ok", items: [{ id: "q1" }] }) };
    }),
  }));
  vi.doMock("@/lib/queue/mine-load", () => ({ mineQueue: vi.fn(async (l: unknown) => l) }));
  vi.doMock("@/lib/queue/deck-summary", () => ({ loadDeckSummary: dealSummary }));
  vi.doMock("@/lib/matters", () => ({
    listTasks: vi.fn(async () => {
      if (r.tasks === "fail") throw new Error("boom secret");
      return r.tasks ?? [task()];
    }),
  }));
  vi.doMock("@/lib/calendar/consult-sources", async (orig) => ({
    ...(await orig<typeof import("@/lib/calendar/consult-sources")>()),
    loadTodayConsults: vi.fn(async () => {
      if (r.consults === "fail") throw new Error("boom secret");
      return r.consults ?? okConsults;
    }),
  }));
  vi.doMock("@/lib/calendar/consult-sources-live", () => ({ liveConsultDeps: {} }));
  vi.doMock("@/lib/today/owner-load", () => ({
    loadOwnerDeadlines: vi.fn(async () => {
      if (r.deadlines === "fail") throw new Error("boom secret");
      return r.deadlines ?? [dl()];
    }),
    loadOwnerProposals: proposalsReader.mockImplementation(async () => {
      if (r.proposals === "fail") throw new Error("boom secret");
      return r.proposals ?? [];
    }),
    loadOwnerNeedsReview: vi.fn(async () => []),
  }));
  const { TeamToday } = await import("@/components/today/TeamToday");
  return text(renderToStaticMarkup(await TeamToday({ userId: "u1", role: r.role ?? "paralegal", email: "a@firm.test", metadata: {}, now: NOW })));
}

beforeEach(() => vi.resetModules());

describe("Team Today", () => {
  it("greets by name and draws the chosen sections", async () => {
    const html = await render();
    expect(html).toContain("Good morning, Ann.");
    for (const s of ["Your approvals", "Your next steps", "Today’s consults", "Deadlines, next 14 days", "This week", "Proposals out", "Ask Copilot"]) expect(html, s).toContain(s);
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("Call the client");
    expect(html).toContain("1 day overdue");
    expect(html).toContain('href="/dashboard/queue/"');
    expect(html).not.toContain("/dashboard/queue/deck/");
  });

  it("omits every owner-only piece", async () => {
    const html = await render();
    for (const gone of ["Your cards", "deal", "Hours saved", "This month", "Overnight run", "couldn't finish", "Finish setting up", "Get set up", "Getting started", "Waiting on you", "ot-hero", "lx-kpi", "$"]) {
      expect(html, gone).not.toContain(gone);
    }
    expect(dealSummary).not.toHaveBeenCalled();
  });

  it("each failed read says Couldn't load, and the others still draw", async () => {
    const html = await render({ queue: { status: "unavailable" }, tasks: "fail", consults: "fail", deadlines: "fail", proposals: "fail" });
    for (const s of ["Couldn't load your approvals.", "Couldn't load your next steps.", "Couldn't load consults.", "Couldn't load deadlines.", "Couldn't load proposals.", "Couldn't load this week."]) expect(html, s).toContain(s);
    expect(html).toContain("Good morning, Ann.");
    expect(html).not.toContain("boom secret");
    for (const lie of ["Nothing is waiting for you.", "No open next steps", "Nothing due in the next 14 days.", "No proposals are out right now.", "No consults today."]) expect(html, lie).not.toContain(lie);
    expect(html).not.toMatch(/\b0 waiting/);
  });

  it("a thrown queue read is Couldn't load, an unconfigured queue says so, and empty is said only for a read that worked", async () => {
    expect(await render({ queue: "throw" })).toContain("Couldn't load your approvals.");
    const none = await render({ queue: { status: "unconfigured" } });
    expect(none).toContain("No approval queue is connected for your firm yet.");
    expect(none).not.toContain("Nothing is waiting for you.");
    const empty = await render({ queue: { status: "ok", items: [] }, tasks: [], deadlines: [], proposals: [] });
    expect(empty).toContain("Nothing is waiting for you.");
    expect(empty).toContain("No open next steps are assigned to you.");
    expect(empty).toContain("Nothing due in the next 14 days.");
    expect(empty).toContain("No proposals are out right now.");
  });

  it("lists only the person's own open steps, soonest first, undated last", async () => {
    const html = await render({
      tasks: [
        task({ id: "a", title: "Undated step", due_at: null }),
        task({ id: "b", title: "Someone else's step", assignee_id: "u2" }),
        task({ id: "c", title: "Done step", status: "done" }),
        task({ id: "d", title: "Later step", due_at: "2026-11-20T15:00:00Z" }),
        task({ id: "e", title: "Sooner step", due_at: "2026-11-11T15:00:00Z" }),
      ],
    });
    expect(html).not.toContain("Someone else's step");
    expect(html).not.toContain("Done step");
    expect(html.indexOf("Sooner step")).toBeLessThan(html.indexOf("Later step"));
    expect(html.indexOf("Later step")).toBeLessThan(html.indexOf("Undated step"));
    expect(html).toContain("No date set");
  });

  it("Proposals out only for a proposal-writing role in a firm with the feature", async () => {
    const off = await render({ proposalsModule: false });
    expect(off).not.toContain("Proposals out");
    expect(proposalsReader).not.toHaveBeenCalled();
    const viewer = await render({ role: "viewer" });
    expect(viewer).not.toContain("Proposals out");
    expect(proposalsReader).not.toHaveBeenCalled();
    const on = await render({ role: "attorney" });
    expect(on).toContain("Proposals out");
    expect(proposalsReader).toHaveBeenCalled();
  });

  it("Ask Copilot only with AI on", async () => {
    expect(await render({ ai: false })).not.toContain("Ask Copilot");
  });
});

describe("Today page branch", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
  it("chooses TeamToday only for the team view, before any technician read, and OwnerToday only for the owner view", () => {
    expect(src).toContain('if (view === "team")');
    expect(src).toContain('if (view === "owner")');
    expect(src.indexOf('if (view === "team")')).toBeLessThan(src.indexOf("const now = new Date();"));
  });
  it("TeamToday imports no write path, no admin client and no deck / agent / setup piece", () => {
    const t = readFileSync(path.join(process.cwd(), "src/components/today/TeamToday.tsx"), "utf8");
    for (const bad of ["db/admin", "deck-summary", "agents/", "GetSetUpCard", "FinishSetupCard", "GettingStartedCard", "autopilot", "estimateHoursSaved"]) expect(t, bad).not.toContain(bad);
  });
});
