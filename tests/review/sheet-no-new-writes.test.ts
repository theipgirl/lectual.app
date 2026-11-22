import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
/** Source without comments, so a comment that explains a ban doesn't trip it. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CLIENT_AND_NEW = [
  "src/components/review/ColumnChooser.tsx",
  "src/components/review/use-column-prefs.ts",
  "src/components/review/SheetViewTable.tsx",
  "src/components/review/SheetFactTd.tsx",
  "src/components/review/SectionNote.tsx",
  "src/lib/review/sheet-columns.ts",
  "src/lib/review/column-prefs-storage.ts",
  "src/lib/review/sheet-cells.ts",
  "src/lib/review/fees-cells.ts",
  "src/lib/review/fees-load.ts",
  // Sprint 2: the custom-columns read side and the card's Firm columns block
  "src/lib/custom-columns/rules.ts",
  "src/components/review/ReviewCardExtras.tsx",
];

describe("no new write path", () => {
  for (const f of CLIENT_AND_NEW) {
    it(`${f}: no "use server", no form, no action=, no fetch(, no import from an actions module, the admin client or the scoped client`, () => {
      const src = code(f);
      expect(src).not.toMatch(/["']use server["']/);
      expect(src).not.toMatch(/<form\b/);
      expect(src).not.toMatch(/\baction=/);
      expect(src).not.toMatch(/\bfetch\(/);
      expect(src).not.toMatch(/from ["'][^"']*\/actions["']/);
      expect(src).not.toMatch(/from ["'][^"']*card-actions["']/);
      expect(src).not.toMatch(/@\/lib\/db\/admin/);
      expect(src).not.toMatch(/@\/lib\/db\/scoped-client/);
      expect(src).not.toMatch(/\.(insert|upsert)\(/);
      // the only file that may read a table is the fee reads (SELECT only)
      if (!f.endsWith("fees-load.ts")) expect(src).not.toMatch(/\.from\(["'`]/);
      else expect(src).not.toMatch(/\.(update|delete|rpc)\(/);
    });
  }

  it("sheet-columns.ts is pure: no React, no server-only module, no next/*, no @/lib/db", () => {
    const src = code("src/lib/review/sheet-columns.ts");
    expect(src).not.toMatch(/from ["']react/);
    expect(src).not.toMatch(/server-only/);
    expect(src).not.toMatch(/from ["']next\//);
    expect(src).not.toMatch(/@\/lib\/db/);
    // it imports only the words and itself
    const imports = [...src.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/ui/words"]);
  });

  it("the sheet-cells and fees-cells modules are pure too (no React, no server-only)", () => {
    for (const f of ["src/lib/review/sheet-cells.ts", "src/lib/review/fees-cells.ts", "src/lib/review/column-prefs-storage.ts"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/from ["']react/);
      expect(src, f).not.toMatch(/server-only/);
    }
  });

  it("nothing new under src/app/dashboard/review: the same three files, and the page posts no form and calls no action", () => {
    expect(readdirSync(path.resolve(__dirname, "../../src/app/dashboard/review")).sort()).toEqual(["actions.ts", "card-actions.ts", "page.tsx"]);
    const page = code("src/app/dashboard/review/page.tsx");
    expect(page).not.toMatch(/<form\b/);
    expect(page).not.toMatch(/\baction=/);
    expect(page).not.toMatch(/from ["'][^"']*\/(card-)?actions["']/);
  });
});

describe("the fee reads never create or import a client (R2-1)", () => {
  for (const f of ["src/lib/review/fees-load.ts", "src/lib/review/load.ts", "src/lib/review/build.ts"]) {
    it(`${f}: no @/lib/db/admin import, no getAdminClient, no SUPABASE_SERVICE_ROLE_KEY`, () => {
      const src = code(f);
      expect(src).not.toMatch(/@\/lib\/db\/admin/);
      expect(src).not.toMatch(/getAdminClient/);
      expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    });
  }
  it("fees-load.ts imports nothing from @/lib/db/* (not even the scoped client) and takes the client as a parameter", () => {
    const src = code("src/lib/review/fees-load.ts");
    expect(src).not.toMatch(/@\/lib\/db\//);
    expect(src).not.toMatch(/getScopedClient|createClient/);
    expect(src).toMatch(/export async function readAcceptedProposalFees\(db: unknown,/);
    expect(src).toMatch(/export async function readTrackerFees\(db: unknown,/);
  });
  it("loadReview hands both reads the scoped client it already holds", () => {
    const src = code("src/lib/review/load.ts");
    expect(src).toMatch(/feeReads\.acceptedProposalFees\(db, /);
    expect(src).toMatch(/feeReads\.trackerFees\(db, /);
  });
});
