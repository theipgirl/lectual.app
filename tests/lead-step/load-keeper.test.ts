import { describe, expect, it, vi } from "vitest";

/** loadLeadStepFacts never throws: a lead that isn't there is not-found, a failed read of it is unavailable. */
const getLead = vi.fn();
const resolveLeadId = vi.fn();
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney", actingAsStaff: false, user: { id: "u" } })) }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/pipeline", () => ({ CAN_MOVE_STAGE: ["attorney"], getLead: (...a: unknown[]) => getLead(...a), listStages: vi.fn(async () => []) }));
vi.mock("@/lib/leads/live", () => ({ resolveLeadId: (...a: unknown[]) => resolveLeadId(...a), mergedSetFor: vi.fn(async () => ({ status: "ok", ids: [] })) }));

const ID = "11111111-1111-4111-8111-111111111111";

describe("loadLeadStepFacts", () => {
  it("a lead read that throws is unavailable, not a thrown page", async () => {
    getLead.mockRejectedValueOnce(new Error("boom"));
    const { loadLeadStepFacts } = await import("@/lib/lead-step/load");
    await expect(loadLeadStepFacts(ID)).resolves.toEqual({ status: "unavailable" });
  });
  it("a lead that isn't there (or another firm's) is not-found", async () => {
    getLead.mockResolvedValueOnce(null);
    const { loadLeadStepFacts } = await import("@/lib/lead-step/load");
    await expect(loadLeadStepFacts(ID)).resolves.toEqual({ status: "not-found" });
  });
  it("a merged lead whose keeper can't be followed is unavailable; a keeper that is gone is not-found", async () => {
    const { loadLeadStepFacts } = await import("@/lib/lead-step/load");
    getLead.mockResolvedValueOnce({ id: ID, merged_into_id: "k" });
    resolveLeadId.mockResolvedValueOnce({ status: "unavailable" });
    await expect(loadLeadStepFacts(ID)).resolves.toEqual({ status: "unavailable" });
    getLead.mockResolvedValueOnce({ id: ID, merged_into_id: "k" });
    resolveLeadId.mockRejectedValueOnce(new Error("x"));
    await expect(loadLeadStepFacts(ID)).resolves.toEqual({ status: "unavailable" });
    getLead.mockResolvedValueOnce({ id: ID, merged_into_id: "k" }).mockRejectedValueOnce(new Error("y"));
    resolveLeadId.mockResolvedValueOnce({ status: "ok", id: "k", mergedFrom: ID });
    await expect(loadLeadStepFacts(ID)).resolves.toEqual({ status: "unavailable" });
    getLead.mockResolvedValueOnce({ id: ID, merged_into_id: "k" }).mockResolvedValueOnce(null);
    resolveLeadId.mockResolvedValueOnce({ status: "not-found" });
    await expect(loadLeadStepFacts(ID)).resolves.toEqual({ status: "not-found" });
  });
});
