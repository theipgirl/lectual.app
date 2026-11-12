import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** The files this sprint added (the Letter track's client page, signing and PDF). */
const LOE_LIB = ["canonical", "client-words", "exhibit", "pdf", "pdf-result", "review-limit", "signed-letter", "signing"].map((n) => `src/lib/loe/${n}.ts`);
const LOE_COMPONENTS = [
  "LoeDetailsForm.tsx",
  "LoeExhibitTable.tsx",
  "LoeIncludesLink.tsx",
  "LoeLetterPanel.tsx",
  "LoeReceipt.tsx",
  "LoeSideAction.tsx",
  "LoeSignPanel.tsx",
  "LoeStepBar.tsx",
  "download-pdf.ts",
  "loe-flow.ts",
].map((n) => `src/components/client-proposal/${n}`);
const NEW_FILES = [...LOE_LIB, ...LOE_COMPONENTS, "src/lib/proposals/public-letter.ts", "src/app/p/[token]/actions.ts"];

describe("the engagement-letter client page: hygiene", () => {
  it("no dangerouslySetInnerHTML anywhere in the client page or its route", () => {
    for (const f of [...walk("src/app/p"), ...walk("src/components/client-proposal")]) {
      if (!/\.(tsx?|jsx?)$/.test(f)) continue;
      expect(read(f), f).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("no console call in any new file (nothing the client typed or the letter is ever logged)", () => {
    for (const f of NEW_FILES) expect(read(f), f).not.toMatch(/\bconsole\./);
  });

  it("no admin client and no model code in the letter library, the new components, the PDF module or the page actions", () => {
    for (const f of NEW_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/@\/lib\/db\/admin|getAdminClient|createAdminClient/);
      expect(src, f).not.toMatch(/@\/lib\/ai\b|@anthropic-ai|callClaude|askClaude|openai/i);
    }
    // The page actions reach the database only through the public module.
    const actions = read("src/app/p/[token]/actions.ts");
    expect(actions).not.toMatch(/\.from\(/);
  });

  it("the client words file carries the attorney-approval comment and the two replacement sentences", () => {
    const words = read("src/lib/loe/client-words.ts");
    expect(words).toMatch(/ATTORNEY MUST APPROVE BEFORE USE/);
    expect(words).toMatch(/REPLACEMENT for 4\.7 sentence 1/);
    expect(words).toMatch(/REPLACEMENT for 4\.7 sentence 2/);
  });

  it("the old sentence is not drawn by the letter components, and the labels are the contract's", () => {
    for (const f of LOE_COMPONENTS) expect(read(f), f).not.toMatch(/send your engagement agreement/);
    const words = read("src/lib/loe/client-words.ts");
    expect(words).toContain('"Continue"');
    expect(words).toContain('"Sign and continue to payment"');
    expect(words).toContain('"Pay my legal fee"');
  });

  it("the PDF is built by one builder, there is no docx of the letter and no print view", () => {
    const pdfUsers = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && read(f).includes('from "pdfkit"'));
    expect(pdfUsers).toEqual(["src/lib/loe/pdf.ts"]);
    expect(walk("src/app/p")).toEqual(["src/app/p/[token]/actions.ts", "src/app/p/[token]/layout.tsx", "src/app/p/[token]/not-found.tsx", "src/app/p/[token]/page.tsx"]);
  });

  it("the IP and browser are read as the quote engine reads them", () => {
    const pub = read("src/lib/proposals/public.ts");
    expect(pub).toMatch(/import \{ parseInet \} from "@\/lib\/quotes\/public"/);
    expect(pub).toMatch(/slice\(0, 400\)/);
  });

  it("the review PDF action is anonymous: no session, no scoped client", () => {
    const src = read("src/lib/proposals/public-letter.ts") + read("src/app/p/[token]/actions.ts");
    expect(src).not.toMatch(/getScopedClient|requireSession|resolveSession/);
  });
});
