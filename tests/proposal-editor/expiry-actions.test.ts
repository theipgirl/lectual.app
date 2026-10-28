import { beforeEach, describe, expect, it, vi } from "vitest";
import { sevetri } from "../proposals/fixture";

/** The expiry date is saved by the package form (savePricingAction); the client save never clears it. */

describe("expiry date saves", () => {
  beforeEach(() => vi.resetModules());

  async function setup() {
    const updateProposal = vi.fn(async (_id: string, patch: Record<string, unknown>) => ({ status: "draft", ...patch }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateStaffAction: vi.fn(async () => null) }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposal: vi.fn(async () => ({ proposal: { id: "p1", status: "draft", content: sevetri() } })),
      updateProposal,
    }));
    const mod = await import("../../src/app/dashboard/proposals/[id]/actions");
    const form = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ proposalId: "p1", updatedAt: "2026-10-01T00:00:00Z", ...o })) f.set(k, v);
      return f;
    };
    return { mod, updateProposal, form };
  }

  const pricing = { package: "Concierge", base: "4950", includedClasses: "1", perClass: "825", secondMarkPct: "0", govPerClass: "350" };

  it("the package form posts expiresOn and it is saved", async () => {
    const { mod, updateProposal, form } = await setup();
    const r = await mod.savePricingAction({}, form({ ...pricing, expiresOn: "2026-12-01" }));
    expect(r.saved).toBe(true);
    expect(updateProposal.mock.calls[0][1].expiresOn).toBe("2026-12-01");
  });

  it("a package form without the field leaves the stored expiry alone", async () => {
    const { mod, updateProposal, form } = await setup();
    await mod.savePricingAction({}, form(pricing));
    expect("expiresOn" in updateProposal.mock.calls[0][1]).toBe(false);
  });

  it("a bad date on the package form is refused", async () => {
    const { mod, updateProposal, form } = await setup();
    const r = await mod.savePricingAction({}, form({ ...pricing, expiresOn: "2026-02-31" }));
    expect(r.error).toMatch(/Expiry date/);
    expect(updateProposal).not.toHaveBeenCalled();
  });

  it("the client save does not carry expiresOn, so it cannot clear it", async () => {
    const { mod, updateProposal, form } = await setup();
    await mod.saveDetailsAction({}, form({ fullName: "Ana Ruiz", firstName: "Ana", title: "T" }));
    expect("expiresOn" in updateProposal.mock.calls[0][1]).toBe(false);
  });
});
