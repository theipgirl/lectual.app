import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner" as string | null,
  members: [] as Array<{ userId: string; email: string | null; displayName: string | null; role: string; identified: boolean }>,
  membersThrow: false,
  saved: [] as unknown[],
  setting: { status: "ok", entryId: null as string | null, userIds: [] as string[], cc: [] as string[] } as { status: string; entryId?: string | null },
  saveThrows: false,
  lead: null as null | { id: string; org_id: string; merged_into_id: string | null },
  outcome: null as unknown,
  scoped: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/current-role", () => ({ currentRole: async () => state.role }));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: async () => {
    if (state.membersThrow) throw new Error("down");
    return state.members;
  },
}));
vi.mock("@/lib/consult-prep/recipients-store", () => ({
  loadConsultPrepSetting: async () => state.setting,
  saveConsultPrepSetting: async (...args: unknown[]) => {
    if (state.saveThrows) throw new Error("db down planted-secret");
    state.saved.push(args);
  },
}));
vi.mock("@/lib/pipeline", () => ({ getLead: async () => state.lead }));
vi.mock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({ marker: "deps" }) }));
vi.mock("@/lib/consult-prep/trigger", () => ({
  runConsultPrepScoped: async (...args: unknown[]) => {
    state.scoped.push(args);
    return state.outcome;
  },
}));

const { saveConsultPrepEmailsAction } = await import("@/app/dashboard/settings/team/consult-prep-actions");
const { rerunConsultPrepAction } = await import("@/app/dashboard/leads/[id]/consult-prep-actions");

const member = (userId: string, role: string, email: string | null = `${userId}@firm.example`) => ({ userId, email, displayName: userId, role, identified: true });
const form = (ids: string[], cc = "") => {
  const fd = new FormData();
  for (const id of ids) fd.append("userId", id);
  fd.set("cc", cc);
  return fd;
};

beforeEach(() => {
  state.role = "owner";
  state.members = [member("u-1", "attorney"), member("u-2", "viewer"), member("u-3", "paralegal", null)];
  state.membersThrow = false;
  state.saved = [];
  state.setting = { status: "ok", entryId: "entry-1" };
  state.saveThrows = false;
  state.lead = { id: "8f1c2a3b-0000-4000-8000-000000000001", org_id: "org-1", merged_into_id: null };
  state.outcome = { status: "ok", result: { itemsIn: 1 } };
  state.scoped = [];
});

describe("Settings -> Team: who gets consult prep emails", () => {
  it("saves the picked members and a Cc on their domain", async () => {
    expect(await saveConsultPrepEmailsAction({}, form(["u-1"], "Info@Firm.example"))).toEqual({ saved: true });
    expect(state.saved).toEqual([[["u-1"], ["info@firm.example"], "entry-1"]]);
  });
  it("the admin tier only: any other role, or no role, saves nothing", async () => {
    for (const role of ["attorney", "paralegal", "intake", "viewer", null]) {
      state.role = role;
      const res = await saveConsultPrepEmailsAction({}, form(["u-1"]));
      expect(res.error, String(role)).toBeTruthy();
    }
    expect(state.saved).toHaveLength(0);
  });
  it("refuses an id that is not a member, and a member in a role that can't receive it", async () => {
    expect((await saveConsultPrepEmailsAction({}, form(["u-ghost"]))).error).toMatch(/isn't on the team any more/);
    expect((await saveConsultPrepEmailsAction({}, form(["u-2"]))).error).toMatch(/Viewers and social media members can.t get consult prep/);
    expect(state.saved).toHaveLength(0);
  });
  it("refuses a Cc that is not a bare address, is on another domain, or is too many", async () => {
    expect((await saveConsultPrepEmailsAction({}, form(["u-1"], "Info <info@firm.example>"))).error).toMatch(/plain email address/);
    expect((await saveConsultPrepEmailsAction({}, form(["u-1"], "info@elsewhere.example"))).error).toMatch(/same email domain/);
    expect((await saveConsultPrepEmailsAction({}, form(["u-1"], "a@firm.example b@firm.example c@firm.example d@firm.example e@firm.example f@firm.example"))).error).toMatch(/up to 5/);
    expect(state.saved).toHaveLength(0);
  });
  it("a Cc with nobody chosen is refused (nothing to match its domain)", async () => {
    expect((await saveConsultPrepEmailsAction({}, form([], "info@firm.example"))).error).toMatch(/same email domain/);
  });
  it("an unreadable team or setting saves nothing and says so; a failed write shows a fixed sentence", async () => {
    state.membersThrow = true;
    expect((await saveConsultPrepEmailsAction({}, form(["u-1"]))).error).toMatch(/couldn.t load your team/);
    state.membersThrow = false;
    state.setting = { status: "unavailable" };
    expect((await saveConsultPrepEmailsAction({}, form(["u-1"]))).error).toMatch(/couldn.t read the current setting/);
    state.setting = { status: "ok", entryId: null };
    state.saveThrows = true;
    const res = await saveConsultPrepEmailsAction({}, form(["u-1"]));
    expect(res.error).toMatch(/Couldn.t save/);
    expect(JSON.stringify(res)).not.toContain("planted-secret");
  });
});

describe("Re-run prep", () => {
  const ID = "8f1c2a3b-0000-4000-8000-000000000001";
  it("runs this lead's prep for the lead row's own firm, as a manual re-run", async () => {
    expect(await rerunConsultPrepAction(ID)).toEqual({ ok: true, message: "Prep re-run. Refresh to see it." });
    expect(state.scoped).toEqual([[{ marker: "deps" }, { orgId: "org-1", scope: { leadIds: [ID], reason: "rerun" }, trigger: "manual" }]]);
  });
  it("owner, admin, senior admin and attorney only; the role is re-read on every call", async () => {
    for (const role of ["owner", "admin", "senior_admin", "attorney"]) {
      state.role = role;
      expect((await rerunConsultPrepAction(ID)).ok, role).toBe(true);
    }
    state.scoped = [];
    for (const role of ["intake", "paralegal", "law_clerk", "clerk", "viewer", "social_media", null]) {
      state.role = role;
      expect(await rerunConsultPrepAction(ID), String(role)).toEqual({ message: "Only an owner, admin or attorney can re-run consult prep." });
    }
    expect(state.scoped).toHaveLength(0);
  });
  it("another firm's lead (not found through the scoped read), a merged lead and a malformed id run nothing", async () => {
    state.lead = null;
    expect((await rerunConsultPrepAction(ID)).message).toMatch(/Couldn.t re-run/);
    state.lead = { id: ID, org_id: "org-1", merged_into_id: "x" };
    expect((await rerunConsultPrepAction(ID)).message).toMatch(/Couldn.t re-run/);
    state.lead = { id: ID, org_id: "org-1", merged_into_id: null };
    expect((await rerunConsultPrepAction("not-a-uuid")).message).toMatch(/Couldn.t re-run/);
    expect(state.scoped).toHaveLength(0);
  });
  it("a firm with the assistant off, a failed run and a run with nothing to prep each get their own fixed sentence", async () => {
    state.outcome = null;
    expect((await rerunConsultPrepAction(ID)).message).toMatch(/isn.t switched on for your firm/);
    state.outcome = { status: "error", error: "SECRET internal text" };
    const failed = await rerunConsultPrepAction(ID);
    expect(failed.message).toMatch(/Couldn.t re-run prep/);
    expect(JSON.stringify(failed)).not.toContain("SECRET");
    state.outcome = { status: "ok", result: { itemsIn: 0 } };
    expect((await rerunConsultPrepAction(ID)).message).toMatch(/no consult to prepare/);
  });
});
