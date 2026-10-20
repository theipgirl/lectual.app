import { describe, it, expect, vi, beforeEach } from "vitest";

async function load(held: boolean) {
  const redirect = vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  });
  const notFound = vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  const orgHasModule = vi.fn(async () => held);
  vi.doMock("next/navigation", () => ({ redirect, notFound }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule }));
  const { default: Page } = await import("../../src/app/dashboard/settings/agents/page");
  return { Page, redirect, notFound, orgHasModule };
}

describe("/dashboard/settings/agents (F15)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("redirects to /dashboard/agents/ when the firm holds the agents module", async () => {
    const { Page, redirect, notFound, orgHasModule } = await load(true);
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/dashboard/agents/");
    expect(redirect).toHaveBeenCalledWith("/dashboard/agents/");
    expect(notFound).not.toHaveBeenCalled();
    expect(orgHasModule).toHaveBeenCalledWith("agents");
  });

  it("is a 404 when the firm lacks the module", async () => {
    const { Page, redirect, notFound, orgHasModule } = await load(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
    expect(orgHasModule).toHaveBeenCalledWith("agents");
  });
});
