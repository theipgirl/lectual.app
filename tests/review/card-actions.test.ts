import { beforeEach, describe, expect, it, vi } from "vitest";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const PERSON = "00000000-0000-4000-8000-0000000000b1";

class Redirected extends Error { constructor(public to: string) { super(to); } }
const redirect = vi.fn((to: string) => { throw new Redirected(to); });
const complete = vi.fn(async () => ({ saved: true }) as { saved?: boolean; error?: string });
const update = vi.fn(async () => ({ saved: true }) as { saved?: boolean; error?: string });
const assign = vi.fn(async () => ({ saved: true }) as { saved?: boolean; error?: string });

async function run(fn: () => Promise<void>): Promise<string> {
  try { await fn(); } catch (e) { if (e instanceof Redirected) return e.to; throw e; }
  throw new Error("no redirect");
}

describe("cards actions", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    vi.doMock("next/navigation", () => ({ redirect }));
    vi.doMock("@/app/dashboard/review/actions", () => ({
      completeNextStepAction: complete, snoozeNextStepAction: vi.fn(async () => ({ saved: true })), updateNextStepAction: update,
      assignRecordAction: assign, logWhatHappenedAction: vi.fn(async () => ({ saved: true })),
    }));
  });

  it("redirects back to the same card, rebuilt from the posted view fields", async () => {
    const { deckDoneAction } = await import("../../src/app/dashboard/review/card-actions");
    const to = await run(() => deckDoneAction(fd({ taskId: "t", vwho: "mine", vkind: "leads", vq: "acme", vperson: PERSON, vi: "4" })));
    expect(to).toBe(`/dashboard/review/?who=mine&kind=leads&q=acme&view=cards&person=${PERSON}&i=4`);
    expect(complete).toHaveBeenCalled();
  });
  it("never trusts a posted address: garbage view fields fall back to defaults", async () => {
    const { deckDoneAction } = await import("../../src/app/dashboard/review/card-actions");
    const to = await run(() => deckDoneAction(fd({ taskId: "t", vperson: "https://evil.example", vi: "-5", vkind: "x", return: "https://evil.example" })));
    expect(to).toBe("/dashboard/review/?view=cards");
  });
  it("adds a fixed notice code after a refusal", async () => {
    complete.mockResolvedValueOnce({ error: "You don't have permission to change this. Ask an attorney or an admin." });
    const { deckDoneAction } = await import("../../src/app/dashboard/review/card-actions");
    expect(await run(() => deckDoneAction(fd({ taskId: "t" })))).toBe("/dashboard/review/?view=cards&notice=denied");
  });
  it("Hand to hands over the step when there is one, else the record", async () => {
    const { deckHandToAction } = await import("../../src/app/dashboard/review/card-actions");
    await run(() => deckHandToAction(fd({ taskId: "tt", assigneeId: PERSON, kind: "lead", id: "i" })));
    const stepForm = update.mock.calls[0][1] as FormData;
    expect(stepForm.get("taskId")).toBe("tt");
    expect(stepForm.get("assigneeId")).toBe(PERSON);
    expect(stepForm.has("title")).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    await run(() => deckHandToAction(fd({ assigneeId: PERSON, kind: "lead", id: "i" })));
    const recForm = assign.mock.calls[0][1] as FormData;
    expect(recForm.get("userId")).toBe(PERSON);
    expect(recForm.get("kind")).toBe("lead");
  });
});
