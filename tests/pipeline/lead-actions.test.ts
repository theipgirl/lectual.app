import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Server-action coverage for the lead write paths added alongside createLead /
 * updateLead / addLeadNote. Mock-based (no DB): what's under test here is the
 * boundary behaviour — validation before any write, role refusals surfaced as
 * friendly copy, and raw Postgres/RLS strings never reaching the UI.
 */

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

/** Mocks getScopedClient() so current_org_role() resolves to `role`. */
function mockScopedClientWithRole(role: string | null) {
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_org_role") return { data: role, error: null };
        if (fn === "current_org_id") return { data: "org-1", error: null };
        throw new Error(`unexpected rpc: ${fn}`);
      }),
    })),
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
});

// ── createLeadAction (pipeline board "New lead") ─────────────────────────────

describe("createLeadAction", () => {
  it("rejects invalid input with per-field messages and never calls the data layer", async () => {
    const createLead = vi.fn();
    vi.doMock("@/lib/pipeline", () => ({ createLead, moveLeadStage: vi.fn() }));

    const { createLeadAction } = await import("@/app/dashboard/leads/actions");
    const result = await createLeadAction(
      {},
      fd({ firstName: "", lastName: "Doe", email: "nope" }),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.firstName).toBeTruthy();
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(createLead).not.toHaveBeenCalled();
  });

  it("echoes back what the user typed so a rejected submit loses nothing", async () => {
    vi.doMock("@/lib/pipeline", () => ({ createLead: vi.fn(), moveLeadStage: vi.fn() }));

    const { createLeadAction } = await import("@/app/dashboard/leads/actions");
    const result = await createLeadAction(
      {},
      fd({ firstName: "Jane", lastName: "Doe", email: "nope", businessName: "Doe Studio" }),
    );

    expect(result.values?.firstName).toBe("Jane");
    expect(result.values?.businessName).toBe("Doe Studio");
  });

  it("returns the new lead's id on success", async () => {
    const createLead = vi.fn<(input: Record<string, unknown>) => Promise<{ id: string }>>(
      async () => ({ id: "lead-new" }),
    );
    vi.doMock("@/lib/pipeline", () => ({ createLead, moveLeadStage: vi.fn() }));

    const { createLeadAction } = await import("@/app/dashboard/leads/actions");
    const result = await createLeadAction(
      {},
      fd({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" }),
    );

    expect(result).toMatchObject({ ok: true, leadId: "lead-new" });
    expect(createLead).toHaveBeenCalledOnce();
    expect(createLead.mock.calls[0][0]).toMatchObject({ source: "dashboard" });
  });

  it("passes an empty stage/assignee through as null, not as an empty string", async () => {
    const createLead = vi.fn<(input: Record<string, unknown>) => Promise<{ id: string }>>(
      async () => ({ id: "lead-new" }),
    );
    vi.doMock("@/lib/pipeline", () => ({ createLead, moveLeadStage: vi.fn() }));

    const { createLeadAction } = await import("@/app/dashboard/leads/actions");
    await createLeadAction(
      {},
      fd({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" }),
    );

    const arg = createLead.mock.calls[0][0];
    expect(arg.currentStageId).toBeNull();
    expect(arg.assignedTo).toBeNull();
  });

  it("never surfaces a raw RLS error to the UI", async () => {
    const createLead = vi.fn(async () => {
      throw {
        code: "42501",
        message: 'new row violates row-level security policy for table "crm_lead"',
      };
    });
    vi.doMock("@/lib/pipeline", () => ({ createLead, moveLeadStage: vi.fn() }));

    const { createLeadAction } = await import("@/app/dashboard/leads/actions");
    const result = await createLeadAction(
      {},
      fd({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/row-level security|crm_lead/);
    expect(result.error).toMatch(/permission/i);
  });
});

// ── editLeadAction (lead detail) ─────────────────────────────────────────────

describe("editLeadAction", () => {
  function mockLeadDetailDeps(overrides: Record<string, unknown> = {}) {
    vi.doMock("@/lib/pipeline", () => ({
      assignLead: vi.fn(),
      applyTag: vi.fn(),
      removeTag: vi.fn(),
      updateLead: vi.fn(),
      addLeadNote: vi.fn(),
      ...overrides,
    }));
    vi.doMock("@/lib/handoff", () => ({ linkFounder: vi.fn() }));
    vi.doMock("@/app/dashboard/leads/actions", () => ({
      moveLeadStageAction: vi.fn(),
    }));
  }

  it("a viewer cannot edit a lead", async () => {
    mockScopedClientWithRole("viewer");
    const updateLead = vi.fn();
    mockLeadDetailDeps({ updateLead });

    const { editLeadAction } = await import("@/app/dashboard/leads/[id]/actions");
    const result = await editLeadAction(
      {},
      fd({ leadId: "lead-1", firstName: "Jane", lastName: "Doe", email: "jane@example.com" }),
    );

    expect(result.error).toMatch(/permission/i);
    expect(updateLead).not.toHaveBeenCalled();
  });

  it("a paralegal CAN correct a client's email", async () => {
    mockScopedClientWithRole("paralegal");
    const updateLead = vi.fn<(id: string, patch: Record<string, unknown>) => Promise<{ id: string }>>(
      async () => ({ id: "lead-1" }),
    );
    mockLeadDetailDeps({ updateLead });

    const { editLeadAction } = await import("@/app/dashboard/leads/[id]/actions");
    const result = await editLeadAction(
      {},
      fd({
        leadId: "lead-1",
        firstName: "Jane",
        lastName: "Doe",
        email: "correct@example.com",
        phone: "",
        businessName: "",
        website: "",
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.saved).toBe(true);
    expect(updateLead).toHaveBeenCalledOnce();
    expect(updateLead.mock.calls[0][1]).toMatchObject({ email: "correct@example.com" });
  });

  it("blocks a blank email before it reaches the data layer", async () => {
    mockScopedClientWithRole("attorney");
    const updateLead = vi.fn();
    mockLeadDetailDeps({ updateLead });

    const { editLeadAction } = await import("@/app/dashboard/leads/[id]/actions");
    const result = await editLeadAction(
      {},
      fd({ leadId: "lead-1", firstName: "Jane", lastName: "Doe", email: "" }),
    );

    expect(result.fieldErrors?.email).toBeTruthy();
    expect(updateLead).not.toHaveBeenCalled();
  });
});

// ── addNoteAction (lead detail timeline composer) ────────────────────────────

describe("addNoteAction", () => {
  function mockLeadDetailDeps(overrides: Record<string, unknown> = {}) {
    vi.doMock("@/lib/pipeline", () => ({
      assignLead: vi.fn(),
      applyTag: vi.fn(),
      removeTag: vi.fn(),
      updateLead: vi.fn(),
      addLeadNote: vi.fn(),
      ...overrides,
    }));
    vi.doMock("@/lib/handoff", () => ({ linkFounder: vi.fn() }));
    vi.doMock("@/app/dashboard/leads/actions", () => ({
      moveLeadStageAction: vi.fn(),
    }));
  }

  it("writes a note for a staff role", async () => {
    mockScopedClientWithRole("intake");
    const addLeadNote = vi.fn(async () => {});
    mockLeadDetailDeps({ addLeadNote });

    const { addNoteAction } = await import("@/app/dashboard/leads/[id]/actions");
    const result = await addNoteAction(
      {},
      fd({ leadId: "lead-1", kind: "call_logged", body: "Spoke with the founder.", subject: "Intro call" }),
    );

    expect(result.error).toBeUndefined();
    expect(addLeadNote).toHaveBeenCalledWith("lead-1", {
      kind: "call_logged",
      body: "Spoke with the founder.",
      subject: "Intro call",
    });
  });

  it("refuses an empty note without calling the data layer", async () => {
    mockScopedClientWithRole("attorney");
    const addLeadNote = vi.fn();
    mockLeadDetailDeps({ addLeadNote });

    const { addNoteAction } = await import("@/app/dashboard/leads/[id]/actions");
    const result = await addNoteAction({}, fd({ leadId: "lead-1", kind: "note", body: "   " }));

    expect(result.error).toBeTruthy();
    expect(addLeadNote).not.toHaveBeenCalled();
  });

  it("a viewer cannot write to the timeline", async () => {
    mockScopedClientWithRole("viewer");
    const addLeadNote = vi.fn();
    mockLeadDetailDeps({ addLeadNote });

    const { addNoteAction } = await import("@/app/dashboard/leads/[id]/actions");
    const result = await addNoteAction({}, fd({ leadId: "lead-1", kind: "note", body: "hi" }));

    expect(result.error).toMatch(/permission/i);
    expect(addLeadNote).not.toHaveBeenCalled();
  });

  it("surfaces a failed insert instead of silently claiming success", async () => {
    // The note IS the mutation here — unlike the audit rows on other
    // mutations, a failure must reach the person who typed it.
    mockScopedClientWithRole("attorney");
    const addLeadNote = vi.fn(async () => {
      throw { code: "42501", message: 'new row violates row-level security policy' };
    });
    mockLeadDetailDeps({ addLeadNote });

    const { addNoteAction } = await import("@/app/dashboard/leads/[id]/actions");
    const result = await addNoteAction({}, fd({ leadId: "lead-1", kind: "note", body: "hi" }));

    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/row-level security/);
  });
});
