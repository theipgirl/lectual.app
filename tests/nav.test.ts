import { describe, it, expect } from "vitest";
import { NAV, RAIL_TREE, navItemAllowed, navItemBySlug, railGroups, visibleNav } from "@/lib/nav";

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

describe("rail tree (design/Rail.dc.html)", () => {
  const labels = (groups: ReturnType<typeof railGroups>) => groups.flat().flatMap((e) => [e.label, ...e.kids.map((k) => k.label)]);

  it("only names real sections", () => {
    for (const group of RAIL_TREE) {
      for (const node of group) {
        const slugs = "slug" in node ? [node.slug] : node.kids;
        for (const slug of slugs) expect(navItemBySlug(slug), slug).toBeDefined();
      }
    }
  });

  it("drops module-gated children for a firm without the module", () => {
    const shown = labels(railGroups(visibleNav([], "owner"), "/dashboard/"));
    expect(shown).not.toContain("My Mail");
    expect(shown).not.toContain("Assistants");
    expect(shown).toContain("Approvals");
    const withAll = labels(railGroups(visibleNav(["mailbox", "agents"], "owner"), "/dashboard/"));
    expect(withAll).toContain("My Mail");
    expect(withAll).toContain("Assistants");
  });

  it("opens the parent of the current page, and a lead's page belongs to Leads", () => {
    const groups = railGroups(visibleNav([], "owner"), "/dashboard/leads/abc/");
    const intake = groups.flat().find((e) => e.label === "Leads")!;
    expect(intake.childActive).toBe(true);
    expect(intake.kids.find((k) => k.label === "Leads")?.active).toBe(true);
    expect(intake.active).toBe(false);
    expect(intake.href).toBe("/dashboard/reports/intake/");
  });

  it("marks Today active only on the home page", () => {
    const today = (path: string) => railGroups(visibleNav([], "owner"), path).flat().find((e) => e.label === "Today")!.active;
    expect(today("/dashboard/")).toBe(true);
    expect(today("/dashboard/matters/")).toBe(false);
  });

  it("opens each parent's report view, and there is no Reports section", () => {
    const groups = railGroups(visibleNav(["mailbox", "agents"], "owner"), "/dashboard/reports/matters/");
    const matters = groups.flat().find((e) => e.label === "Active matters")!;
    expect(matters.active).toBe(true);
    expect(groups.flat().map((e) => e.label)).not.toContain("Reports");
    expect(navItemBySlug("reports")).toBeUndefined();
    for (const e of groups.flat().filter((x) => x.kids.length)) expect(e.href).toMatch(/^\/dashboard\/reports\/[a-z]+\/$/);
  });
});

describe("unbuilt sections are hidden (built: false)", () => {
  const UNBUILT = ["sms", "portals"];
  const everything = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit", "litigation"];
  const railSlugs = (groups: ReturnType<typeof railGroups>) => groups.flat().flatMap((e) => [e.key, ...e.kids.map((k) => k.key)]);
  const railLabels = (groups: ReturnType<typeof railGroups>) => groups.flat().flatMap((e) => [e.label, ...e.kids.map((k) => k.label)]);

  it("flags exactly SMS and Client portals (Skills is built, Sprint 18)", () => {
    expect(NAV.filter((n) => n.built === false).map((n) => n.slug)).toEqual(UNBUILT);
  });

  it("visibleNav never returns them, whatever modules the firm holds", () => {
    const shown = visibleNav(everything, "owner").map((n) => n.slug);
    for (const slug of UNBUILT) expect(shown).not.toContain(slug);
    expect(shown).toContain("agents");
  });

  it("navItemAllowed refuses them for every role", () => {
    for (const slug of UNBUILT) {
      for (const role of ["owner", "viewer"] as const) expect(navItemAllowed(navItemBySlug(slug)!, everything, role)).toBe(false);
    }
  });

  it("the rail drops them, for filtered input and for the full NAV", () => {
    for (const input of [visibleNav(everything, "owner"), NAV]) {
      const groups = railGroups(input, "/dashboard/");
      for (const slug of UNBUILT) expect(railSlugs(groups)).not.toContain(slug);
      const labels = railLabels(groups);
      for (const label of ["SMS", "Client portals"]) expect(labels).not.toContain(label);
    }
  });

  it("keeps the parents and their other children", () => {
    const groups = railGroups(visibleNav(everything, "owner"), "/dashboard/");
    const find = (label: string) => groups.flat().find((e) => e.label === label)!;
    expect(find("Communication").kids.map((k) => k.key)).toEqual(["mail", "meetings", "queue", "campaigns"]);
    expect(find("Active matters").kids.map((k) => k.key)).toEqual(["matters", "pipeline", "documents"]);
    expect(find("AI tools").kids.map((k) => k.key)).toEqual(["copilot", "agents", "skills", "brain"]);
  });

  it("every unbuilt section is still listed in NAV so its URL stays a known 404", () => {
    for (const slug of UNBUILT) expect(navItemBySlug(slug)).toBeDefined();
  });
});

describe("the Skills section (Sprint 18)", () => {
  const rail = (modules: string[]) => railGroups(visibleNav(modules, "owner"), "/dashboard/");
  const iposKids = (modules: string[]) => rail(modules).flat().find((e) => e.label === "AI tools")!.kids.map((k) => k.key);

  it("is gated on agent-toolkit and is a built section", () => {
    const skills = navItemBySlug("skills")!;
    expect(skills.module).toBe("agent-toolkit");
    expect(skills.built).toBeUndefined();
    expect(skills.href).toBe("/dashboard/skills/");
  });

  it("is allowed for a firm with agent-toolkit and refused without it", () => {
    const skills = navItemBySlug("skills")!;
    expect(navItemAllowed(skills, ["agent-toolkit"], "owner")).toBe(true);
    expect(navItemAllowed(skills, ["agents", "mailbox", "document-center"], "owner")).toBe(false);
    expect(navItemAllowed(skills, [], "owner")).toBe(false);
  });

  it("appears under AI tools in the rail for a firm with agent-toolkit, and not for one without", () => {
    expect(iposKids(["agent-toolkit"])).toContain("skills");
    expect(iposKids(["agent-toolkit", "agents"])).toEqual(["copilot", "agents", "skills", "brain"]);
    expect(iposKids(["agents"])).not.toContain("skills");
    expect(iposKids([])).not.toContain("skills");
  });
});

describe("one proposals surface (Sprint 3)", () => {
  const rail = (modules: string[]) =>
    railGroups(visibleNav(modules, "owner"), "/dashboard/")
      .flat()
      .flatMap((e) => [e.key, ...e.kids.map((k) => k.key)]);

  it("hides the quotes entry whenever proposals is visible", () => {
    const modules = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit", "litigation"];
    expect(visibleNav(modules, "owner").map((n) => n.slug)).not.toContain("quotes");
    const keys = rail(modules);
    expect(keys).not.toContain("quotes");
    expect(keys).toContain("proposals");
  });

  it("keeps quotes for a firm without the proposals module, and proposals out of its rail", () => {
    const keys = rail(["mailbox", "agents"]);
    expect(keys).toContain("quotes");
    expect(keys).not.toContain("proposals");
    expect(visibleNav([], "owner").map((n) => n.slug)).toContain("quotes");
  });
});
