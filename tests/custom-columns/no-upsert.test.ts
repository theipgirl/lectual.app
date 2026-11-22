import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** C1 / R8: no upsert and no onConflict on any Sprint 3 write path (0115 "WRITES": read first, then insert or update by id). */
const ROOT = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });
const PATHS = [
  ...walk("src/lib/custom-columns"),
  ...walk("src/components/settings").filter((f) => /ColumnsSettings[^/]*\.tsx$/.test(f)),
  ...walk("src/app/dashboard/settings/columns"),
  "src/components/review/FirmColumnsEdit.tsx",
  "src/components/review/CustomValueInput.tsx",
  "src/lib/review/sheet-edit.ts",
  "src/components/review/SheetEditTable.tsx",
];

describe("C1: no upsert, no onConflict", () => {
  it("covers the R8 paths", () => {
    expect(PATHS).toContain("src/lib/custom-columns/store.ts");
    expect(PATHS).toContain("src/components/settings/ColumnsSettingsForms.tsx");
    expect(PATHS).toContain("src/app/dashboard/settings/columns/page.tsx");
  });
  for (const f of PATHS)
    it(f, () => {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src).not.toMatch(/\.upsert\(/);
      expect(src).not.toMatch(/onConflict/);
    });
});
