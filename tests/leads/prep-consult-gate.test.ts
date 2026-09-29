import { describe, it, expect, vi } from "vitest";

/** prep-consult drafts client copy in one firm's voice: agent-toolkit only, checked in the action. */
const queued = vi.hoisted(() => ({ calls: 0, modules: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => queued.modules.includes(m) }));
vi.mock("@/lib/prep-consult/generate", () => ({
  queuePrepConsultDrafts: async () => {
    queued.calls += 1;
    return { headsUpQueueItemId: "h1", clientPrepQueueItemId: "c1" };
  },
}));

const { prepConsultAction } = await import("@/app/dashboard/leads/[id]/actions");

function form() {
  const fd = new FormData();
  fd.set("leadId", "lead-1");
  fd.set("practiceArea", "Trademark");
  fd.set("inquiryDescription", "Wants to register a mark");
  return fd;
}

describe("prepConsultAction", () => {
  it("refuses a firm without agent-toolkit and drafts nothing", async () => {
    queued.modules = [];
    expect((await prepConsultAction({}, form())).error).toMatch(/isn't available/);
    expect(queued.calls).toBe(0);
  });
  it("queues both drafts for a firm with it", async () => {
    queued.modules = ["agent-toolkit"];
    expect(await prepConsultAction({}, form())).toEqual({ headsUpQueueItemId: "h1", clientPrepQueueItemId: "c1" });
  });
});
