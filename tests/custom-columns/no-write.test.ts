import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** C3: the read side writes nothing. Comments are stripped so a comment that explains a ban doesn't trip it. */
const ROOT = path.resolve(__dirname, "../..");
const code = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIB = readdirSync(path.join(ROOT, "src/lib/custom-columns")).map((f) => `src/lib/custom-columns/${f}`);
const COMPONENTS = [
  "src/components/review/ReviewCardExtras.tsx",
  "src/components/review/SectionNote.tsx",
  "src/components/review/SheetView.tsx",
  "src/components/review/SheetViewTable.tsx",
  "src/components/review/SheetEdit.tsx",
  "src/components/review/ColumnChooser.tsx",
];

describe("no write path in the custom-columns read side", () => {
  it("the library folder holds the three read-side files only", () => {
    expect(LIB.sort()).toEqual(["src/lib/custom-columns/card-load.ts", "src/lib/custom-columns/load.ts", "src/lib/custom-columns/rules.ts"]);
  });

  for (const f of [...LIB, ...COMPONENTS]) {
    it(`${f}: no "use server", <form, fetch(, .insert(, .update(, .upsert(, .delete( or .rpc(`, () => {
      const src = code(f);
      expect(src).not.toMatch(/["']use server["']/);
      expect(src).not.toMatch(/<form\b/);
      expect(src).not.toMatch(/\bfetch\(/);
      expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src).not.toMatch(/@\/lib\/db\/admin/);
    });
  }

  it("only load.ts reads a table, and only the two custom tables, by name", () => {
    for (const f of LIB) {
      const tables = [...code(f).matchAll(/\.from\(["'`]([^"'`]+)["'`]\)/g)].map((m) => m[1]);
      if (f.endsWith("/load.ts")) expect(tables.sort()).toEqual(["crm_custom_field", "crm_custom_value"]);
      else expect(tables, f).toEqual([]);
    }
  });

  it("rules.ts is pure: no React, no server-only, no next/*, no @/lib/db", () => {
    const src = code("src/lib/custom-columns/rules.ts");
    expect(src).not.toMatch(/from ["']react/);
    expect(src).not.toMatch(/server-only/);
    expect(src).not.toMatch(/from ["']next\//);
    expect(src).not.toMatch(/@\/lib\/db/);
  });
});
