import { describe, it, expect } from "vitest";
import { NAV, navItemAllowed, navItemBySlug, visibleNav } from "@/lib/nav";

describe("rail sections fail closed on modules", () => {
  it("hides every module-gated section from a firm with no modules", () => {
    const shown = visibleNav([], "owner").map((n) => n.slug);
    for (const item of NAV.filter((n) => n.module)) {
      expect(shown).not.toContain(item.slug);
    }
  });

  it("shows a gated section only to a firm holding that module", () => {
    const mail = navItemBySlug("mail")!;
    expect(mail.module).toBe("mailbox");
    expect(navItemAllowed(mail, ["agents"], "owner")).toBe(false);
    expect(navItemAllowed(mail, ["mailbox"], "viewer")).toBe(true);
  });

  it("gates My Mail on `mailbox` and Agents on `agents`", () => {
    expect(navItemBySlug("mail")?.module).toBe("mailbox");
    expect(navItemBySlug("agents")?.module).toBe("agents");
  });

  it("keeps slugs unique so a URL resolves to exactly one section", () => {
    const slugs = NAV.map((n) => n.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
