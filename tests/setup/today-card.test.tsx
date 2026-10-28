import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { todaySetupCard, type SetupReading } from "@/lib/setup/today-card";
import { ADMIN_TIER, ALL_DONE, NOTHING_DONE, OTHER_ROLES } from "./helpers";
import type { SetupState } from "@/lib/setup/types";

afterEach(() => vi.resetModules());

describe("todaySetupCard: exactly one get-set-up card", () => {
  const readings: SetupReading[] = ["items-left", "complete", "unreadable"];

  it.each([...ADMIN_TIER])("%s: Setup while items are left; Getting started once complete or unreadable", (role) => {
    expect(todaySetupCard(role, "items-left")).toBe("setup");
    expect(todaySetupCard(role, "complete")).toBe("getting-started");
    expect(todaySetupCard(role, "unreadable")).toBe("getting-started");
  });

  it.each([...OTHER_ROLES, null, undefined, "not-a-role"])("%j always gets Getting started", (role) => {
    for (const r of readings) expect(todaySetupCard(role as string | null | undefined, r)).toBe("getting-started");
  });
});

async function render(role: string, state: SetupState | "throws") {
  vi.resetModules();
  const loadSetupState = vi.fn(async () => {
    if (state === "throws") throw new Error("boom");
    return state;
  });
  vi.doMock("@/lib/setup/load", () => ({ loadSetupState }));
  vi.doMock("@/components/onboarding/GettingStartedCard", () => ({ GettingStartedCard: () => <section data-card="getting-started">Getting started</section> }));
  const { GetSetUpCard } = await import("@/components/setup/GetSetUpCard");
  return { html: renderToStaticMarkup(await GetSetUpCard({ role })), loadSetupState };
}

describe("GetSetUpCard", () => {
  it("shows only the Setup card for an admin with items left", async () => {
    const { html } = await render("owner", NOTHING_DONE);
    expect(html).toContain("Finish setting up");
    expect(html).not.toContain("data-card");
  });

  it("shows only Getting started when setup is complete, or could not be read", async () => {
    for (const state of [ALL_DONE, "throws"] as const) {
      const { html } = await render("admin", state);
      expect(html).toContain('data-card="getting-started"');
      expect(html).not.toContain("Finish setting up");
    }
  });

  it("another role never reads setup and gets Getting started", async () => {
    const { html, loadSetupState } = await render("attorney", NOTHING_DONE);
    expect(html).toContain('data-card="getting-started"');
    expect(loadSetupState).not.toHaveBeenCalled();
  });
});
