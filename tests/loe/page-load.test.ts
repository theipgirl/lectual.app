import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  role: "admin" as string | null,
  user: "u-1" as string | null,
  settings: { approver_user_ids: ["u-1"] } as { approver_user_ids: string[] } | null | "throw",
  versions: { status: "ok", versions: [] } as unknown,
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-role", () => ({ currentRole: async () => state.role }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) } }) }));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: async () => [
    { userId: "u-1", displayName: "Rebecca Ortiz", email: "r@example.com", role: "owner" },
    { userId: "u-2", displayName: null, email: "pat@example.com", role: "admin" },
  ],
}));
vi.mock("@/lib/proposals/store", () => ({
  getProposalSettings: async () => {
    if (state.settings === "throw") throw new Error("down");
    return state.settings;
  },
}));
vi.mock("@/lib/loe/templates-store", () => ({ listLetterVersions: async () => state.versions }));

async function load() {
  const { loadLetterPage } = await import("@/lib/loe/page-load");
  return loadLetterPage();
}

beforeEach(() => {
  state.role = "admin";
  state.user = "u-1";
  state.settings = { approver_user_ids: ["u-1"] };
  state.versions = { status: "ok", versions: [] };
});

describe("loadLetterPage", () => {
  it("a named admin can edit and approve, and the approvers are named", async () => {
    const m = await load();
    expect(m).toMatchObject({ status: "ok", canEdit: true, canApprove: true, approvers: { status: "ok", names: ["Rebecca Ortiz"] } });
  });

  it("an admin who is not named cannot approve", async () => {
    state.user = "u-2";
    expect(await load()).toMatchObject({ canEdit: true, canApprove: false });
  });

  it("a viewer, even if named, can neither edit nor approve", async () => {
    state.role = "viewer";
    expect(await load()).toMatchObject({ canEdit: false, canApprove: false });
  });

  it("an unreadable role can do nothing", async () => {
    state.role = null;
    expect(await load()).toMatchObject({ canEdit: false, canApprove: false });
  });

  it("unreadable approvers hide Approve instead of guessing", async () => {
    state.settings = "throw";
    expect(await load()).toMatchObject({ canApprove: false, approvers: { status: "unreadable" } });
  });

  it("the table states pass straight through", async () => {
    state.versions = { status: "not-set-up" };
    expect(await load()).toEqual({ status: "not-set-up" });
    state.versions = { status: "unavailable" };
    expect(await load()).toEqual({ status: "unavailable" });
  });
});
