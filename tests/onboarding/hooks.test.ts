import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES } from "@/lib/auth/roles";
import { visibleNav } from "@/lib/nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/" }));
vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));

import { Rail } from "@/components/shell/Rail";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { BellPopover } from "@/components/notifications/BellPopover";
import { SHOW_TOUR_EVENT, navTourToken, requestTourAgain } from "@/lib/onboarding/tour";

const rail = (modules: string[], role = "owner") =>
  renderToStaticMarkup(
    createElement(Rail, {
      items: visibleNav(modules, role as never),
      queueStatus: "ok",
      pendingCount: 2,
      counts: {},
      initialPinned: false,
    }),
  );

const tokensOf = (html: string) => [...html.matchAll(/data-tour="([^"]*)"/g)].flatMap((m) => m[1].split(" "));

describe("rail hooks", () => {
  it("marks the rail, Today, the Intake group, the Matters group, Queue and Settings", () => {
    const html = rail(["agents"]);
    const tokens = tokensOf(html);
    expect(html).toContain('data-tour="rail"');
    for (const t of ["nav-today", "nav-intake", "nav-matters", "nav-queue", "nav-settings"]) expect(tokens, t).toContain(t);
  });

  it("a parent row carries its children's tokens so a collapsed rail can still be spotlighted", () => {
    const html = rail([]);
    const parent = /<a[^>]*data-tour="([^"]*nav-meetings[^"]*)"[^>]*lx-rail-item/.exec(html) ?? /data-tour="([^"]*nav-meetings[^"]*)"[^>]*class="lx-rail-item/.exec(html);
    expect(parent?.[1]).toContain("nav-meetings");
    expect(parent?.[1]).toContain("nav-campaigns");
  });

  it("does not offer a token for a section the firm lacks", () => {
    expect(tokensOf(rail([]))).not.toContain("nav-agents");
    expect(tokensOf(rail(["agents"]))).toContain("nav-agents");
  });

  it("still renders the same labels for every role", () => {
    for (const role of ROLES) expect(rail([], role)).toContain("Settings");
  });
});

describe("account menu", () => {
  const menu = (role: string) =>
    renderToStaticMarkup(
      createElement(AccountMenu, { initials: "AB", name: "Ada", email: "a@b.co", role, firmName: "F", activeOrgId: "o1", switchableFirms: [] }),
    );

  it.each(ROLES)("has the trigger hook and a plain Show tips again button for %s", (role) => {
    const html = menu(role);
    expect(html).toContain('data-tour="account"');
    const button = /<button type="button"[^>]*>Show tips again<\/button>/.exec(html);
    expect(button).toBeTruthy();
    // Not inside the sign-out form.
    const form = /<form[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
    expect(form).not.toContain("Show tips again");
  });

  it("closes the menu and asks the tour to restart", () => {
    const src = readFileSync("src/components/shell/AccountMenu.tsx", "utf8");
    expect(src).toContain('menu.current?.removeAttribute("open")');
    expect(src).toContain("requestTourAgain(window)");
  });
});

describe("other hooks", () => {
  it("the bell trigger carries data-tour=bell", () => {
    const html = renderToStaticMarkup(createElement(BellPopover, { count: { status: "ok", unread: 0 }, list: { status: "ok", rows: [] } }));
    expect(html).toContain('data-tour="bell"');
  });

  it("the Copilot button carries data-tour=copilot", () => {
    expect(readFileSync("src/components/copilot/CopilotLauncher.tsx", "utf8")).toMatch(/className="cpd-launcher"\s+data-tour="copilot"/);
  });

  it("the show-again helper dispatches on a fake target", () => {
    const dispatchEvent = vi.fn(() => true);
    requestTourAgain({ dispatchEvent });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0] as unknown as [Event])[0].type).toBe(SHOW_TOUR_EVENT);
  });

  it("Today's token is nav-today", () => {
    expect(navTourToken("")).toBe("nav-today");
  });
});
