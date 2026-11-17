import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The card's writes. `cardTagAction` (new) answers { saved: true }; the existing review actions the card calls refuse a
 * role that has no control (server re-check), refuse a won stage for a lead, and snooze a LEAD's task too.
 */
const LEAD = "11111111-1111-4111-8111-111111111111";
const KEEPER = "22222222-2222-4222-8222-222222222222";
const TAG = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";
const STAGE = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

const WRITE = ["owner", "admin", "senior_admin", "intake", "paralegal", "law_clerk", "attorney", "clerk"];
const MOVE = ["owner", "admin", "senior_admin", "intake", "law_clerk", "attorney", "clerk"];

let role = "owner";
/** What the scoped client answers per table: a row, null (not visible) or an error. */
let rows: Record<string, { data: unknown; error: unknown }> = {};
const applyTag = vi.fn(async () => {});
const removeTag = vi.fn(async () => {});
const keeperForWrite = vi.fn(async (_db: unknown, id: string) => id);
const moveLeadStage = vi.fn(async () => ({}));
const updateTask = vi.fn(async () => ({}));
const completeTask = vi.fn(async () => ({}));
const createTask = vi.fn(async () => ({}));
const setReferralSource = vi.fn(async () => ({}));
const assignLead = vi.fn(async () => ({}));
const updateMatterStage = vi.fn(async () => {});
const updateMatterHeader = vi.fn(async () => {});

function client() {
  return {
    rpc: async () => ({ data: role, error: null }),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "limit", "order"]) q[k] = () => q;
      const answer = async () => rows[table] ?? { data: null, error: null };
      q.maybeSingle = answer;
      q.single = answer;
      return q;
    },
  };
}

function setup() {
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => client() }));
  vi.doMock("@/lib/pipeline/leads", () => ({ CAN_WRITE_LEAD: WRITE, resolveCurrentRole: async () => role, updateLead: vi.fn() }));
  vi.doMock("@/lib/pipeline/tags", () => ({ applyTag, removeTag }));
  vi.doMock("@/lib/leads/live", () => ({ keeperForWrite }));
  // The review actions' own imports.
  vi.doMock("@/lib/pipeline", () => ({ CAN_WRITE_LEAD: WRITE, CAN_MOVE_STAGE: MOVE, resolveCurrentRole: async () => role, moveLeadStage, assignLead, addLeadNote: vi.fn() }));
  vi.doMock("@/lib/matters/matters", () => ({ MATTER_WRITE_ROLES: WRITE, assignMatterOwner: vi.fn(), updateMatterHeader }));
  vi.doMock("@/lib/matters/tasks", () => ({ createTask, completeTask, updateTask }));
  vi.doMock("@/lib/matters/stages", () => ({ updateMatterStage }));
  vi.doMock("@/lib/intake/leads", () => ({ setReferralSource }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [{ userId: USER }] }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  role = "owner";
  rows = { crm_tag: { data: { id: TAG }, error: null }, crm_lead: { data: { id: LEAD }, error: null }, crm_lead_tag: { data: { tag_id: TAG }, error: null } };
  keeperForWrite.mockImplementation(async (_db: unknown, id: string) => id);
  setup();
});

const tagAction = async () => (await import("@/lib/record-card/actions")).cardTagAction;

describe("cardTagAction", () => {
  it("adds a firm tag through applyTag and answers Saved", async () => {
    const act = await tagAction();
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "add" }))).toEqual({ saved: true });
    expect(applyTag).toHaveBeenCalledWith(LEAD, TAG, { source: "human" });
  });

  it("removes through removeTag and answers Saved", async () => {
    const act = await tagAction();
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "remove" }))).toEqual({ saved: true });
    expect(removeTag).toHaveBeenCalledWith(LEAD, TAG);
  });

  it("a merged lead's tag goes on the keeper; an unreadable pointer writes nothing", async () => {
    keeperForWrite.mockResolvedValueOnce(KEEPER);
    const act = await tagAction();
    await act({}, fd({ leadId: LEAD, tagId: TAG, op: "remove" }));
    expect(removeTag).toHaveBeenCalledWith(KEEPER, TAG);
    keeperForWrite.mockRejectedValueOnce(new Error("pointer"));
    const res = await act({}, fd({ leadId: LEAD, tagId: TAG, op: "add" }));
    expect(res.error).toBe("This lead couldn't be checked just now, so nothing was saved. Refresh and try again.");
    expect(applyTag).not.toHaveBeenCalled();
  });

  it("refuses viewer and social media before any read, and writes nothing", async () => {
    const act = await tagAction();
    for (const r of ["viewer", "social_media", "unknown"]) {
      role = r;
      // The role is checked FIRST: even a malformed post gets the permission sentence.
      expect(await act({}, fd({ leadId: "x", tagId: "y", op: "zap" }))).toEqual({ error: "You don't have permission to change this. Ask an attorney or an admin." });
      expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "add" }))).toEqual({ error: "You don't have permission to change this. Ask an attorney or an admin." });
    }
    expect(applyTag).not.toHaveBeenCalled();
    expect(removeTag).not.toHaveBeenCalled();
  });

  it("a tag that isn't the firm's reads as missing and nothing is written", async () => {
    rows.crm_tag = { data: null, error: null };
    const act = await tagAction();
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "add" }))).toEqual({ error: "That tag isn't one of your firm's tags." });
    expect(applyTag).not.toHaveBeenCalled();
  });

  it("failures are fixed sentences, never the raw error", async () => {
    const act = await tagAction();
    rows.crm_tag = { data: null, error: { message: "relation crm_tag secret detail" } };
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "add" }))).toEqual({ error: "Couldn't add this tag." });
    rows.crm_tag = { data: { id: TAG }, error: null };
    applyTag.mockRejectedValueOnce({ code: "23505", message: "duplicate key value violates unique constraint" });
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "add" }))).toEqual({ error: "This tag is already on the lead." });
    removeTag.mockRejectedValueOnce(new Error("socket hang up at 10.0.0.1"));
    const res = await act({}, fd({ leadId: LEAD, tagId: TAG, op: "remove" }));
    expect(res).toEqual({ error: "Couldn't remove this tag." });
  });

  it("another firm's (or a missing) lead: add and remove both read as gone, and nothing is written", async () => {
    rows.crm_lead = { data: null, error: null };
    const act = await tagAction();
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "add" }))).toEqual({ error: "That record couldn't be found. It may have been removed." });
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "remove" }))).toEqual({ error: "That record couldn't be found. It may have been removed." });
    rows.crm_lead = { data: null, error: { message: "boom" } };
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "remove" }))).toEqual({ error: "Couldn't remove this tag." });
    expect(applyTag).not.toHaveBeenCalled();
    expect(removeTag).not.toHaveBeenCalled();
  });

  it("removing a tag that isn't on the lead is not Saved and logs nothing", async () => {
    rows.crm_lead_tag = { data: null, error: null };
    const act = await tagAction();
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "remove" }))).toEqual({ error: "This tag isn't on the lead." });
    rows.crm_lead_tag = { data: null, error: { message: "boom" } };
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "remove" }))).toEqual({ error: "Couldn't remove this tag." });
    expect(removeTag).not.toHaveBeenCalled();
  });

  it("bad input is refused with a sentence", async () => {
    const act = await tagAction();
    expect(await act({}, fd({ leadId: "nope", tagId: TAG, op: "add" }))).toEqual({ error: "That record couldn't be found. It may have been removed." });
    expect(await act({}, fd({ leadId: LEAD, tagId: TAG, op: "zap" }))).toEqual({ error: "Choose a tag." });
    expect(applyTag).not.toHaveBeenCalled();
  });
});

const review = async () => await import("@/app/dashboard/review/actions");

describe("the existing actions the card calls re-check on the server", () => {
  it("a lead is never moved to a won stage, whoever posts it", async () => {
    rows.crm_lead = { data: { id: LEAD, current_stage_id: "s-new" }, error: null };
    rows.crm_stage = { data: { id: STAGE, category: "won" }, error: null };
    const { moveStageAction } = await review();
    for (const r of MOVE) {
      role = r;
      expect(await moveStageAction({}, fd({ kind: "lead", id: LEAD, stageId: STAGE }))).toEqual({ error: "Open the lead to move it to a won stage." });
    }
    expect(moveLeadStage).not.toHaveBeenCalled();
  });

  it("an open stage moves; a paralegal, viewer or social media is refused and nothing moves", async () => {
    rows.crm_lead = { data: { id: LEAD, current_stage_id: "s-new" }, error: null };
    rows.crm_stage = { data: { id: STAGE, category: "open" }, error: null };
    const { moveStageAction } = await review();
    expect(await moveStageAction({}, fd({ kind: "lead", id: LEAD, stageId: STAGE }))).toEqual({ saved: true });
    expect(moveLeadStage).toHaveBeenCalledTimes(1);
    for (const r of ["paralegal", "viewer", "social_media"]) {
      role = r;
      expect((await moveStageAction({}, fd({ kind: "lead", id: LEAD, stageId: STAGE }))).error).toMatch(/permission/);
    }
    expect(moveLeadStage).toHaveBeenCalledTimes(1);
  });

  it("snooze works on a LEAD's task: only its due date moves", async () => {
    rows.crm_task = { data: { id: TASK, status: "open", lead_id: LEAD, matter_id: null }, error: null };
    const { snoozeNextStepAction } = await review();
    expect(await snoozeNextStepAction({}, fd({ taskId: TASK, when: "tomorrow" }))).toEqual({ saved: true });
    expect(updateTask).toHaveBeenCalledTimes(1);
    const [id, patch] = updateTask.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(id).toBe(TASK);
    expect(Object.keys(patch)).toEqual(["dueAt"]);
    expect(String(patch.dueAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a role with no control is refused by every edit action, and nothing is written", async () => {
    rows.crm_task = { data: { id: TASK, status: "open" }, error: null };
    rows.crm_lead = { data: { id: LEAD, current_stage_id: "s-new" }, error: null };
    rows.crm_matter = { data: { id: LEAD }, error: null };
    const a = await review();
    for (const r of ["viewer", "social_media"]) {
      role = r;
      const results = [
        await a.setSourceAction({}, fd({ kind: "lead", id: LEAD, source: "UGW" })),
        await a.assignRecordAction({}, fd({ kind: "lead", id: LEAD, userId: USER })),
        await a.setNextStepAction({}, fd({ kind: "lead", id: LEAD, title: "Call" })),
        await a.updateNextStepAction({}, fd({ taskId: TASK, title: "Call again" })),
        await a.completeNextStepAction({}, fd({ taskId: TASK })),
        await a.snoozeNextStepAction({}, fd({ taskId: TASK, when: "monday" })),
        await a.moveStageAction({}, fd({ kind: "matter", id: LEAD, stageId: STAGE })),
      ];
      for (const res of results) expect(res.error).toMatch(/permission/);
    }
    for (const fn of [setReferralSource, assignLead, createTask, updateTask, completeTask, moveLeadStage, updateMatterStage]) expect(fn).not.toHaveBeenCalled();
  });

  it("a matter's source (the card's Source on Matters) goes through setSourceAction: an unlisted source is refused and nothing is written", async () => {
    rows.crm_matter = { data: { id: LEAD }, error: null };
    const { setSourceAction } = await review();
    expect(await setSourceAction({}, fd({ kind: "matter", id: LEAD, source: "Made up" }))).toEqual({ error: "That isn't one of the sources." });
    expect(await setSourceAction({}, fd({ kind: "matter", id: LEAD, source: "<script>" }))).toEqual({ error: "That isn't one of the sources." });
    expect(updateMatterHeader).not.toHaveBeenCalled();
    expect(await setSourceAction({}, fd({ kind: "matter", id: LEAD, source: "Website" }))).toEqual({ saved: true });
    expect(updateMatterHeader).toHaveBeenCalledWith(LEAD, { referralSource: "Website" });
    role = "viewer";
    expect((await setSourceAction({}, fd({ kind: "matter", id: LEAD, source: "Website" }))).error).toMatch(/permission/);
    expect(updateMatterHeader).toHaveBeenCalledTimes(1);
  });
});
