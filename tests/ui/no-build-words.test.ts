import { describe, expect, it } from "vitest";
import { candidatesOf, walk } from "./_scan";

/**
 * Sprint 31: no build vocabulary on a firm-facing screen. This walks the sources that draw text to a
 * person, drops comments, and fails on a forbidden word in a string literal or JSX text.
 *
 * Scanned: src/app (dashboard, p, i, sign-in, api responses), src/components, and src/lib (every
 * module whose strings reach a screen; the allow-list below names the ones that do not, each with its
 * reason). Identifiers, route paths, data-* tokens and agent ids are never text, so they are not hit.
 */
const RULES: Array<{ name: string; re: RegExp }> = [
  { name: "deployment", re: /deployment/i },
  { name: "environment", re: /\benvironment\b/i },
  { name: "migration", re: /migration/i },
  { name: "migration number", re: /\b0(068|079|082|098|099)\b/ },
  { name: "database update", re: /database update/i },
  { name: "AI key", re: /\bAI (provider )?key\b/i },
  { name: "partner app", re: /partner app/i },
  { name: "administrator", re: /administrator/i },
  { name: "three-state phrasing", re: /not an empty|unknown \(not empty|This is not an empty|reaching the database/i },
  { name: "schema", re: /\bschema\b/i },
  { name: "IP.OS", re: /IP\.OS/ },
  { name: "Stage Keeper", re: /Stage Keeper/ },
  { name: "Triage agent", re: /Triage agent/ },
  { name: "Email intel", re: /Email intel/ },
  { name: "PNC", re: /\bPNC\b/ },
  { name: "Not routed", re: /Not routed/ },
  { name: "Our move", re: /Our move/ },
  { name: "Save this view", re: /Save this view/ },
  { name: "Firm brain", re: /Firm brain/i },
  { name: "module", re: /\bmodules?\b/i },
  { name: "scope", re: /\bscopes?\b/i },
];

const ROOTS = ["src/app", "src/components", "src/lib"];

type Allow = { file: RegExp; rules: string[]; reason: string };

/** Every entry says why the text is not something a firm reads. */
const ALLOW: Allow[] = [
  { file: /^src\/lib\/(documents\/(loe|loe-prefill|opinion-letter|trademark-clearance)|prep-consult\/drafts|consult-proposal\/draft|agents\/matters-chat)\.ts$/, rules: ["scope"], reason: "model prompts and letter text: 'scope' is the legal term (scope of work), not OAuth vocabulary" },
  { file: /^src\/lib\/quotes\/engagement-terms\.ts$/, rules: ["scope"], reason: "legal term in a letter, not OAuth vocabulary" },
  { file: /^src\/app\/dashboard\/documents\/new\//, rules: ["scope"], reason: "legal term in a letter, not OAuth vocabulary (the LOE form's 'Scope' field)" },
  { file: /^src\/lib\/env\.ts$/, rules: ["environment"], reason: "developer error thrown at server start-up, never rendered to a person" },
  { file: /^src\/lib\/(agents\/failure-alert|feedback\/email)\.ts$/, rules: ["deployment"], reason: "internal email to Lectual staff (Resend), never shown to a firm" },
  { file: /^src\/lib\/(lawmatics\/stage-map|reconcile\/milestones)\.ts$/, rules: ["PNC"], reason: "names of stages in the firm's Lawmatics account, matched as data" },
  { file: /^src\/lib\/intake\/(sheet-import|sheet-sections)\.ts$/, rules: ["PNC"], reason: "the firm's own spreadsheet vocabulary (an 'PNC' opener / section name), matched as data" },
  { file: /^src\/lib\/(agents\/prompts|ai)\//, rules: ["schema"], reason: "JSON schema for the model, not text for a person" },
  { file: /^src\/lib\/agents\/(prompt|policy|[a-z-]+\/prompt)/, rules: ["schema", "scope"], reason: "model instructions, not text for a person" },
];

/** A string that is only a comma list of lowercase column names is a database select, not text. */
const COLUMN_LIST = /^[a-z0-9_, *().:!>-]+$/;

export function scanForBuildWords(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    for (const c of candidatesOf(file)) {
      const text = c.text.replace(/\s+/g, " ").trim();
      if (COLUMN_LIST.test(text)) continue;
      for (const rule of RULES) {
        if (!rule.re.test(text)) continue;
        if (ALLOW.some((a) => a.file.test(file) && a.rules.includes(rule.name))) continue;
        hits.push(`${rule.name}\t${file}:${c.line}\t${text.slice(0, 120)}`);
      }
    }
  }
  return hits;
}

describe("no build vocabulary in what a firm reads", () => {
  const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !f.endsWith(".d.ts"));

  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(400);
  });

  it("finds none of the forbidden words in strings or JSX text", () => {
    const hits = scanForBuildWords(files);
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("every allow-list entry still matches a file (a stale entry is deleted, not kept)", () => {
    for (const a of ALLOW) {
      if (a.file.source.includes("agents\\/prompts") || a.file.source.includes("agents\\/(prompt")) continue;
      expect(files.some((f) => a.file.test(f)), a.reason).toBe(true);
    }
  });

  it("the rules catch what they should (shown on the pre-sprint strings)", () => {
    const old = [
      "This is a problem reaching the database, not an empty list.",
      "The AI key isn't set on this deployment, so agents won't run until an administrator adds it.",
      "Not available until the database update (lectual migration 0098).",
      "IP.OS",
      "Stage Keeper",
      "Firm brain",
      "Save this view",
      "Not routed",
      "Our move",
      "PNC",
      "Modules",
      "scope missing",
    ];
    for (const text of old) expect(RULES.some((r) => r.re.test(text)), text).toBe(true);
  });
});
