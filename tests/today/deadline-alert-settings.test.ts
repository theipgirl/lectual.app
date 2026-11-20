import { beforeEach, describe, expect, it, vi } from "vitest";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const GONE = "99999999-9999-4999-8999-999999999999";

const s = vi.hoisted(() => ({
  role: "owner" as string | null,
  members: [] as { userId: string }[],
  membersFail: false,
  setting: { status: "ok", entryId: "e1", stored: [], userIds: [] } as unknown,
  saved: [] as unknown[],
}));

vi.mock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => s.role) }));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: vi.fn(async () => {
    if (s.membersFail) throw new Error("db text");
    return s.members;
  }),
}));
vi.mock("@/lib/today/deadline-alerts-store", () => ({
  loadRecipientSetting: vi.fn(async () => s.setting),
  saveAlertRecipients: vi.fn(async (ids: string[], entryId: string | null) => void s.saved.push({ ids, entryId })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveDeadlineAlertRecipientsAction } = await import("@/app/dashboard/settings/team/deadline-alert-actions");

const form = (...ids: string[]) => {
  const fd = new FormData();
  for (const id of ids) fd.append("userId", id);
  return fd;
};

beforeEach(() => {
  s.role = "owner";
  s.members = [{ userId: U1 }, { userId: U2 }];
  s.membersFail = false;
  s.setting = { status: "ok", entryId: "e1", stored: [], userIds: [] };
  s.saved = [];
});

describe("AT3a: the alert recipients are the members the admin tier picks in Settings", () => {
  it("the admin tier saves the picked members (deduped)", async () => {
    expect(await saveDeadlineAlertRecipientsAction({}, form(U1, U2, U1))).toEqual({ saved: true });
    expect(s.saved).toEqual([{ ids: [U1, U2], entryId: "e1" }]);
  });

  it("any other role (and an unreadable one) is refused and nothing is saved", async () => {
    for (const role of ["attorney", "paralegal", "law_clerk", "intake", "viewer", null]) {
      s.role = role;
      const res = await saveDeadlineAlertRecipientsAction({}, form(U1));
      expect(res.error, String(role)).toMatch(/can choose who gets deadline alerts/);
    }
    expect(s.saved).toEqual([]);
  });

  it("an id that is not a current member (a removed member, or invented) is refused", async () => {
    const res = await saveDeadlineAlertRecipientsAction({}, form(U1, GONE));
    expect(res.error).toMatch(/isn't on the team/);
    expect(s.saved).toEqual([]);
  });

  it("an unreadable team or an unreadable current list saves nothing", async () => {
    s.membersFail = true;
    expect((await saveDeadlineAlertRecipientsAction({}, form(U1))).error).toMatch(/couldn't load your team/);
    s.membersFail = false;
    s.setting = { status: "unavailable" };
    expect((await saveDeadlineAlertRecipientsAction({}, form(U1))).error).toMatch(/couldn't read the current list/);
    expect(s.saved).toEqual([]);
  });

  it("saving nobody is allowed (no one gets alerts)", async () => {
    expect(await saveDeadlineAlertRecipientsAction({}, form())).toEqual({ saved: true });
    expect(s.saved).toEqual([{ ids: [], entryId: "e1" }]);
  });
});
