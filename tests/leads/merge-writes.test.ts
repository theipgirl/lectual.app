import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MERGE_POINTER_UNREADABLE } from "@/lib/ui/words";

/**
 * M5 (lectual 0107): writes from a page opened before a merge. The merge guard covers crm_lead only, so a child row
 * (task, time entry, tag, consult note, next step, enrollment) filed on the merged lead would vanish from every page.
 * Each write follows the merged lead to its keeper first; a pointer that can't be read refuses and writes nothing.
 */
const ORG = "org-1";
const K = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, inserts: [] as Array<{ table: string; rows: Row[] }>, failLeadRead: false }));

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let single = false;
  let insertRows: Row[] | null = null;
  let isUpdate = false;
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
    is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
    not: () => q,
    lt: () => q,
    gte: () => q,
    order: () => q,
    range: () => q,
    limit: () => q,
    update: () => ((isUpdate = true), q),
    insert: (rows: Row | Row[]) => ((insertRows = Array.isArray(rows) ? rows : [rows]), q),
    maybeSingle: () => ((single = true), q),
    single: () => ((single = true), q),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      if (insertRows) {
        state.inserts.push({ table, rows: insertRows });
        const row = { id: `${table}-new`, ...insertRows[0] };
        return Promise.resolve({ data: single ? row : [row], error: null }).then(ok, bad);
      }
      if (isUpdate) return Promise.resolve({ data: [], error: null }).then(ok, bad);
      if (table === "crm_lead" && state.failLeadRead) return Promise.resolve({ data: null, error: { code: "08006", message: "down" } }).then(ok, bad);
      const rows = (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null, count: rows.length }).then(ok, bad);
    },
  };
  return q;
}
const client = {
  from,
  rpc: async (name: string) => ({ data: name === "current_org_role" ? "owner" : name === "current_org_id" ? ORG : null, error: null }),
  auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "owner@x.example" } }, error: null }) },
};

vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/org/profile", async (orig) => ({ ...(await orig<typeof import("@/lib/org/profile")>()), getFirmTimeZone: async () => "UTC" }));

beforeEach(async () => {
  (await import("@/lib/leads/live")).resetLeadMergeSupport();
  state.inserts = [];
  state.failLeadRead = false;
  state.tables = {
    crm_lead: [
      { id: K, org_id: ORG, email: "k@x.example", first_name: "Ana", last_name: "Keep", business_name: null, current_stage_id: "s1", merged_into_id: null },
      { id: L, org_id: ORG, email: "l@x.example", first_name: "Ana", last_name: "Old", business_name: null, current_stage_id: "s1", merged_into_id: K },
    ],
    crm_stage: [{ id: "s1", org_id: ORG, category: "open" }],
    crm_org_member: [{ org_id: ORG, user_id: "u-1", role: "owner" }],
  };
});
afterEach(() => vi.clearAllMocks());

const insertedLead = (table: string) => state.inserts.find((i) => i.table === table)?.rows[0]?.lead_id;

describe("keeperForWrite", () => {
  it("follows a merged lead to its keeper and refuses an unreadable pointer", async () => {
    const { keeperForWrite } = await import("@/lib/leads/live");
    expect(await keeperForWrite(client, L)).toBe(K);
    expect(await keeperForWrite(client, K)).toBe(K);
    state.failLeadRead = true;
    await expect(keeperForWrite(client, L)).rejects.toThrow(MERGE_POINTER_UNREADABLE);
  });
});

describe("each write lands on the keeper, or writes nothing", () => {
  it("a new task", async () => {
    const { createTask } = await import("@/lib/matters/tasks");
    await createTask({ leadId: L, title: "Call back" });
    expect(insertedLead("crm_task")).toBe(K);
    state.inserts = [];
    state.failLeadRead = true;
    await expect(createTask({ leadId: L, title: "Call back" })).rejects.toThrow(MERGE_POINTER_UNREADABLE);
    expect(state.inserts).toEqual([]);
  });

  it("a time entry", async () => {
    const { addManualEntry } = await import("@/lib/time/entries");
    await addManualEntry({ leadId: L }, 600).catch(() => undefined);
    expect(insertedLead("crm_time_entry")).toBe(K);
    state.inserts = [];
    state.failLeadRead = true;
    await expect(addManualEntry({ leadId: L }, 600)).rejects.toThrow(MERGE_POINTER_UNREADABLE);
    expect(state.inserts).toEqual([]);
  });

  it("a tag", async () => {
    const { applyTag } = await import("@/lib/pipeline/tags");
    await applyTag(L, "t1");
    expect(insertedLead("crm_lead_tag")).toBe(K);
    state.inserts = [];
    state.failLeadRead = true;
    await expect(applyTag(L, "t1")).rejects.toThrow(MERGE_POINTER_UNREADABLE);
    expect(state.inserts).toEqual([]);
  });

  it("a campaign enrolment", async () => {
    const { enrollLead } = await import("@/lib/automation/drips");
    await enrollLead(L, "seq-1").catch(() => undefined);
    expect(insertedLead("crm_drip_enrollment")).toBe(K);
    state.inserts = [];
    state.failLeadRead = true;
    await expect(enrollLead(L, "seq-1")).rejects.toThrow(MERGE_POINTER_UNREADABLE);
    expect(state.inserts).toEqual([]);
  });

  it("Weekly review's Set next step", async () => {
    const { setNextStepAction } = await import("@/app/dashboard/review/actions");
    const form = new FormData();
    form.set("kind", "lead");
    form.set("id", L);
    form.set("title", "Send the proposal");
    expect(await setNextStepAction({}, form)).toEqual({ saved: true });
    expect(insertedLead("crm_task")).toBe(K);
    state.inserts = [];
    state.failLeadRead = true;
    expect(await setNextStepAction({}, form)).toEqual({ error: MERGE_POINTER_UNREADABLE });
    expect(state.inserts).toEqual([]);
  });

  it("consult details refuse an unreadable pointer and write nothing", async () => {
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "ok", role: "owner", org: { id: ORG }, user: { id: "u-1" }, displayName: "Owner" }) }));
    const { saveConsultDetailsAction } = await import("@/app/dashboard/leads/[id]/consult-details-actions");
    state.failLeadRead = true;
    const form = new FormData();
    form.set("leadId", L);
    const out = await saveConsultDetailsAction({} as never, form);
    // A form that doesn't parse is refused before the lead is read; a valid one meets the pointer refusal. Either way, nothing is written.
    expect(state.inserts).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/08006|down/);
    vi.doUnmock("@/lib/firm/session");
  });

  it("an automation rule whose lead read FAILS records its own sentence, not 'merged', and writes no tag", async () => {
    const { MERGE_RULE_LEAD_UNREADABLE, LEAD_MERGED_WRITE } = await import("@/lib/ui/words");
    state.tables.crm_automation_rule = [{ id: "r1", org_id: ORG, trigger_type: "stage_changed", active: true, dry_run: false, conditions: {}, actions: [{ type: "apply_tag", tagId: "t1" }] }];
    state.failLeadRead = true;
    const { runRules } = await import("@/lib/automation/engine");
    await runRules("stage_changed", { leadId: L, stageId: "s1" });
    const run = state.inserts.find((i) => i.table === "crm_automation_run")?.rows[0] as { actions_taken: Array<{ ok: boolean; error?: string }> };
    expect(run.actions_taken[0]).toMatchObject({ ok: false, error: MERGE_RULE_LEAD_UNREADABLE });
    expect(run.actions_taken[0].error).not.toBe(LEAD_MERGED_WRITE);
    expect(state.inserts.find((i) => i.table === "crm_lead_tag")).toBeUndefined();
  });

  it("campaign advance and consult details follow the pointer before reading the lead (source check)", () => {
    const root = path.resolve(__dirname, "../..");
    for (const file of ["src/lib/campaigns/advance.ts", "src/app/dashboard/leads/[id]/consult-details-actions.ts"]) {
      expect(fs.readFileSync(path.join(root, file), "utf8"), file).toMatch(/keeperForWrite\(/);
    }
  });
});
