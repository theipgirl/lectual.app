import { describe, it, expect, vi, beforeEach } from "vitest";

describe("loadLeadOptions", () => {
  beforeEach(() => vi.resetModules());

  async function load(answer: { data: unknown; error: unknown } | "throw") {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order"]) q[m] = () => q;
    q.limit = async () => {
      if (answer === "throw") throw new Error("down");
      return answer;
    };
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ from: () => q })) }));
    return import("../../src/lib/proposals/lead-options");
  }

  it("labels leads by person and business, falling back to email", async () => {
    const { loadLeadOptions } = await load({
      error: null,
      data: [
        { id: "1", first_name: "Ana", last_name: "Ruiz", business_name: "Zephyr", email: "a@x.com" },
        { id: "2", first_name: "", last_name: "", business_name: "Only Co", email: "b@x.com" },
        { id: "3", first_name: "", last_name: "", business_name: null, email: "c@x.com" },
      ],
    });
    expect(await loadLeadOptions()).toEqual({
      status: "ok",
      leads: [
        { id: "1", label: "Ana Ruiz · Zephyr" },
        { id: "2", label: "Only Co" },
        { id: "3", label: "c@x.com" },
      ],
    });
  });

  it("an empty firm is ok with no leads; a failed or thrown read is unavailable, never empty", async () => {
    expect(await (await load({ error: null, data: [] })).loadLeadOptions()).toEqual({ status: "ok", leads: [] });
    vi.resetModules();
    expect(await (await load({ error: { message: "x" }, data: null })).loadLeadOptions()).toEqual({ status: "unavailable" });
    vi.resetModules();
    expect(await (await load("throw")).loadLeadOptions()).toEqual({ status: "unavailable" });
  });
});
