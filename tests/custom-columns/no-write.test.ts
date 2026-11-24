import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C2 (Sprint 3, changed on purpose from Sprint 2's "read side only"): the READ files stay write-free; the write calls live in ONE file,
 * `store.ts`, and only on the two custom tables; only `load.ts`, `settings-load.ts` and `store.ts` name a table. Comments are stripped
 * so a comment that explains a ban doesn't trip it.
 */
const ROOT = path.resolve(__dirname, "../..");
const code = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIB = readdirSync(path.join(ROOT, "src/lib/custom-columns")).map((f) => `src/lib/custom-columns/${f}`);
const READ_FILES = ["rules.ts", "load.ts", "card-load.ts", "settings-load.ts", "text.ts", "input.ts", "errors.ts"].map((f) => `src/lib/custom-columns/${f}`);
const COMPONENTS = [
  "src/components/review/ReviewCardExtras.tsx",
  "src/components/review/SectionNote.tsx",
  "src/components/review/SheetView.tsx",
  "src/components/review/SheetViewTable.tsx",
  "src/components/review/SheetEdit.tsx",
  "src/components/review/ColumnChooser.tsx",
  "src/components/review/CustomValueInput.tsx",
  "src/components/settings/ColumnsSettings.tsx",
];
/** Every file this sprint adds. */
const NEW_FILES = [
  ...LIB.filter((f) => !["rules.ts", "load.ts", "card-load.ts"].some((old) => f.endsWith(`/${old}`))),
  "src/components/settings/ColumnsSettings.tsx",
  "src/components/settings/ColumnsSettingsForms.tsx",
  "src/components/review/FirmColumnsEdit.tsx",
  "src/components/review/CustomValueInput.tsx",
  "src/app/dashboard/settings/columns/page.tsx",
];

describe("the custom-columns library: one write file, read files write-free", () => {
  it("the library holds exactly the read files, the logic, the store and the actions", () => {
    expect(LIB.map((f) => path.basename(f)).sort()).toEqual(
      ["actions.ts", "card-load.ts", "errors.ts", "field-actions.ts", "input.ts", "load.ts", "rules.ts", "settings-load.ts", "store.ts", "text.ts", "value-actions.ts"].sort(),
    );
  });

  for (const f of [...READ_FILES, ...COMPONENTS]) {
    it(`${f}: no "use server", <form, fetch(, .insert(, .update(, .upsert(, .delete( or .rpc(`, () => {
      const src = code(f);
      expect(src).not.toMatch(/["']use server["']/);
      expect(src).not.toMatch(/<form\b/);
      expect(src).not.toMatch(/\bfetch\(/);
      expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src).not.toMatch(/@\/lib\/db\/admin/);
    });
  }

  it(".insert( / .update( / .delete( appear only in store.ts, and only on crm_custom_field / crm_custom_value", () => {
    for (const f of LIB) {
      const src = code(f);
      const writes = src.match(/\.(insert|update|delete)\(/g) ?? [];
      if (f.endsWith("/store.ts")) expect(writes.length, f).toBeGreaterThan(0);
      else expect(writes, f).toEqual([]);
    }
    const store = code("src/lib/custom-columns/store.ts");
    // every write chain starts from one of the two custom tables
    for (const m of store.matchAll(/\.from\(["'`]([^"'`]+)["'`]\)\s*\.(insert|update|delete)\(/g)) expect(["crm_custom_field", "crm_custom_value"], m[0]).toContain(m[1]);
    // the lead and matter tables are only selected
    for (const m of store.matchAll(/\.from\(["'`](crm_lead|crm_matter)["'`]\)\s*\.(\w+)\(/g)) expect(m[2], m[0]).toBe("select");
    expect(store).not.toMatch(/\.upsert\(|onConflict|\.rpc\(/);
  });

  it(".from( appears only in load.ts, settings-load.ts and store.ts, each on its own tables", () => {
    for (const f of LIB) {
      const tables = [...code(f).matchAll(/\.from\(["'`]([^"'`]+)["'`]\)/g)].map((m) => m[1]);
      const base = path.basename(f);
      if (base === "load.ts" || base === "settings-load.ts") expect([...new Set(tables)].sort(), f).toEqual(["crm_custom_field", "crm_custom_value"]);
      else if (base === "store.ts") expect([...new Set(tables)].sort(), f).toEqual(["crm_custom_field", "crm_custom_value", "crm_lead", "crm_matter"]);
      else expect(tables, f).toEqual([]);
    }
  });

  for (const f of NEW_FILES) {
    it(`${f}: no fetch(, admin client, service role, mailer, Lawmatics, LawPay or queue import`, () => {
      const src = code(f);
      expect(src).not.toMatch(/\bfetch\(/);
      expect(src).not.toMatch(/@\/lib\/db\/admin/);
      expect(src).not.toMatch(/SERVICE_ROLE/);
      const imports = [...src.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]);
      for (const i of imports) expect(i, f).not.toMatch(/resend|lawmatics|lawpay|queue|internal-mail/i);
    });
  }

  it("every select in the library names its columns (no select('*'), no bare select())", () => {
    for (const f of LIB) {
      const src = code(f);
      expect(src, f).not.toMatch(/\.select\(\s*\)/);
      expect(src, f).not.toMatch(/\.select\(["'`]\*["'`]\)/);
    }
  });

  it("the pure files import no React, server-only, next/* or @/lib/db", () => {
    for (const f of ["rules.ts", "text.ts", "input.ts", "errors.ts", "field-actions.ts", "value-actions.ts"]) {
      const src = code(`src/lib/custom-columns/${f}`);
      expect(src, f).not.toMatch(/from ["']react/);
      expect(src, f).not.toMatch(/server-only/);
      expect(src, f).not.toMatch(/from ["']next\//);
      expect(src, f).not.toMatch(/@\/lib\/db/);
    }
  });
});
