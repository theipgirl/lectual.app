// Ported from lectual tests/matters/matters-page.test.ts (the mocked
// role-gating block), retargeted to src/app/dashboard/matters/[id]/actions.ts,
// plus cases for the owner, stage, LIT module gate and error wording.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  role: "attorney" as string | null,
  modules: [] as string[],
}));

const mockRpc = vi.fn(() => Promise.resolve({ data: state.role, error: null as unknown }));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ rpc: mockRpc })),
}));
vi.mock("@/lib/org/modules", () => ({
  orgHasModule: vi.fn(async (m: string) => state.modules.includes(m)),
}));

const mockCreateMatter = vi.fn(async (input: unknown) => ({ id: "matter-new", ...(input as object) }));
const mockUpdateMatterStatus = vi.fn(async (id: string, status: string) => ({ id, status }));
const mockCreateTask = vi.fn(async (input: unknown) => ({ id: "task-new", ...(input as object) }));
const mockCompleteTask = vi.fn(async (id: string) => ({ id, status: "completed" }));
const mockAssign = vi.fn(async (id: string, userId: string | null) => ({ id, assigned_to: userId }));
const mockUpdateStage = vi.fn(async (): Promise<void> => {
  throw Object.assign(new Error('insert or update on table "crm_matter" violates foreign key constraint'), { code: "23503" });
});

vi.mock("@/lib/matters", () => ({
  createMatter: (...args: unknown[]) => mockCreateMatter(...(args as [unknown])),
  updateMatterStatus: (...args: unknown[]) => mockUpdateMatterStatus(...(args as [string, string])),
  createTask: (...args: unknown[]) => mockCreateTask(...(args as [unknown])),
  completeTask: (...args: unknown[]) => mockCompleteTask(...(args as [string])),
  assignMatterOwner: (...args: unknown[]) => mockAssign(...(args as [string, string | null])),
  closeDeadline: vi.fn(),
  confirmDeadline: vi.fn(),
  createDeadline: vi.fn(),
  extendDeadline: vi.fn(),
  updateMatterIpFields: vi.fn(),
  updateMatterNotes: vi.fn(),
}));
vi.mock("@/lib/matters/stages", () => ({ updateMatterStage: () => mockUpdateStage() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const {
  requireMatterWriteRole,
  createMatterAction,
  updateMatterStatusAction,
  updateMatterStageAction,
  assignMatterOwnerAction,
  createTaskAction,
  completeTaskAction,
} = await import("../../src/app/dashboard/matters/[id]/actions");
const { MATTER_WRITE_ROLES } = await import("@/lib/matters/matters");

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "attorney";
  state.modules = [];
});

describe("MATTER_WRITE_ROLES membership", () => {
  it("excludes social_media and viewer", () => {
    expect(MATTER_WRITE_ROLES).not.toContain("social_media");
    expect(MATTER_WRITE_ROLES).not.toContain("viewer");
  });
  it("includes paralegal (unlike CAN_MOVE_STAGE for leads)", () => {
    expect(MATTER_WRITE_ROLES).toContain("paralegal");
  });
});

describe("requireMatterWriteRole", () => {
  it("throws a friendly message for viewer", async () => {
    state.role = "viewer";
    await expect(requireMatterWriteRole()).rejects.toThrow(/permission/i);
  });
  it("resolves the role for attorney", async () => {
    state.role = "attorney";
    await expect(requireMatterWriteRole()).resolves.toBe("attorney");
  });
});

describe("createMatterAction", () => {
  it("rejects an invalid/missing type without touching the data layer", async () => {
    const fd = new FormData();
    const result = await createMatterAction({}, fd);
    expect(result.error).toMatch(/type/i);
    expect(mockCreateMatter).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a social_media caller with a friendly error, not a throw", async () => {
    state.role = "social_media";
    const fd = new FormData();
    fd.set("type", "TM");
    const result = await createMatterAction({}, fd);
    expect(result.error).toMatch(/permission/i);
    expect(mockCreateMatter).not.toHaveBeenCalled();
  });

  it("creates the matter and redirects for an authorized role", async () => {
    state.role = "owner";
    const fd = new FormData();
    fd.set("type", "PATENT");
    fd.set("title", "Beta Co. — Utility Patent");
    await expect(createMatterAction({}, fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(mockCreateMatter).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PATENT", title: "Beta Co. — Utility Patent" }),
    );
  });
});

describe("updateMatterStatusAction", () => {
  it("rejects a viewer", async () => {
    state.role = "viewer";
    const fd = new FormData();
    fd.set("matterId", "matter-1");
    fd.set("status", "closed");
    const result = await updateMatterStatusAction({}, fd);
    expect(result.error).toMatch(/permission/i);
    expect(mockUpdateMatterStatus).not.toHaveBeenCalled();
  });

  it("allows an attorney and calls updateMatterStatus with (id, status)", async () => {
    state.role = "attorney";
    const fd = new FormData();
    fd.set("matterId", "matter-1");
    fd.set("status", "closed");
    const result = await updateMatterStatusAction({}, fd);
    expect(result).toEqual({});
    expect(mockUpdateMatterStatus).toHaveBeenCalledWith("matter-1", "closed");
  });

  it("rejects a call missing matterId or status without touching the data layer", async () => {
    const result = await updateMatterStatusAction({}, new FormData());
    expect(result.error).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("createTaskAction / completeTaskAction", () => {
  it("allows paralegal to create a task", async () => {
    state.role = "paralegal";
    const fd = new FormData();
    fd.set("matterId", "matter-1");
    fd.set("title", "Follow up on OA");
    const result = await createTaskAction({}, fd);
    expect(result).toEqual({});
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: "matter-1", title: "Follow up on OA" }),
    );
  });

  it("rejects social_media for completeTaskAction", async () => {
    state.role = "social_media";
    const fd = new FormData();
    fd.set("taskId", "task-1");
    fd.set("matterId", "matter-1");
    const result = await completeTaskAction({}, fd);
    expect(result.error).toMatch(/permission/i);
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it("allows clerk to complete a task", async () => {
    state.role = "clerk";
    const fd = new FormData();
    fd.set("taskId", "task-1");
    fd.set("matterId", "matter-1");
    const result = await completeTaskAction({}, fd);
    expect(result).toEqual({});
    expect(mockCompleteTask).toHaveBeenCalledWith("task-1");
  });
});


describe("assignMatterOwnerAction", () => {
  it("unassigns on an empty choice", async () => {
    const fd = new FormData();
    fd.set("matterId", "matter-1");
    fd.set("userId", "");
    expect(await assignMatterOwnerAction({}, fd)).toEqual({});
    expect(mockAssign).toHaveBeenCalledWith("matter-1", null);
  });
  it("refuses a viewer", async () => {
    state.role = "viewer";
    const fd = new FormData();
    fd.set("matterId", "matter-1");
    fd.set("userId", "u1");
    expect((await assignMatterOwnerAction({}, fd)).error).toMatch(/permission/i);
    expect(mockAssign).not.toHaveBeenCalled();
  });
});

describe("updateMatterStageAction", () => {
  it("turns a database error into words, never the raw message", async () => {
    const fd = new FormData();
    fd.set("matterId", "matter-1");
    fd.set("stageId", "gone");
    const result = await updateMatterStageAction({}, fd);
    expect(result.error).toMatch(/no longer exists/);
    expect(result.error).not.toMatch(/constraint/);
  });
});

describe("createMatterAction: litigation is module-gated at the action", () => {
  it("refuses a hand-posted LIT without the litigation module", async () => {
    const fd = new FormData();
    fd.set("type", "LIT");
    fd.set("matterNumber", "26-CC-011354");
    expect((await createMatterAction({}, fd)).error).toMatch(/isn't available/);
    expect(mockCreateMatter).not.toHaveBeenCalled();
  });
  it("needs the court case number when the firm has the module", async () => {
    state.modules = ["litigation"];
    const fd = new FormData();
    fd.set("type", "LIT");
    expect((await createMatterAction({}, fd)).error).toMatch(/case number/);
    fd.set("matterNumber", "26-CC-011354");
    await expect(createMatterAction({}, fd)).rejects.toThrow("NEXT_REDIRECT");
  });
});
