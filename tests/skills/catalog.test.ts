import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import {
  CLIENT_UPDATES_ANCHOR,
  COWORK_SKILLS,
  DRAFTS_ONLY,
  PREP_CONSULT_ANCHOR,
  SKILLS,
  SKILL_RUN_ROLES,
  canRunSkills,
  skillAvailable,
  skillBySlug,
} from "@/lib/skills/catalog";

const root = path.resolve(__dirname, "../..");
// Words that mean unfinished copy, spelled in pieces so this file does not trip its own search.
const UNFINISHED = new RegExp(["coming " + "soon", "to" + "do", "lor" + "em", "place" + "holder"].join("|"), "i");
const ID = "3f1c2b9e-7a44-4d0e-9c1b-0a6e5d2f8b17";
const hrefFor = (slug: string, kind: "lead" | "matter") => skillBySlug(slug)!.href(kind, ID);

describe("the catalog", () => {
  it("has the seven skills, in order", () => {
    expect(SKILLS.map((s) => s.name)).toEqual([
      "Prep a consult",
      "Draft the engagement letter",
      "Welcome a client",
      "Filing follow-up",
      "Opinion letter",
      "Trademark clearance",
      "Meeting follow-up",
    ]);
    expect(new Set(SKILLS.map((s) => s.slug)).size).toBe(7);
  });

  it("gives every skill something to say about what it does and reads, and no placeholder text", () => {
    for (const s of SKILLS) {
      expect(s.does.length, s.slug).toBeGreaterThan(40);
      expect(s.reads.length, s.slug).toBeGreaterThan(10);
      expect(s.lands.length, s.slug).toBeGreaterThan(5);
      expect(`${s.does} ${s.reads}`).not.toMatch(UNFINISHED);
    }
    expect(DRAFTS_ONLY).toBe("Drafts only, attorney reviews");
  });

  it("lists the nine Claude-only skills, one line each", () => {
    expect(COWORK_SKILLS.map((s) => s.name)).toEqual([
      "Start my day",
      "End my day",
      "Triage the pipeline",
      "Monday review",
      "Weekly wrap",
      "Process a consult",
      "Wrap a consult",
      "Show my dashboard",
      "Manage the pipeline",
    ]);
    for (const s of COWORK_SKILLS) expect(s.line).not.toContain("\n");
  });

  it("keeps the in-app and Claude-only lists apart", () => {
    const inApp = new Set(SKILLS.map((s) => s.name.toLowerCase()));
    for (const s of COWORK_SKILLS) expect(inApp.has(s.name.toLowerCase())).toBe(false);
  });
});

describe("deep-link targets, built with a UUID, are exactly the existing places", () => {
  it.each([
    ["prep-consult", "lead", `/dashboard/leads/${ID}/#prep-consult`],
    ["engagement-letter", "matter", `/dashboard/documents/new/${ID}/loe/`],
    ["welcome-client", "matter", `/dashboard/matters/${ID}/#client-updates`],
    ["filing-follow-up", "matter", `/dashboard/matters/${ID}/#client-updates`],
    ["opinion-letter", "matter", `/dashboard/documents/new/${ID}/opinion-letter/`],
    ["trademark-clearance", "matter", `/dashboard/documents/new/${ID}/trademark-clearance/`],
    ["meeting-follow-up", "lead", `/dashboard/leads/${ID}/`],
    ["meeting-follow-up", "matter", `/dashboard/matters/${ID}/`],
  ] as const)("%s on a %s", (slug, kind, expected) => {
    expect(hrefFor(slug, kind)).toBe(expected);
  });

  it("puts nothing but the record's id in the path", () => {
    const evil = skillBySlug("engagement-letter")!.href("matter", "../../x?y=1#z");
    expect(evil).not.toContain("../");
    expect(evil).not.toContain("?");
    expect(evil.startsWith("/dashboard/documents/new/")).toBe(true);
  });

  it("every link lands on a route that exists", () => {
    const pageFor = (href: string) => {
      const p = href.split("#")[0].replace(ID, "[id]");
      const segments = p.split("/").filter(Boolean);
      // /dashboard/documents/new/<matter>/<form>/ lives under the [matterId] folder.
      const folder = segments.map((seg) => (seg === "[id]" ? (segments[1] === "documents" ? "[matterId]" : "[id]") : seg));
      return path.join(root, "src/app", ...folder, "page.tsx");
    };
    for (const s of SKILLS) {
      for (const kind of s.picks) {
        const file = pageFor(s.href(kind, ID));
        expect(existsSync(file), `${s.slug} (${kind}) -> ${path.relative(root, file)}`).toBe(true);
      }
      if (s.extra) expect(existsSync(path.join(root, "src/app", ...s.extra.href.split("/").filter(Boolean), "page.tsx")), s.extra.href).toBe(true);
    }
  });

  it("the anchors exist exactly once, on the lead page and the matter page", () => {
    const lead = readFileSync(path.join(root, "src/app/dashboard/leads/[id]/page.tsx"), "utf8");
    const matter = readFileSync(path.join(root, "src/app/dashboard/matters/[id]/page.tsx"), "utf8");
    const count = (src: string, id: string) => src.split(`id="${id}"`).length - 1;
    expect(count(lead, PREP_CONSULT_ANCHOR)).toBe(1);
    expect(count(matter, CLIENT_UPDATES_ANCHOR)).toBe(1);
    expect(PREP_CONSULT_ANCHOR).toBe("prep-consult");
    expect(CLIENT_UPDATES_ANCHOR).toBe("client-updates");
  });

  it("the anchor on the lead page is on the Prep this consult panel, and on the matter page on Client updates", () => {
    const lead = readFileSync(path.join(root, "src/app/dashboard/leads/[id]/page.tsx"), "utf8");
    const matter = readFileSync(path.join(root, "src/app/dashboard/matters/[id]/page.tsx"), "utf8");
    expect(lead).toMatch(/<details id="prep-consult"[^>]*>\s*<summary>Prep this consult<\/summary>/);
    expect(matter).toMatch(/<section id="client-updates"[^>]*>\s*<h2[^>]*>\s*Client updates/);
  });
});

describe("which firm and which role", () => {
  it("each skill needs the module its destination needs", () => {
    const need = Object.fromEntries(SKILLS.map((s) => [s.slug, s.module]));
    expect(need).toEqual({
      "prep-consult": "agent-toolkit",
      "engagement-letter": "document-center",
      "welcome-client": "agent-toolkit",
      "filing-follow-up": "agent-toolkit",
      "opinion-letter": "document-center",
      "trademark-clearance": "document-center",
      "meeting-follow-up": "agents",
    });
  });

  it("skillAvailable follows the firm's modules", () => {
    const letters = skillBySlug("opinion-letter")!;
    const meetings = skillBySlug("meeting-follow-up")!;
    expect(skillAvailable(letters, ["agent-toolkit"])).toBe(false);
    expect(skillAvailable(letters, ["agent-toolkit", "document-center"])).toBe(true);
    expect(skillAvailable(meetings, ["agent-toolkit"])).toBe(false);
    expect(skillAvailable(meetings, ["agent-toolkit", "agents"])).toBe(true);
    expect(skillAvailable(skillBySlug("prep-consult")!, ["agent-toolkit"])).toBe(true);
  });

  it("the run roles are the lead and matter write roles, and nobody else", () => {
    expect([...SKILL_RUN_ROLES].sort()).toEqual([...CAN_WRITE_LEAD].sort());
    expect([...SKILL_RUN_ROLES].sort()).toEqual([...MATTER_WRITE_ROLES].sort());
    expect(canRunSkills("viewer")).toBe(false);
    expect(canRunSkills("social_media")).toBe(false);
    expect(canRunSkills(null)).toBe(false);
    expect(canRunSkills("attorney")).toBe(true);
  });
});
