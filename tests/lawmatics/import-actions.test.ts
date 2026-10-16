// Ported from lectual tests/lawmatics/import-actions.test.ts, retargeted at
// Settings → Integrations → Lawmatics. The module mock is gone (no module gate:
// the token is the firm's own); "not connected" now surfaces from the pull.
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards on the /dashboard/import server action. These are authorization and
 * two-step-confirmation tests, not data tests: the question is only ever
 * "under what circumstances does a write happen?".
 */

const state = vi.hoisted(() => ({
  role: "owner" as string | null,
  connected: true,
  applyCalls: [] as Array<{
    fingerprint: string;
    moveExistingStages: boolean;
    practiceAreaFilter: string | null;
  }>,
  previewCalls: 0,
}));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    rpc: async (fn: string) =>
      fn === "current_org_role"
        ? { data: state.role, error: null }
        : { data: null, error: null },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/lawmatics/connection", async () => {
  class LawmaticsNotConnectedError extends Error {}
  return {
    LawmaticsNotConnectedError,
    recordLawmaticsOutcome: async () => {},
    checkTokenShape: () => ({ ok: true, token: "t" }),
    verifyLawmaticsToken: async () => ({ ok: true }),
    saveLawmaticsToken: async () => ({ ok: true }),
    disconnectLawmatics: async () => ({ ok: true }),
  };
});
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "signed-out" }) }));
vi.mock("@/lib/mailbox/config", () => ({ rootKeyOrNull: () => null }));

const emptyPlan = {
  options: { moveExistingStages: false, overwriteEditedFields: false, practiceAreaFilter: null },
  creates: [],
  updates: [],
  unchanged: [],
  divergences: [],
  withheld: [],
  unmapped: [],
  skipped: [],
  totals: {
    sourceRecords: 0,
    create: 0,
    update: 0,
    unchanged: 0,
    divergent: 0,
    withheld: 0,
    unmapped: 0,
    skipped: 0,
  },
  fingerprint: "fp-current",
};

vi.mock("@/lib/lawmatics/import", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lawmatics/import")>(
    "@/lib/lawmatics/import",
  );
  return {
    ...actual,
    previewImport: async (options: { moveExistingStages: boolean }) => {
      if (!state.connected) {
        const { LawmaticsNotConnectedError } = await import("@/lib/lawmatics/connection");
        throw new LawmaticsNotConnectedError("not connected");
      }
      state.previewCalls += 1;
      return {
        fetchedAt: "2026-08-01T00:00:00.000Z",
        plan: { ...emptyPlan, options },
        counts: { prospects: 0, contacts: 0 },
        truncated: false,
        stageNames: [],
      };
    },
    applyImport: async (
      fingerprint: string,
      options: { moveExistingStages: boolean; practiceAreaFilter: string | null },
    ) => {
      state.applyCalls.push({
        fingerprint,
        moveExistingStages: options.moveExistingStages,
        practiceAreaFilter: options.practiceAreaFilter,
      });
      return {
        startedAt: "2026-08-01T00:00:00.000Z",
        finishedAt: "2026-08-01T00:00:05.000Z",
        fingerprint,
        created: 0,
        updated: 0,
        linked: 0,
        stageMoves: 0,
        unchanged: 0,
        divergences: [],
        withheld: [],
        unmapped: [],
        skipped: [],
        failures: [],
        truncated: false,
      };
    },
  };
});

const { importAction } = await import("@/app/dashboard/settings/integrations/lawmatics/actions");

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.role = "owner";
  state.connected = true;
  state.applyCalls = [];
  state.previewCalls = 0;
});

describe("importAction — authorization", () => {
  it.each(["intake", "paralegal", "attorney", "viewer", "social_media", "law_clerk"])(
    "refuses %s and never touches Lawmatics",
    async (role) => {
      state.role = role;
      const result = await importAction(
        { phase: "idle" },
        form({ intent: "confirm", fingerprint: "fp-current", acknowledge: "on" }),
      );
      expect(result.phase).toBe("error");
      expect(result.error).toMatch(/forbidden/i);
      expect(state.applyCalls).toHaveLength(0);
      expect(state.previewCalls).toBe(0);
    },
  );

  it.each(["owner", "admin", "senior_admin"])("allows %s", async (role) => {
    state.role = role;
    const result = await importAction({ phase: "idle" }, form({ intent: "preview" }));
    expect(result.phase).toBe("preview");
  });

  it("fails closed when no role resolves", async () => {
    state.role = null;
    const result = await importAction({ phase: "idle" }, form({ intent: "preview" }));
    expect(result.phase).toBe("error");
    expect(state.previewCalls).toBe(0);
  });

  it("refuses when Lawmatics isn't configured", async () => {
    state.connected = false;
    const result = await importAction({ phase: "idle" }, form({ intent: "preview" }));
    expect(result.phase).toBe("error");
    expect(state.previewCalls).toBe(0);
  });
});

describe("importAction — two-step confirmation", () => {
  it("previews without writing", async () => {
    const result = await importAction({ phase: "idle" }, form({ intent: "preview" }));
    expect(result.phase).toBe("preview");
    expect(state.applyCalls).toHaveLength(0);
  });

  it("treats an unknown intent as a dry run", async () => {
    const result = await importAction({ phase: "idle" }, form({ intent: "something-else" }));
    expect(result.phase).toBe("preview");
    expect(state.applyCalls).toHaveLength(0);
  });

  it("will not write without the acknowledgement box, even with a valid fingerprint", async () => {
    const result = await importAction(
      { phase: "idle" },
      form({ intent: "confirm", fingerprint: "fp-current" }),
    );
    expect(state.applyCalls).toHaveLength(0);
    expect(result.phase).toBe("preview");
    expect(result.error).toMatch(/confirmation box/i);
  });

  it("will not write without a fingerprint", async () => {
    const result = await importAction(
      { phase: "idle" },
      form({ intent: "confirm", acknowledge: "on" }),
    );
    expect(state.applyCalls).toHaveLength(0);
    expect(result.phase).toBe("error");
  });

  it("writes only on an explicit confirm, passing the approved fingerprint through", async () => {
    const result = await importAction(
      { phase: "idle" },
      form({ intent: "confirm", fingerprint: "fp-current", acknowledge: "on" }),
    );
    expect(state.applyCalls).toEqual([
      { fingerprint: "fp-current", moveExistingStages: false, practiceAreaFilter: null },
    ]);
    expect(result.phase).toBe("done");
  });

  it("carries the stage-move opt-in only when it was ticked", async () => {
    await importAction(
      { phase: "idle" },
      form({
        intent: "confirm",
        fingerprint: "fp-current",
        acknowledge: "on",
        moveExistingStages: "on",
      }),
    );
    expect(state.applyCalls[0].moveExistingStages).toBe(true);
  });

  it("reads the trademark-only filter from its own checkbox, on or off", async () => {
    await importAction(
      { phase: "idle" },
      form({
        intent: "confirm",
        fingerprint: "fp-current",
        acknowledge: "on",
        trademarkOnly: "on",
      }),
    );
    expect(state.applyCalls[0].practiceAreaFilter).toBe("Trademark");

    await importAction(
      { phase: "idle" },
      form({ intent: "confirm", fingerprint: "fp-current", acknowledge: "on" }),
    );
    expect(state.applyCalls[1].practiceAreaFilter).toBeNull();
  });

  it("shows a refreshed preview instead of writing when the plan moved on", async () => {
    const { PlanChangedError } = await import("@/lib/lawmatics/import");
    const mod = await import("@/lib/lawmatics/import");
    const spy = vi.spyOn(mod, "applyImport").mockRejectedValueOnce(
      new PlanChangedError({
        fetchedAt: "2026-08-01T00:00:00.000Z",
        plan: { ...emptyPlan, fingerprint: "fp-new" },
        counts: { prospects: 1, contacts: 1 },
        truncated: false,
        includeDropped: false,
        stageNames: [],
      }),
    );

    const result = await importAction(
      { phase: "idle" },
      form({ intent: "confirm", fingerprint: "fp-stale", acknowledge: "on" }),
    );

    expect(result.phase).toBe("preview");
    expect(result.preview?.fingerprint).toBe("fp-new");
    expect(result.error).toMatch(/changed/i);
    spy.mockRestore();
  });
});
