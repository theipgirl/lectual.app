import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as W from "@/lib/ui/words";
import { NAV, RAIL_TREE, REPORTS, navItemBySlug, railGroups, visibleNav } from "@/lib/nav";
import { ROOT, stripAndCollect, walk } from "./_scan";

describe("the glossary (src/lib/ui/words.ts)", () => {
  it("holds each decided name", () => {
    expect(W.COPILOT_NAME).toBe("Copilot");
    expect(W.ASSISTANTS_NAME).toBe("Assistants");
    expect(W.SHORTCUTS_NAME).toBe("Shortcuts");
    expect(W.FIRM_NOTES_NAME).toBe("Firm notes");
    expect(W.AI_TOOLS_GROUP).toBe("AI tools");
    expect(W.APPROVALS_NAME).toBe("Approvals");
    expect(W.LEADS_NAME).toBe("Leads");
    expect(W.OUR_TURN).toBe("Our turn");
    expect(W.TEMPERATURE_NAME).toBe("Temperature");
    expect(W.NOT_RATED).toBe("Not rated");
    expect(W.MOVED_AUTOMATICALLY).toBe("Moved automatically");
    expect(W.COPY_VIEW_LINK).toBe("Copy link to this view");
    expect(W.COPIED).toBe("Copied");
    expect(W.FROM_THEIR_EMAILS).toBe("From their emails");
    expect(W.AUTOMATIC_STAGE_MOVES).toBe("Automatic stage moves");
    expect(W.FIRST_READ).toBe("First read of this lead");
    expect(W.ASSISTANTS_PAUSED).toBe("Assistants paused");
    expect(W.FEATURES_NAME).toBe("Features");
    expect(W.TEMPERATURE_TOOLTIP).toBe("Hot, warm or cold: the level you set, or the system's suggestion if you haven't set one.");
    expect(W.PIPELINE_VIEW_ONLY).toBe("This is a view-only overview. To move a lead, open it in Leads.");
  });

  it("notReadyYet is the plain 'isn't switched on' sentence, with no build words or digits", () => {
    const sentences = [W.notReadyYet("X"), W.notReadyYet(), W.NOT_SWITCHED_ON, W.notReadyPlural("Results")];
    expect(W.notReadyYet("X")).toBe("X isn't switched on for your firm yet. Lectual will turn it on.");
    expect(W.NOT_SWITCHED_ON).toBe("This isn't switched on for your firm yet. Lectual will turn it on.");
    for (const s of sentences) {
      expect(s).not.toMatch(/\d/);
      expect(s).not.toMatch(/database|migration|deployment|environment|administrator/i);
    }
  });

  it("the sign-in, feedback and failed-read sentences are the ones the spec wrote", () => {
    expect(W.FEEDBACK_DISCLOSURE).toBe("We'll include your note and a list of the pages you visited and any errors, to help us fix it. We don't include client information.");
    expect(W.SIGN_IN_EXPIRED).toBe("That sign-in link has expired or was already used. Enter your email to get a new one.");
    expect(W.SIGN_IN_GENERIC).toBe("We couldn't send the link. Check the address and try again.");
    expect(W.CANT_SHOW).toBe("Can't show this right now. Refresh to try again.");
    expect(W.LEADS_LOAD_FAILED_BODY).toBe("Can't show your leads right now. Refresh to try again.");
    expect(W.NO_LEAD_STAGES).toBe("Your lead stages haven't been set up yet. An owner or admin can add them in Settings.");
    expect(W.LAWPAY_NOT_ISSUED).toBe("LawPay card payments aren't switched on yet. Until then, record payments by hand on each quote.");
  });
});

describe("the rail is built from the glossary", () => {
  const labelsOf = (modules: string[]) =>
    railGroups(visibleNav(modules, "owner"), "/dashboard/").flat().flatMap((e) => [e.label, ...e.kids.map((k) => k.label)]);

  it("shows Approvals, Leads, Assistants, Shortcuts, Firm notes and the AI tools group", () => {
    const shown = labelsOf(["mailbox", "agents", "agent-toolkit"]);
    for (const label of [W.APPROVALS_NAME, W.LEADS_NAME, W.ASSISTANTS_NAME, W.SHORTCUTS_NAME, W.FIRM_NOTES_NAME, W.AI_TOOLS_GROUP, W.COPILOT_NAME]) expect(shown).toContain(label);
    for (const old of ["Queue", "PNC", "IP.OS", "Agents", "Skills", "Firm brain", "AI copilot", "Intake"]) expect(shown, old).not.toContain(old);
  });

  it("keeps every route and slug where it was", () => {
    expect(navItemBySlug("queue")?.href).toBe("/dashboard/queue/");
    expect(navItemBySlug("intake")?.href).toBe("/dashboard/intake/");
    expect(navItemBySlug("agents")?.href).toBe("/dashboard/agents/");
    expect(navItemBySlug("skills")?.href).toBe("/dashboard/skills/");
    expect(navItemBySlug("brain")?.href).toBe("/dashboard/brain/");
    expect(RAIL_TREE.flat().some((n) => "label" in n && n.label === W.AI_TOOLS_GROUP)).toBe(true);
    expect(REPORTS.ipos.label).toBe(W.AI_TOOLS_GROUP);
    expect(NAV.find((n) => n.slug === "intake")?.label).toBe(W.LEADS_NAME);
  });
});

describe("one place for each name", () => {
  const files = [...walk("src/app"), ...walk("src/components"), ...walk("src/lib")].filter((f) => f !== "src/lib/ui/words.ts");
  // Names that are also ordinary words are only held to it when the whole literal is the name.
  const EXACT = [W.MOVED_AUTOMATICALLY, W.NOT_RATED, W.COPY_VIEW_LINK, W.OUR_TURN, W.FROM_THEIR_EMAILS, W.AUTOMATIC_STAGE_MOVES, W.FIRST_READ, W.ASSISTANTS_PAUSED, W.AI_TOOLS_GROUP, W.FIRM_NOTES_NAME, W.SHORTCUTS_NAME, W.FEATURES_NAME];

  it("no second whole-string copy of a glossary name outside words.ts", () => {
    const hits: string[] = [];
    for (const file of files) {
      const { strings } = stripAndCollect(readFileSync(path.join(ROOT, file), "utf8"));
      for (const s of strings) if (EXACT.includes(s.text.trim())) hits.push(`${file}:${s.line}\t${s.text}`);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
