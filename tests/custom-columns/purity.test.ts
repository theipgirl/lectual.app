import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** C7: the pure files' import pins, and invented names only in this sprint's fixtures. */
const ROOT = path.resolve(__dirname, "../..");
const code = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const imports = (f: string) => [...code(f).matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]);

const PURE = [
  "src/lib/custom-columns/text.ts",
  "src/lib/custom-columns/input.ts",
  "src/lib/custom-columns/errors.ts",
  "src/lib/custom-columns/rules.ts",
  "src/lib/review/sheet-columns.ts",
  "src/lib/review/sheet-edit.ts",
];

describe("C7: the pure files", () => {
  for (const f of PURE)
    it(`${f}: no React, server-only, next/* or @/lib/db`, () => {
      for (const i of imports(f)) {
        expect(i, f).not.toMatch(/^react(-dom)?(\/|$)/);
        expect(i, f).not.toBe("server-only");
        expect(i, f).not.toMatch(/^next(\/|$)/);
        expect(i, f).not.toMatch(/^@\/lib\/db/);
      }
      expect(code(f)).not.toMatch(/import ["']server-only["']/);
    });
  it("sheet-columns.ts still imports only @/lib/ui/words", () => {
    expect(imports("src/lib/review/sheet-columns.ts")).toEqual(["@/lib/ui/words"]);
  });
});

/** Real names that must never appear in a fixture (people and firms the product serves). Invented ones only. */
const DENY = [/Danielle Milton/i, /Sevetri/i, /Faithe/i, /Enisha/i, /Cabanis/i, /\bRPB\b/, /Hartwell/i, /Caitlyn/i, /\bRayn\b/];
const FIXTURES = [
  "tests/custom-columns/field-fake.ts",
  "tests/custom-columns/field-actions.test.ts",
  "tests/custom-columns/value-actions.test.ts",
  "tests/custom-columns/actions-wiring.test.ts",
  "tests/custom-columns/text.test.ts",
  "tests/custom-columns/input.test.ts",
  "tests/custom-columns/money-input.test.ts",
  "tests/custom-columns/errors.test.ts",
  "tests/custom-columns/field-store.test.ts",
  "tests/custom-columns/settings-render.test.tsx",
  "tests/review/section-note.test.tsx",
  "tests/review/sheet-edit-custom-render.test.tsx",
  "tests/review/firm-columns-edit.test.tsx",
  "tests/settings/columns-page.test.tsx",
  "tests/settings/layout-columns-tab.test.tsx",
  "scripts/design-harness/screens/custom-columns.screen.tsx",
];

describe("C7: invented names only in the new fixtures", () => {
  for (const f of FIXTURES)
    it(f, () => {
      expect(existsSync(path.join(ROOT, f)), f).toBe(true);
      const src = readFileSync(path.join(ROOT, f), "utf8");
      for (const d of DENY) expect(src, `${f}: ${d}`).not.toMatch(d);
    });
});
