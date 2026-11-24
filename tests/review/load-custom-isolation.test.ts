import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, matter, mockReviewSources, NOW, state } from "./custom-load-harness";

mockReviewSources();

/**
 * B6: the custom read joins the same parallel batch as the tasks and the fees. It is held open while the test looks at what was already
 * called, then REJECTED: everything else on the row must still be there, and only "custom columns" is named.
 */
describe("a held, then rejected, custom read changes nothing else", () => {
  beforeEach(() => {
    state.matters = [matter("m1", { lead_id: "l1" })];
    state.events = [];
  });

  it("fees and tasks are called before it settles; after it rejects, tasks, fees and every Sprint 1 field are present", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "crm_task") return { data: [{ id: "t1", title: "Call back", due_at: "2026-11-20T12:00:00Z", assignee_id: null, matter_id: "m1", lead_id: null, created_at: "2026-10-01T00:00:00Z" }] };
      if (c.table === "crm_matter_deadline") return { data: [{ id: "d1", matter_id: "m1", kind: "office_action_response", due_date: "2026-12-01", title: "Response", attorney_confirmed: true }] };
      return { data: [] };
    });
    state.db = db;
    let reject!: (e: unknown) => void;
    const held = new Promise<never>((_, r) => (reject = r));
    const reads = {
      acceptedProposalFees: async () => (state.events.push("fees:proposal"), []),
      trackerFees: async () => (state.events.push("fees:tracker"), []),
      customColumns: () => (state.events.push("custom"), held),
    };
    const { loadReview } = await import("@/lib/review/load");
    const pending = loadReview(NOW, { withFees: true, withCustom: true, reads });
    // Let the batch start: the custom read is still held.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(state.events).toEqual(expect.arrayContaining(["fees:proposal", "fees:tracker", "custom"]));
    expect(calls.some((c) => c.table === "crm_task")).toBe(true);
    reject(new Error("custom read failed"));
    const r = await pending;
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.failed).toEqual(["custom columns"]);
    expect(r.custom).toEqual({ status: "unavailable" });
    const row = r.rows.find((x) => x.id === "m1")!;
    expect(row.nextStep?.title).toBe("Call back");
    expect(row.fees).toEqual({ legal: null, legalDue: null, gov: null, govDue: null });
    expect(row.serialNumber === undefined || row.serialNumber === null).toBe(true);
    expect(row.startDate).toBeTruthy();
    expect(row.practiceArea).toBeTruthy();
    expect(row.officeActionDue).toEqual({ dueDate: "2026-12-01", confirmed: true });
  });
});
