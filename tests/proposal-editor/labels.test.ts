import { describe, it, expect } from "vitest";
import { firstNameOf, joinOr, statusLabel, statusTone } from "@/lib/proposal-editor/labels";
import { navItemAllowed, navItemBySlug, railGroups, visibleNav } from "@/lib/nav";
import { PROPOSAL_STATUSES } from "@/lib/proposals/types";

describe("status pills", () => {
  it("has a label and a tone for every status", () => {
    for (const s of PROPOSAL_STATUSES) {
      expect(statusLabel(s)).toMatch(/^[A-Z]/);
      expect(["ok", "warn", "risk", "mute"]).toContain(statusTone(s));
    }
    expect(statusTone("sent")).toBe("ok");
    expect(statusTone("approved")).toBe("warn");
    expect(statusTone("withdrawn")).toBe("risk");
    expect(statusTone("what")).toBe("mute");
  });
});

describe("names for sentences", () => {
  it("takes a first name, or the local part of an email", () => {
    expect(firstNameOf("Rebecca Bryant")).toBe("Rebecca");
    expect(firstNameOf("taylor@example.com")).toBe("taylor");
    expect(firstNameOf("  ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
  it("joins with or", () => {
    expect(joinOr([])).toBe("");
    expect(joinOr(["Rebecca"])).toBe("Rebecca");
    expect(joinOr(["Rebecca", "Taylor"])).toBe("Rebecca or Taylor");
    expect(joinOr(["A", "B", "C"])).toBe("A, B or C");
  });
});

describe("the Client proposals rail entry", () => {
  it("exists only for a firm holding the proposals module", () => {
    const item = navItemBySlug("proposals")!;
    expect(item.module).toBe("proposals");
    expect(navItemAllowed(item, [], "owner")).toBe(false);
    expect(navItemAllowed(item, ["mailbox"], "owner")).toBe(false);
    expect(navItemAllowed(item, ["proposals"], "viewer")).toBe(true);
    const labels = (mods: string[]) => railGroups(visibleNav(mods, "owner"), "/dashboard/").flat().map((e) => e.label);
    expect(labels([])).not.toContain("Client proposals");
    expect(labels(["proposals"])).toContain("Client proposals");
  });
  it("is active on the editor and new-proposal pages", () => {
    const groups = railGroups(visibleNav(["proposals"], "owner"), "/dashboard/proposals/new/");
    expect(groups.flat().find((e) => e.label === "Client proposals")?.active).toBe(true);
  });
});
