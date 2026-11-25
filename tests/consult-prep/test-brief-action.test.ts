// S2c: "Send a test brief" (the action): the firm's real owner only, the lead in the session's firm, a small per-owner limit, and only
// the engine's fixed sentences back.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSULT_PREP_TEST_EMAIL_OFF, CONSULT_PREP_TEST_FAILED, CONSULT_PREP_TEST_LIMIT, CONSULT_PREP_TEST_NOT_BUILT, CONSULT_PREP_TEST_OFF, CONSULT_PREP_TEST_OWNER_ONLY, CONSULT_PREP_TEST_SENT } from "@/lib/ui/words";

const LEAD = "8f1c2a3b-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({
  session: null as unknown,
  lead: null as null | { id: string; org_id: string; merged_into_id: string | null },
  outcome: null as unknown,
  scoped: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/current-role", () => ({ currentRole: async () => "owner" }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => state.session }));
vi.mock("@/lib/pipeline", () => ({ getLead: async () => state.lead }));
vi.mock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({ marker: "deps" }) }));
vi.mock("@/lib/consult-prep/trigger", () => ({
  runConsultPrepScoped: async (...args: unknown[]) => {
    state.scoped.push(args);
    return state.outcome;
  },
}));

const { sendTestBriefAction } = await import("@/app/dashboard/leads/[id]/consult-prep-actions");
const { canSendTestBrief } = await import("@/lib/consult-prep/roles");

let user = 0;
const session = (role: string, actingAsStaff: boolean) => ({ kind: "ok", role, actingAsStaff, user: { id: `user-${user}` }, org: { id: "org-1" } });

beforeEach(() => {
  user += 1; // a fresh owner per test, so the in-memory limit never carries over
  state.session = session("owner", false);
  state.lead = { id: LEAD, org_id: "org-1", merged_into_id: null };
  state.outcome = { status: "ok", result: { itemsIn: 0, draftsOut: 0, summary: CONSULT_PREP_TEST_SENT } };
  state.scoped = [];
});

describe("who may send a test brief", () => {
  it("the rule: a real owner only", () => {
    expect(canSendTestBrief("owner", false)).toBe(true);
    for (const role of ["admin", "senior_admin", "attorney", "paralegal", "viewer", null, undefined]) expect(canSendTestBrief(role, false)).toBe(false);
    expect(canSendTestBrief("owner", true)).toBe(false);
    expect(canSendTestBrief("owner", undefined)).toBe(false);
  });
  it("an owner: one test run for THIS lead in the session's firm, and the engine's sentence back", async () => {
    expect(await sendTestBriefAction(LEAD)).toEqual({ ok: true, message: CONSULT_PREP_TEST_SENT });
    expect(state.scoped).toHaveLength(1);
    expect((state.scoped[0] as unknown[])[1]).toEqual({ orgId: "org-1", scope: { leadIds: [LEAD], reason: "test" }, trigger: "manual" });
  });
  it("any other role, Lectual staff acting as the owner, or no session: refused before anything is read or run", async () => {
    for (const s of [session("admin", false), session("attorney", false), session("owner", true), { kind: "signed-out", redirectTo: "/" }]) {
      state.session = s;
      expect(await sendTestBriefAction(LEAD)).toEqual({ message: CONSULT_PREP_TEST_OWNER_ONLY });
    }
    expect(state.scoped).toHaveLength(0);
  });
  it("a lead in another firm, a merged lead, a missing lead or a bad id: nothing runs", async () => {
    for (const lead of [{ id: LEAD, org_id: "org-2", merged_into_id: null }, { id: LEAD, org_id: "org-1", merged_into_id: "x" }, null]) {
      state.lead = lead;
      expect(await sendTestBriefAction(LEAD)).toEqual({ message: CONSULT_PREP_TEST_FAILED });
    }
    expect(await sendTestBriefAction("not-a-uuid")).toEqual({ message: CONSULT_PREP_TEST_FAILED });
    expect(state.scoped).toHaveLength(0);
  });
  it("assistant off: says so; a run that errors or answers anything but a known sentence: the fixed failure", async () => {
    state.outcome = null;
    expect(await sendTestBriefAction(LEAD)).toEqual({ message: CONSULT_PREP_TEST_OFF });
    state.outcome = { status: "error", error: "planted raw text" };
    expect(await sendTestBriefAction(LEAD)).toEqual({ message: CONSULT_PREP_TEST_FAILED });
    state.outcome = { status: "ok", result: { summary: "something else, with raw text" } };
    expect(await sendTestBriefAction(LEAD)).toEqual({ message: CONSULT_PREP_TEST_FAILED });
  });
  it("at most 5 an hour per owner", async () => {
    for (let i = 0; i < 5; i += 1) expect((await sendTestBriefAction(LEAD)).ok).toBe(true);
    expect(await sendTestBriefAction(LEAD)).toEqual({ message: CONSULT_PREP_TEST_LIMIT });
    expect(state.scoped).toHaveLength(5);
  });

  it("the slot is taken before anything is awaited: six presses at once run five", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => sendTestBriefAction(LEAD)));
    expect(results.filter((r) => r.message === CONSULT_PREP_TEST_LIMIT)).toHaveLength(1);
    expect(state.scoped).toHaveLength(5);
  });

  it("a press refused before anything was built gives its slot back; one that built (or tried to) keeps it", async () => {
    state.outcome = { status: "ok", result: { summary: CONSULT_PREP_TEST_EMAIL_OFF } };
    for (let i = 0; i < 7; i += 1) expect(await sendTestBriefAction(LEAD)).toEqual({ ok: false, message: CONSULT_PREP_TEST_EMAIL_OFF });
    state.lead = null;
    for (let i = 0; i < 3; i += 1) expect(await sendTestBriefAction(LEAD)).toEqual({ message: CONSULT_PREP_TEST_FAILED });
    state.lead = { id: LEAD, org_id: "org-1", merged_into_id: null };
    state.outcome = { status: "ok", result: { summary: CONSULT_PREP_TEST_NOT_BUILT } };
    for (let i = 0; i < 5; i += 1) expect((await sendTestBriefAction(LEAD)).message).toBe(CONSULT_PREP_TEST_NOT_BUILT);
    expect(await sendTestBriefAction(LEAD)).toEqual({ message: CONSULT_PREP_TEST_LIMIT });
  });
});
