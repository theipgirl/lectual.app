import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Sprint 6 hygiene: greps over the files this sprint added. Comments are stripped, so a rule written in prose never trips a rule. */

const NEW_FILES = [
  "src/lib/loe/editor-state.ts",
  "src/lib/loe/signature-read.ts",
  "src/lib/loe/signed-card.ts",
  "src/lib/loe/signed-pdf.ts",
  "src/lib/loe/staff-download.ts",
  "src/lib/loe/staff-firm.ts",
  "src/lib/proposals/loe-signed-upload.ts",
  "src/lib/proposals/signed-state.ts",
  "src/components/proposal-editor/EngagementLetterSlot.tsx",
  "src/components/proposal-editor/LetterSwitch.tsx",
  "src/components/proposal-editor/EngagementLetterCard.tsx",
  "src/app/dashboard/proposals/[id]/signed-letter-actions.ts",
];

function code(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

describe("the new files exist", () => {
  it.each(NEW_FILES)("%s", (f) => expect(existsSync(f)).toBe(true));
});

describe("no markup injection, no logging, no model, no send", () => {
  it.each(NEW_FILES)("%s", (f) => {
    const src = code(f);
    expect(src, "dangerouslySetInnerHTML").not.toMatch(/dangerouslySetInnerHTML/);
    expect(src, "console").not.toMatch(/console\./);
    expect(src, "a model module").not.toMatch(/@\/lib\/ai\b|anthropic|callClaude|askClaude/i);
    expect(src, "a send, mail or queue write").not.toMatch(/sendInternalMail|queue_draft|createDraft|createMailboxDraft|\bsendMail\b|@\/lib\/queue\/api|@\/lib\/mail\//);
    expect(src, "a network call that is not the Lawmatics files helper").not.toMatch(/\bfetch\s*\(/);
  });
});

describe("database access: scoped client only, except the existing public acceptance follow-ups", () => {
  it.each(NEW_FILES)("%s imports no admin or service-role client", (f) => {
    expect(code(f)).not.toMatch(/db\/admin|getAdminClient|service[_-]?role/i);
  });

  it("the staff action, the card and the firm facts use the scoped client only", () => {
    expect(code("src/lib/loe/staff-firm.ts")).toContain("getScopedClient");
    expect(code("src/app/dashboard/proposals/[id]/signed-letter-actions.ts")).not.toMatch(/admin|service/i);
    expect(code("src/components/proposal-editor/EngagementLetterCard.tsx")).not.toMatch(/db\/|supabase/i);
  });

  it("accept-followups still imports no admin client (the public path hands its client in)", () => {
    expect(code("src/lib/proposals/accept-followups.ts")).not.toMatch(/db\/admin|getAdminClient/);
  });
});

describe("the Lawmatics token is the firm's own", () => {
  it("the signed upload core and both wirings read no environment token", () => {
    for (const f of ["src/lib/proposals/loe-signed-upload.ts", "src/lib/loe/signed-pdf.ts", "src/lib/loe/staff-download.ts"]) {
      expect(code(f), f).not.toMatch(/process\.env|LAWMATICS_TOKEN|env\./);
    }
    const followups = code("src/lib/proposals/accept-followups.ts");
    expect(followups).not.toMatch(/process\.env|LAWMATICS_TOKEN/);
    expect(followups).toMatch(/firmToken\(d as never, orgId\)/);
  });
});

describe("one PDF writer, no docx of the letter", () => {
  it("only pdf.ts imports pdfkit, and nothing in src/lib/loe imports the docx builder or a docx library", () => {
    const dir = "src/lib/loe";
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
    for (const f of files) {
      const src = code(join(dir, f));
      expect(src, f).not.toMatch(/accepted-proposal-docx|from "docx"|from 'docx'|\bdocx\b/i);
      if (f !== "pdf.ts") expect(src, f).not.toMatch(/pdfkit|pdf-lib|jspdf/i);
    }
    expect(code("src/lib/proposals/loe-signed-upload.ts")).not.toMatch(/docx/i);
    expect(code("src/lib/loe/signed-pdf.ts")).toContain("buildLetterPdf");
    expect(code("src/lib/loe/signed-pdf.ts")).toContain('mode: "signed"');
  });
});

describe("words come from the glossary, and no placeholder text", () => {
  it("the new components and rules import their sentences from words.ts / vocabulary.ts and carry no placeholder text", () => {
    for (const f of ["src/components/proposal-editor/EngagementLetterSlot.tsx", "src/components/proposal-editor/LetterSwitch.tsx", "src/components/proposal-editor/EngagementLetterCard.tsx", "src/lib/loe/signed-card.ts"]) {
      const raw = readFileSync(f, "utf8");
      expect(raw, f).toMatch(/@\/lib\/ui\/words/);
      expect(raw, f).not.toMatch(/TODO|FIXME|Coming soon|Lorem/i);
    }
    expect(code("src/lib/proposal-editor/create-link.ts")).toMatch(/LETTER_CHANGED_SENTENCE/);
  });
});

describe("what a step event may carry", () => {
  it("the signed upload's reasons are fixed sentences (STEP_TEXT), a status, or two fixed fallbacks; never letter text, an address or bytes", () => {
    const core = code("src/lib/proposals/loe-signed-upload.ts");
    const reasons = [...core.matchAll(/reason:\s*([^,}\n]+)/g)].map((m) => m[1].trim())
      .filter((r) => r !== "string");
    expect(reasons.length).toBeGreaterThan(3);
    for (const r of reasons) expect(r, r).toMatch(/^(STEP_TEXT\.\w+|sent\.reason|target\.reason|"unexpected error")$/);
    expect(core).not.toMatch(/agreement_text|\.bytes\b.*reason|details\./);
  });

  it("the staff download returns fixed sentences, never an error's text", () => {
    const src = code("src/lib/loe/staff-download.ts");
    expect(src).not.toMatch(/\.message\b(?!\s*:)/);
    expect(src).not.toMatch(/catch\s*\((\w+)\)/);
  });
});
