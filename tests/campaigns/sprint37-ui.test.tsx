import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { walk, ROOT } from "../ui/_scan";

const SEQ = "3f9a1c00-0000-4000-8000-000000000001";
const h = vi.hoisted(() => ({
  role: "admin" as string | null,
  steps: [] as Record<string, unknown>[],
  stepsFail: false,
  queue: { status: "ok", items: [{ agent: "campaign" }, { agent: "other" }] } as unknown,
  listFails: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/current-role", () => ({ currentRole: async () => h.role }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: async () => h.queue }));
vi.mock("@/lib/pipeline", () => ({ listLeads: async () => [] }));
vi.mock("@/lib/automation", () => ({
  AUTOMATION_ADMIN_ROLES: ["owner", "admin", "senior_admin"],
  AUTOMATION_STAFF_ROLES: ["owner", "admin", "senior_admin", "attorney", "paralegal"],
  getSequence: async () => ({ id: SEQ, name: "Nurture", description: "", active: false }),
  listSequences: async () => {
    if (h.listFails) throw new Error("down");
    return [{ id: SEQ, name: "Nurture", description: "", active: true, updated_at: new Date().toISOString() }];
  },
  listSteps: async () => {
    if (h.stepsFail) throw new Error("down");
    return h.steps;
  },
  listTemplates: async () => [{ id: "t1", name: "Thanks", subject: "Thank you" }],
  listEnrollments: async () => [],
  findClientLeads: async () => ({ status: "ok", clients: new Map() }),
}));
vi.mock("@/app/dashboard/campaigns/[id]/actions", () => {
  const action = async () => ({});
  return {
    addStarterStepsAction: action,
    addStepAction: action,
    advanceEnrollmentAction: action,
    deleteStepAction: action,
    enrollLeadAction: action,
    pauseEnrollmentAction: action,
    resumeEnrollmentAction: action,
    stopEnrollmentAction: action,
    toggleSequenceAction: action,
    updateSequenceDetailsAction: action,
  };
});
vi.mock("@/app/dashboard/campaigns/actions", () => ({ createSequenceAction: async () => ({}) }));

const { default: ListPage } = await import("@/app/dashboard/campaigns/page");
const { default: DetailPage } = await import("@/app/dashboard/campaigns/[id]/page");
const { AddStepForm, ToggleSequenceButton, StarterSteps } = await import("@/app/dashboard/campaigns/[id]/_components/CampaignBuilderForms");

const detail = async () => renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: SEQ }) }));
const list = async () => renderToStaticMarkup(await ListPage());

beforeEach(() => {
  h.role = "admin";
  h.steps = [];
  h.stepsFail = false;
  h.queue = { status: "ok", items: [{ agent: "campaign" }, { agent: "other" }] };
  h.listFails = false;
});

describe("AddStepForm", () => {
  it("offers Email, Internal task and Wait, and no Condition", () => {
    const html = renderToStaticMarkup(<AddStepForm sequenceId={SEQ} templates={[]} />);
    expect(html).toContain(">Email<");
    expect(html).toContain(">Internal task<");
    expect(html).toContain(">Wait<");
    expect(html).not.toMatch(/Condition|value="condition"|doesn&#x27;t change timing/);
  });
});

describe("ToggleSequenceButton", () => {
  it("disables Start with the reason when there are no steps, or the read failed", () => {
    const none = renderToStaticMarkup(<ToggleSequenceButton sequenceId={SEQ} active={false} stepCount={0} />);
    expect(none).toMatch(/<button[^>]*disabled/);
    expect(none).toContain("Add a step before you start this campaign.");
    const failed = renderToStaticMarkup(<ToggleSequenceButton sequenceId={SEQ} active={false} stepCount={null} />);
    expect(failed).toContain("Steps couldn&#x27;t be loaded, so this can&#x27;t be started right now.");
  });
  it("enables Start with steps, and Pause on an active campaign", () => {
    const start = renderToStaticMarkup(<ToggleSequenceButton sequenceId={SEQ} active={false} stepCount={2} />);
    expect(start).not.toMatch(/<button[^>]*disabled/);
    const pause = renderToStaticMarkup(<ToggleSequenceButton sequenceId={SEQ} active stepCount={0} />);
    expect(pause).toContain("Pause campaign");
    expect(pause).not.toMatch(/<button[^>]*disabled/);
  });
});

describe("StarterSteps", () => {
  it("shows the three suggested steps with a disabled button and the reason until templates are chosen", () => {
    const html = renderToStaticMarkup(<StarterSteps sequenceId={SEQ} templates={[{ id: "t1", name: "Thanks", subject: "Hi" }]} />);
    expect(html).toContain("Day 0");
    expect(html).toContain("Day 3");
    expect(html).toContain("Day 10");
    expect(html).toContain("Add these steps");
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("Choose a template for each email step.");
  });
  it("is disabled with a reason when there are no templates", () => {
    const html = renderToStaticMarkup(<StarterSteps sequenceId={SEQ} templates={[]} />);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("Add an email template first");
  });
});

describe("campaign page", () => {
  it("shows the starter panel and a disabled Start for a manager on an empty campaign", async () => {
    const html = await detail();
    expect(html).toContain("Add these steps");
    expect(html).toContain("Add a step before you start this campaign.");
    expect(html).toContain("lx-upl");
  });
  it("shows no starter for a non-manager, when steps exist, or when the steps read failed", async () => {
    h.role = "paralegal";
    expect(await detail()).not.toContain("Add these steps");
    h.role = "admin";
    h.steps = [{ id: "s1", order_index: 0, type: "wait", delay_hours: 1, template_id: null, config: {} }];
    expect(await detail()).not.toContain("Add these steps");
    h.steps = [];
    h.stepsFail = true;
    const failed = await detail();
    expect(failed).not.toContain("Add these steps");
    expect(failed).toContain("Steps couldn&#x27;t be loaded, so this can&#x27;t be started right now.");
  });
  it("labels an existing condition step as a note and writes nothing", async () => {
    h.steps = [{ id: "s1", order_index: 0, type: "condition", delay_hours: 0, template_id: null, config: {} }];
    const html = await detail();
    expect(html).toContain("Note (doesn&#x27;t change timing)");
    expect(html).toContain("This step is a note only.");
  });
  it("uses Steps, not Sequence, and one disclosure style", async () => {
    const html = await detail();
    expect(html).toContain(">Steps<");
    expect(html).not.toMatch(/Sequence/);
    expect(html).not.toContain("lx-disclosure-inline");
  });
});

describe("campaigns list", () => {
  it("has exactly two KPI tiles and Held for approval links to Approvals", async () => {
    const html = await list();
    expect((html.match(/lx-card lx-kpi"/g) ?? []).length).toBe(2);
    // Link drops the trailing slash when rendered outside the app; the source names it with one.
    expect(html).toMatch(/<a class="lx-card lx-kpi" href="\/dashboard\/queue\/?">/);
    expect(fs.readFileSync(path.join(ROOT, "src/app/dashboard/campaigns/page.tsx"), "utf8")).toContain('href="/dashboard/queue/"');
    expect(html).toContain("lx-kpis-compact");
    expect(html).toContain("lx-upl");
    expect(html).toContain("Campaigns for leads");
  });
  it("shows a dash and the unreachable note, never 0, when the queue is down", async () => {
    h.queue = { status: "unavailable" };
    const html = await list();
    expect(html).toContain("couldn&#x27;t reach the approval queue");
    expect(html).toMatch(/Held for approval<\/span><span class="lx-kpi-value">—/);
  });
  it("shows a dash and Couldn't load when the campaigns read failed", async () => {
    h.listFails = true;
    const html = await list();
    expect(html).toMatch(/Enrolled<\/span><span class="lx-kpi-value">—/);
    expect(html).toContain("Couldn&#x27;t load");
  });
});

describe("campaigns styling", () => {
  it("has no lx-disclosure-inline or firmnote under campaigns, and a compact KPI class", () => {
    for (const f of walk("src/app/dashboard/campaigns")) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).not.toContain("lx-disclosure-inline");
      expect(src, f).not.toContain("lx-campaigns-firmnote");
    }
    const css = fs.readFileSync(path.join(ROOT, "src/app/dashboard/campaigns/campaigns.css"), "utf8");
    expect(css).toContain(".lx-kpis-compact");
  });
});
