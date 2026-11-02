import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { row, TODAY } from "./fixtures";

const members = [
  { userId: "u-reb", name: "Rebecca", role: "owner" },
  { userId: "u-rayn", name: "Rayn", role: "paralegal" },
];
const step = (dueDate: string | null, assigneeId: string | null) => ({ id: "t", title: "Follow up", dueDate, assigneeId });
const rows = [
  row({ key: "a", client: "Overdue Co", nextStep: step("2026-10-30", "u-rayn") }),
  row({ key: "b", client: "Week Co", nextStep: step("2026-11-04", "u-reb") }),
  row({ key: "c", client: "Needs Co", nextStep: null }),
  row({ key: "d", client: "Office Co", waiting: "uspto", nextStep: null, deadline: { dueDate: "2026-11-20", title: "Response" } }),
  row({ key: "e", client: "Fine Co", stageLabel: "Application Filed" }),
];

function mock(load: unknown, role: string | null = "attorney") {
  vi.doMock("@/lib/review/load", () => ({ loadReview: vi.fn(async () => load) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => (role ? { kind: "ok", role, user: { id: "u-rayn" } } : { kind: "signed-out", redirectTo: "/" })),
  }));
  vi.doMock("@/app/dashboard/review/actions", () => ({
    setNextStepAction: vi.fn(), completeNextStepAction: vi.fn(), logWhatHappenedAction: vi.fn(),
  }));
}

const ok = (over: object = {}) => ({ status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, failed: [], ...over });

async function render(params: Record<string, string> = {}) {
  const { default: Page } = await import("../../src/app/dashboard/review/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

describe("Weekly review page", () => {
  beforeEach(() => vi.resetModules());

  it("exports a page title", async () => {
    mock(ok());
    const mod = await import("../../src/app/dashboard/review/page");
    expect(String(mod.metadata.title)).toBe("Weekly review · Lectual");
  });

  it("board is the default: h1, tour hook, KPI strip, lanes, columns, collapsed USPTO and on-track", async () => {
    mock(ok());
    const html = await render();
    expect(html).toContain('data-tour="review-head"');
    expect(html).toContain(">Weekly review</h1>");
    expect(html).toContain("rv-kpis");
    expect(html).toContain("Waiting on the USPTO");
    expect(html.indexOf("Rebecca")).toBeLessThan(html.indexOf("Rayn"));
    for (const name of ["Overdue Co", "Week Co", "Needs Co"]) expect(html).toContain(name);
    expect(html).toContain("rv-board");
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>Waiting on the USPTO \(1\)/);
    expect(html).toMatch(/<summary[^>]*>On track \(1\)/);
    expect(html).toMatch(/aria-current="page" class="on" href="[^"]*">Board/);
  });

  it("view switch links to the three views", async () => {
    mock(ok());
    const html = await render();
    expect(html).toContain("view=meeting");
    expect(html).toContain("view=stage");
  });

  it("KPI tile is a dash and 'Couldn't load' when approvals failed, never 0", async () => {
    mock(ok({ failed: ["approvals"] }));
    const html = await render();
    expect(html).toMatch(/Waiting on approval<\/span><span[^>]*>—<\/span><span[^>]*>Couldn&#x27;t load/);
    expect(html).toContain("Some details couldn&#x27;t load (approvals)");
  });

  it("meeting mode shows one card, progress and server-rendered Prev/Next", async () => {
    mock(ok());
    const html = await render({ view: "meeting", i: "2" });
    expect(html).toContain("2 of 3");
    expect(html).toContain("Last contact");
    expect(html).toMatch(/href="\/dashboard\/review\/?\?view=meeting"[^>]*>Previous/);
    expect(html).toMatch(/href="\/dashboard\/review\/?\?view=meeting&amp;i=3"[^>]*>Keep and go to next/);
    expect(html).toContain("Log what happened");
  });

  it("meeting mode past the end clamps to the last card", async () => {
    mock(ok());
    expect(await render({ view: "meeting", i: "99" })).toContain("3 of 3");
  });

  it("stage view groups by stage with counts", async () => {
    mock(ok());
    const html = await render({ view: "stage" });
    expect(html).toContain("Application Filed");
    expect(html).toContain("Application Preparation");
    expect(html).toMatch(/\d matters? · \d need attention/);
  });

  it("a failed critical source is one alert and no sections", async () => {
    mock({ status: "unavailable", failed: ["tasks"] });
    const html = await render();
    expect(html).toContain("tasks couldn&#x27;t load");
    expect(html).not.toContain("rv-board");
    expect(html).not.toContain("Needs a next step");
  });

  it("a viewer sees no edit controls", async () => {
    mock(ok(), "viewer");
    const html = await render();
    expect(html).not.toContain("Set next step");
    expect(html).not.toContain("Log what happened");
    expect(html).toContain("Overdue Co");
  });

  it("an editor sees the actions", async () => {
    mock(ok());
    const html = await render();
    expect(html).toContain("Set next step");
    expect(html).toContain("Log what happened");
  });

  it("empty states are never a blank page", async () => {
    mock(ok({ rows: [] }));
    expect(await render()).toContain("Nothing to review");
  });
});
