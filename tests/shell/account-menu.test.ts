import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES, ROLE_LABEL, roleLabel } from "@/lib/auth/roles";
import { isOutsidePress, menuKeyAction } from "@/lib/shell/menu-behaviour";

vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));

import { AccountMenu } from "@/components/shell/AccountMenu";

const menu = (role: string, firms = 1) =>
  renderToStaticMarkup(
    createElement(AccountMenu, {
      initials: "AB",
      name: "Ada",
      email: "a@b.co",
      role,
      firmName: "Firm",
      activeOrgId: "o1",
      switchableFirms: Array.from({ length: firms }, (_, i) => ({ id: `o${i + 1}`, name: `Firm ${i + 1}` })) as never,
    }),
  );

describe("close decisions (F12)", () => {
  it("Escape closes an open menu and nothing else does", () => {
    expect(menuKeyAction("Escape", true)).toBe("close");
    expect(menuKeyAction("Escape", false)).toBeNull();
    expect(menuKeyAction("Tab", true)).toBeNull();
    expect(menuKeyAction("a", true)).toBeNull();
  });

  it("a press outside the container closes; a press inside does not", () => {
    const inside = {};
    const container = { contains: (n: unknown) => n === inside };
    expect(isOutsidePress(container, inside)).toBe(false);
    expect(isOutsidePress(container, {})).toBe(true);
    expect(isOutsidePress(container, null)).toBe(true);
    expect(isOutsidePress(null, {})).toBe(false);
  });

  it("the menu wires both listeners and returns focus to the avatar on Escape", () => {
    const src = readFileSync("src/components/shell/AccountMenu.tsx", "utf8");
    expect(src).toContain('document.addEventListener("keydown", onKey)');
    expect(src).toContain('document.addEventListener("pointerdown", onPress)');
    expect(src).toMatch(/closeMenu\(\);\s*avatar\(\)\?\.focus\(\);/);
    expect(src).toContain("onToggle=");
  });
});

describe("markup (F12)", () => {
  it("is a menu of separate items, with Sign out its own item", () => {
    const html = menu("owner");
    expect(html).toContain('role="menu"');
    const items = [...html.matchAll(/role="menuitem"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(items).toEqual(["Your name", "Getting started", "Show tips again", "Send feedback", "Sign out"]);
    expect(html.match(/<form[^>]*>/g)).toHaveLength(1);
  });

  it("groups Getting started, Show tips again and Send feedback under one Help and tips heading", () => {
    const html = menu("owner");
    const start = html.indexOf('<div role="group" aria-labelledby="lx-help-h"');
    const group = html.slice(start, html.indexOf("<form", start));
    expect(start).toBeGreaterThan(-1);
    expect(group).toContain("Help and tips");
    for (const t of ["Getting started", "Show tips again", "Send feedback"]) expect(group).toContain(t);
    expect(group).not.toContain("Sign out");
    expect(group).not.toContain("Your name");
  });

  it("Switch firm shows for staff with several firms and keeps its form", () => {
    expect(menu("owner", 2)).toContain("Switch firm");
    expect(menu("owner", 1)).not.toContain("Switch firm");
  });

  it.each(ROLES)("prints %s through ROLE_LABEL, never the stored value", (role) => {
    const html = menu(role);
    expect(html).toContain(`title="Ada · ${ROLE_LABEL[role]}"`);
    expect(html).toContain(`Firm · ${ROLE_LABEL[role]}`);
    if (role.includes("_")) expect(html).not.toContain(role.replace("_", " "));
  });

  it("human names", () => {
    expect(roleLabel("senior_admin")).toBe("Senior admin");
    expect(roleLabel("law_clerk")).toBe("Law clerk");
    expect(roleLabel("social_media")).toBe("Social media");
    expect(roleLabel("some_new_role")).toBe("some new role");
  });

  it("no source prints a role with a replace of the underscore", () => {
    for (const f of ["src/components/shell/AccountMenu.tsx", "src/components/proposal-editor/SettingsForm.tsx", "src/components/leads/ConsultDetailsSection.tsx", "src/components/proposal-editor/ConsultStrip.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/role\.replace|reviewed_by_role\.replaceAll/);
    }
  });
});
