import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupState } from "@/lib/setup/types";
import { ADMIN_TIER, ALL_DONE, NOTHING_DONE, OTHER_ROLES, bad, ok } from "./helpers";

afterEach(() => vi.resetModules());

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("<!-- -->", "");

async function renderCard(role: string | null | undefined, state: SetupState, loader?: () => Promise<SetupState>) {
  vi.resetModules();
  const loadSetupState = vi.fn(loader ?? (async () => state));
  vi.doMock("@/lib/setup/load", () => ({ loadSetupState }));
  const { FinishSetupCard } = await import("../../src/components/setup/FinishSetupCard");
  return { html: text(renderToStaticMarkup(await FinishSetupCard({ role }))), loadSetupState };
}

const PARTLY: SetupState = { ...NOTHING_DONE, profile: ok({ displayName: "Hartwell IP", emailSignature: "Best" }), members: ok({ count: 5 }), aiConfigured: true };

describe("shown", () => {
  it.each([...ADMIN_TIER])("%s sees 'Finish setting up · N of 10', the first open item and a Continue setup link", async (role) => {
    const { html } = await renderCard(role, PARTLY);
    expect(html).toContain("Finish setting up · 3 of 10");
    expect(html).toContain("Next: Outlook mailbox connected");
    expect(html).toMatch(/href="\/dashboard\/setup\/?"[^>]*>Continue setup</);
    expect(html).not.toContain("couldn't be checked");
  });

  it("names the first item that is not done, even when it is a couldn't-check", async () => {
    const { html } = await renderCard("owner", { ...PARTLY, profile: bad });
    expect(html).toContain("Next: Firm profile and sign-off");
  });

  it("with two items unreadable it still shows, counts only done items, and says 2 couldn't be checked", async () => {
    const { html } = await renderCard("admin", { ...ALL_DONE, lawmatics: bad, meetings: bad });
    expect(html).toContain("Finish setting up · 8 of 10");
    expect(html).toContain("2 couldn't be checked");
  });

  it("with every read failed it still shows, never hidden as if complete", async () => {
    const allBad: SetupState = { profile: bad, members: bad, modules: bad, mailboxes: bad, lawmatics: bad, meetings: bad, lawpay: bad, agents: bad, intakeForms: bad, services: bad, aiConfigured: true };
    const { html } = await renderCard("owner", allBad);
    expect(html).toContain("Finish setting up · 1 of 10");
    expect(html).toContain("9 couldn't be checked");
  });
});

describe("hidden", () => {
  it("renders nothing when the checklist is complete", async () => {
    expect((await renderCard("owner", ALL_DONE)).html).toBe("");
  });

  it.each([...OTHER_ROLES, null, undefined, "not-a-role", ""])("renders nothing for %j and never reads setup", async (role) => {
    const { html, loadSetupState } = await renderCard(role as string | null | undefined, NOTHING_DONE);
    expect(html).toBe("");
    expect(loadSetupState).toHaveBeenCalledTimes(0);
  });

  it("a loader that throws renders nothing instead of breaking Today", async () => {
    const { html } = await renderCard("owner", NOTHING_DONE, async () => {
      throw new Error("boom");
    });
    expect(html).toBe("");
  });
});

describe("one entry point", () => {
  it("the card's link, the Settings redirect and the setup path are the same string", async () => {
    const { SETUP_PATH } = await import("@/lib/setup/routes");
    const { html } = await renderCard("owner", NOTHING_DONE);
    expect(html).toContain(`href="${SETUP_PATH.replace(/\/$/, "")}`);
    const redirectSrc = (await import("node:fs")).readFileSync("src/app/dashboard/settings/page.tsx", "utf8");
    const cardSrc = (await import("node:fs")).readFileSync("src/components/setup/FinishSetupCard.tsx", "utf8");
    expect(redirectSrc).toContain("SETUP_PATH");
    expect(cardSrc).toContain("SETUP_PATH");
    expect(SETUP_PATH).toBe("/dashboard/setup/");
  });
});
