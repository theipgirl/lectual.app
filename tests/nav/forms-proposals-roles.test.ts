import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import { canSeeFormsAndProposals, FORMS_PROPOSALS_ROLES } from "@/lib/auth/forms-proposals";
import { mobileBarItems, moreSections, railGroups, visibleNav, visibleReports } from "@/lib/nav";
import { hubTracks } from "@/lib/onboarding/hub";
import { tourSteps } from "@/lib/onboarding/tour";
import { drawnNav } from "@/lib/views";
import { buildNeedsYou, type NeedsYouInput } from "@/lib/today/needs-you";
import { intakeReportLinks } from "@/lib/reports/intake";
import { INTAKE_LIST_PATH } from "@/lib/intake/list-href";

const MODULES = ["proposals", "mailbox", "agents", "agent-toolkit", "document-center"];
const SHOWN: Role[] = ["owner", "admin", "senior_admin", "intake"];
const SECTION = /^\/dashboard\/(forms|proposals|quotes)\//;

/** Every href the rail draws (rows and children). */
function railHrefs(role: Role): string[] {
  return railGroups(visibleNav(MODULES, role), "/dashboard/").flatMap((g) => g.flatMap((e) => [e.href, ...e.kids.map((k) => k.href)]));
}

function needsYou(canOpenForms: boolean | undefined, submissions: number) {
  const input: NeedsYouInput = {
    userId: "u1",
    now: new Date("2026-11-20T15:00:00Z"),
    deadlines: [],
    tasks: [],
    queue: { status: "unconfigured" },
    quotes: [],
    payments: [],
    agentFailures: [],
    connections: [],
    submissions: Array.from({ length: submissions }, (_, i) => ({ id: `s${i}`, name: `Person ${i}`, submittedAt: "2026-11-20T10:00:00Z" })),
    hotLeads: [],
    stalled: [],
    ...(canOpenForms === undefined ? {} : { canOpenForms }),
  };
  return buildNeedsYou(input).items.filter((i) => i.kind === "intake-review");
}

describe("the one rule: owner, admin, senior_admin and intake are shown Forms and Proposals", () => {
  it("is exactly those four roles, and fails closed", () => {
    expect([...FORMS_PROPOSALS_ROLES].sort()).toEqual([...SHOWN].sort());
    for (const role of ROLES) expect(canSeeFormsAndProposals(role)).toBe(SHOWN.includes(role));
    for (const bad of [null, undefined, "", "OWNER", "mystery"]) expect(canSeeFormsAndProposals(bad)).toBe(false);
  });

  it.each(ROLES)("%s: rail, phone bar and More sheet", (role) => {
    const shown = SHOWN.includes(role);
    const slugs = visibleNav(MODULES, role).map((i) => i.slug);
    expect(slugs.includes("forms")).toBe(shown);
    expect(slugs.includes("proposals")).toBe(shown);
    // The older quotes entry carries the same name; with the proposals feature it steps aside for everyone.
    expect(slugs.includes("quotes")).toBe(false);
    expect(railHrefs(role).some((h) => SECTION.test(h))).toBe(shown);
    const more = moreSections(visibleNav(MODULES, role), "/dashboard/").flatMap((sec) => sec.items.map((i) => i.slug));
    const bar = mobileBarItems(visibleNav(MODULES, role), "/dashboard/").map((i) => i.slug);
    if (shown) expect(more).toEqual(expect.arrayContaining(["forms", "proposals"]));
    else for (const s of ["forms", "proposals", "quotes"]) expect([...more, ...bar]).not.toContain(s);
  });

  it.each(ROLES)("%s: without the proposals feature the Quotes row follows the same rule", (role) => {
    expect(visibleNav([], role).map((i) => i.slug).includes("quotes")).toBe(SHOWN.includes(role));
  });

  it("an unknown role sees none of them", () => {
    const slugs = visibleNav(MODULES, "mystery" as Role).map((i) => i.slug);
    for (const s of ["forms", "proposals", "quotes"]) expect(slugs).not.toContain(s);
  });

  it.each(ROLES)("%s: Today's Needs you keeps the submissions item; it links to Forms only when shown, else to the Leads list", (role) => {
    const can = canSeeFormsAndProposals(role);
    for (const n of [1, 5]) {
      const items = needsYou(can, n);
      expect(items.length).toBeGreaterThan(0);
      for (const i of items) expect(i.href).toBe(can ? "/dashboard/forms/?tab=performance" : INTAKE_LIST_PATH);
    }
  });

  it("Needs you without the flag (an older caller) never links to Forms", () => {
    for (const i of needsYou(undefined, 2)) expect(i.href).toBe(INTAKE_LIST_PATH);
  });

  it.each(ROLES)("%s: the Intake report's Intake forms and Proposals tiles", (role) => {
    const tiles = intakeReportLinks({ pncCount: 4, proposalsSent: 2, canOpenForms: canSeeFormsAndProposals(role) });
    const labels = tiles.map((t) => t.label);
    expect(labels.includes("Intake forms")).toBe(SHOWN.includes(role));
    expect(tiles.some((t) => SECTION.test(t.href))).toBe(SHOWN.includes(role));
    expect(tiles.length).toBe(SHOWN.includes(role) ? 4 : 2);
  });

  it("no hub flow or tour step points at a hidden row for a role not shown them", () => {
    for (const role of ROLES.filter((r) => !SHOWN.includes(r))) {
      const paths = hubTracks({ role, modules: MODULES, aiConfigured: true, outlookConnectable: true }).flatMap((t) => t.flows.flatMap((f) => f.steps.map((s) => s.path)));
      for (const p of paths) expect(p).not.toMatch(SECTION);
      const steps = tourSteps({ role, navItems: visibleNav(MODULES, role), aiConfigured: true, firmName: "Firm" });
      for (const s of steps) expect(s.target ?? "").not.toMatch(/nav-(forms|proposals|quotes)$/);
    }
  });

  it("the Reports index still offers the Intake report to every staff role (Leads stays visible)", () => {
    expect(visibleReports(visibleNav(MODULES, "paralegal"))).toContain("intake");
  });

  it("the owner view still draws Proposals for the owner", () => {
    expect(drawnNav(visibleNav(MODULES, "owner"), "owner").map((i) => i.slug)).toContain("proposals");
  });
});

describe("every place uses the one predicate", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the rail rows carry the named rule and navItemAllowed applies canSeeFormsAndProposals", () => {
    const nav = read("src/lib/nav.ts");
    for (const slug of ["forms", "quotes", "proposals"]) {
      const line = nav.split("\n").find((l) => l.includes(`{ slug: "${slug}",`))!;
      expect(line, slug).toContain('roleRule: "forms-proposals"');
      expect(line, slug).not.toContain("minRole");
    }
    expect(nav).toContain('item.roleRule === "forms-proposals" && !canSeeFormsAndProposals(role)');
  });

  it("Today, the Intake report page and the Leads page pass canSeeFormsAndProposals(role)", () => {
    expect(read("src/app/dashboard/page.tsx")).toContain("canOpenForms: canSeeFormsAndProposals(session.role)");
    expect(read("src/app/dashboard/reports/[key]/page.tsx")).toContain("canOpenForms: canSeeFormsAndProposals(");
    expect(read("src/app/dashboard/intake/page.tsx")).toContain("showFormsLink={session?.kind === \"ok\" && canSeeFormsAndProposals(session.role)}");
  });

  it("the guarded links sit behind their flags, and no other file lists the roles", () => {
    expect(read("src/lib/today/needs-you.ts")).toMatch(/input\.canOpenForms === true \? "\/dashboard\/forms\/\?tab=performance"/);
    expect(read("src/app/dashboard/intake/_components/IntakeWorkspace.tsx")).toContain('{showFormsLink && <Link href="/dashboard/forms/">Open your intake form</Link>}');
    const offenders: string[] = [];
    for (const f of ["src/lib/nav.ts", "src/lib/today/needs-you.ts", "src/lib/reports/intake.ts", "src/app/dashboard/page.tsx", "src/app/dashboard/intake/page.tsx", "src/app/dashboard/reports/[key]/page.tsx"]) {
      if (/FORMS_PROPOSALS_ROLES|\["owner", "admin", "senior_admin", "intake"\]/.test(read(f))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
