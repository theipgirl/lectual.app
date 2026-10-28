import { beforeEach, describe, expect, it, vi } from "vitest";

type Step = { id: string; order_index: number };
const h = vi.hoisted(() => ({
  steps: [] as { id: string; order_index: number }[],
  stepsFail: false,
  templates: [{ id: "t1" }, { id: "t2" }] as { id: string }[],
  added: [] as Record<string, unknown>[],
  failOnAdd: null as number | null,
  toggled: [] as [string, boolean][],
  enrolled: 0,
  created: [] as Record<string, unknown>[],
  admin: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/campaigns/advance", () => ({ advanceEnrollment: vi.fn() }));
vi.mock("@/lib/automation/drips", () => ({
  addStep: vi.fn(async (_seq: string, input: Record<string, unknown>) => {
    if (!h.admin) throw new Error("You don't have permission to change campaigns.");
    if (h.failOnAdd !== null && h.added.length === h.failOnAdd) throw new Error("boom");
    h.added.push(input);
    h.steps.push({ id: `s${h.steps.length}`, order_index: input.orderIndex as number });
  }),
  deleteStep: vi.fn(),
  enrollLead: vi.fn(async () => {
    h.enrolled += 1;
  }),
  getSequence: async () => ({ id: "seq" }),
  listEnrollments: async () => [],
  listSteps: async () => {
    if (h.stepsFail) throw new Error("down");
    return h.steps as Step[];
  },
  listTemplates: async () => h.templates,
  setEnrollmentStatus: vi.fn(),
  stopEnrollment: vi.fn(),
  toggleSequenceActive: vi.fn(async (id: string, active: boolean) => {
    h.toggled.push([id, active]);
  }),
  updateSequenceDetails: vi.fn(),
  createSequence: vi.fn(async (input: Record<string, unknown>) => {
    h.created.push(input);
    return { id: "new-seq" };
  }),
}));

const actions = await import("@/app/dashboard/campaigns/[id]/actions");
const { createSequenceAction } = await import("@/app/dashboard/campaigns/actions");
const { ADDABLE_STEP_TYPES, stepTypeLabel, START_NEEDS_STEP, START_UNREADABLE } = await import("@/lib/campaigns/steps");

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};

beforeEach(() => {
  h.steps = [];
  h.stepsFail = false;
  h.added = [];
  h.failOnAdd = null;
  h.toggled = [];
  h.enrolled = 0;
  h.created = [];
  h.admin = true;
});

describe("step types", () => {
  it("the picker offers email, task and wait, never a condition; stored conditions keep a label", () => {
    expect([...ADDABLE_STEP_TYPES]).toEqual(["email", "task", "wait"]);
    expect(stepTypeLabel("condition")).toBe("Note (doesn't change timing)");
  });
  it("addStepAction refuses a forged condition step and writes nothing", async () => {
    const res = await actions.addStepAction({}, form({ sequenceId: "seq", type: "condition", delayHours: "0" }));
    expect(res.error).toBeTruthy();
    expect(h.added).toHaveLength(0);
  });
  it("addStepAction still adds an email step at the next index", async () => {
    h.steps = [{ id: "a", order_index: 4 }];
    const res = await actions.addStepAction({}, form({ sequenceId: "seq", type: "email", delayHours: "24", templateId: "t1" }));
    expect(res.error).toBeUndefined();
    expect(h.added[0]).toMatchObject({ orderIndex: 5, type: "email", delayHours: 24, templateId: "t1" });
  });
});

describe("addStarterStepsAction", () => {
  const ok = { sequenceId: "seq", templateThankYou: "t1", templateFollowUp: "t2" };
  it("adds three draft steps in order: delays 0, 72, 168 h; email, email, task 'Move to nurture'", async () => {
    const res = await actions.addStarterStepsAction({}, form(ok));
    expect(res.saved).toBe(true);
    expect(h.added.map((a) => [a.orderIndex, a.type, a.delayHours, a.templateId])).toEqual([
      [0, "email", 0, "t1"],
      [1, "email", 72, "t2"],
      [2, "task", 168, null],
    ]);
    expect(h.added[2].config).toEqual({ title: "Move to nurture" });
    expect(h.toggled).toEqual([]);
    expect(h.enrolled).toBe(0);
  });
  it("inserts nothing for an unknown template, a missing template, or a campaign that already has steps", async () => {
    expect((await actions.addStarterStepsAction({}, form({ ...ok, templateFollowUp: "ghost" }))).error).toBeTruthy();
    expect((await actions.addStarterStepsAction({}, form({ sequenceId: "seq", templateThankYou: "t1" }))).error).toBeTruthy();
    h.steps = [{ id: "x", order_index: 0 }];
    expect((await actions.addStarterStepsAction({}, form(ok))).error).toMatch(/already has steps/);
    expect(h.added).toHaveLength(0);
  });
  it("reports how many were added when the second step fails", async () => {
    h.failOnAdd = 1;
    const res = await actions.addStarterStepsAction({}, form(ok));
    expect(res.error).toBe("Only 1 of 3 steps were added. Add the rest by hand.");
    expect(h.added).toHaveLength(1);
  });
  it("refuses a non-admin", async () => {
    h.admin = false;
    const res = await actions.addStarterStepsAction({}, form(ok));
    expect(res.error).toBeTruthy();
    expect(h.added).toHaveLength(0);
  });
});

describe("toggleSequenceAction", () => {
  it("refuses to start with zero steps or an unreadable steps read, and never writes", async () => {
    expect((await actions.toggleSequenceAction({}, form({ sequenceId: "seq", nextActive: "true" }))).error).toBe(START_NEEDS_STEP);
    h.stepsFail = true;
    expect((await actions.toggleSequenceAction({}, form({ sequenceId: "seq", nextActive: "true" }))).error).toBe(START_UNREADABLE);
    expect(h.toggled).toEqual([]);
  });
  it("starts a campaign that has steps, and always allows pausing", async () => {
    h.steps = [{ id: "a", order_index: 0 }];
    await actions.toggleSequenceAction({}, form({ sequenceId: "seq", nextActive: "true" }));
    h.steps = [];
    await actions.toggleSequenceAction({}, form({ sequenceId: "seq", nextActive: "false" }));
    expect(h.toggled).toEqual([["seq", true], ["seq", false]]);
  });
});

describe("end to end: an empty campaign", () => {
  it("create (paused) -> starter steps -> Start is accepted; nothing enrolled", async () => {
    await expect(createSequenceAction({}, form({ name: "Nurture" }))).rejects.toThrow("REDIRECT:/dashboard/campaigns/new-seq/");
    expect(h.created[0]).toMatchObject({ name: "Nurture", active: false });
    expect((await actions.toggleSequenceAction({}, form({ sequenceId: "seq", nextActive: "true" }))).error).toBe(START_NEEDS_STEP);
    await actions.addStarterStepsAction({}, form({ sequenceId: "seq", templateThankYou: "t1", templateFollowUp: "t2" }));
    expect((await actions.toggleSequenceAction({}, form({ sequenceId: "seq", nextActive: "true" }))).error).toBeUndefined();
    expect(h.toggled).toEqual([["seq", true]]);
    expect(h.enrolled).toBe(0);
  });
});
