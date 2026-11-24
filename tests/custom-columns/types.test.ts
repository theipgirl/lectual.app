import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** D2: the hand-added types carry the proposed marker and exactly the proposal's columns. */
const ROOT = path.resolve(__dirname, "../..");
const types = readFileSync(path.join(ROOT, "src/lib/db/types.ts"), "utf8");
const sql = readFileSync(path.join(ROOT, "docs/pge/2026-11-17-agentic-ip-os/0115-proposed.sql.txt"), "utf8").replace(/--.*$/gm, "");

/** Column names of `create table if not exists public.<t> ( ... );` (constraint lines skipped). */
function sqlColumns(table: string): string[] {
  const start = sql.indexOf(`create table if not exists public.${table} (`);
  const end = sql.indexOf("\n);", start);
  return sql
    .slice(sql.indexOf("(", start) + 1, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("constraint") && !l.startsWith("references") && /^[a-z_]+\s/.test(l))
    .map((l) => l.split(/\s+/)[0])
    .sort();
}

/** Keys of `<table>: { ... <part>: { ... } ...` in types.ts. */
function typeKeys(table: string, part: "Row" | "Insert" | "Update"): string[] {
  const at = types.indexOf(`      ${table}: {`);
  const p = types.indexOf(`${part}: {`, at);
  const end = types.indexOf("}", p);
  return [...types.slice(p, end).matchAll(/^\s+([a-z_]+)\??:/gm)].map((m) => m[1]).sort();
}

describe("hand-added types for lectual 0115 (proposed)", () => {
  it("both blocks exist with the proposed marker", () => {
    for (const t of ["crm_custom_field", "crm_custom_value"]) {
      const at = types.indexOf(`      ${t}: {`);
      expect(at, t).toBeGreaterThan(0);
      expect(types.slice(Math.max(0, at - 700), at), t).toContain("lectual 0115, proposed; replace on the next codegen run");
    }
  });

  it("Row has exactly the proposal's columns", () => {
    expect(typeKeys("crm_custom_field", "Row")).toEqual(sqlColumns("crm_custom_field"));
    expect(typeKeys("crm_custom_value", "Row")).toEqual(sqlColumns("crm_custom_value"));
  });

  it("Insert and Update hold exactly the granted columns", () => {
    const granted = (verb: "insert" | "update", table: string) =>
      (new RegExp(`grant ${verb} \\(([^)]*)\\) on public\\.${table} to authenticated`).exec(sql)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean).sort();
    for (const t of ["crm_custom_field", "crm_custom_value"]) {
      expect(typeKeys(t, "Insert"), t).toEqual(granted("insert", t));
      expect(typeKeys(t, "Update"), t).toEqual(granted("update", t));
    }
  });
});
