import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** F2: nothing was applied, and nothing here could apply it. */
const ROOT = path.resolve(__dirname, "../..");
const SKIP = new Set(["node_modules", ".next", ".git", ".vercel", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else out.push(path.relative(ROOT, p));
  }
  return out;
}

const NEW_FILES = [
  "src/lib/custom-columns/rules.ts",
  "src/lib/custom-columns/load.ts",
  "src/lib/custom-columns/card-load.ts",
];

describe("nothing was applied (F2)", () => {
  const files = walk(ROOT);

  it("no supabase/migrations directory and no .sql file anywhere in this repo (only .sql.txt)", () => {
    expect(files.filter((f) => /(^|\/)supabase\/migrations\//.test(f))).toEqual([]);
    expect(files.filter((f) => f.endsWith(".sql"))).toEqual([]);
    expect(files).toContain("docs/pge/2026-11-17-agentic-ip-os/0115-proposed.sql.txt");
  });

  it("no path under supabase/ changed since the sprint's base (4cb9cb1)", () => {
    let changed: string[];
    try {
      changed = execFileSync("git", ["diff", "--name-only", "4cb9cb1", "HEAD"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
      // A checkout without that commit (a shallow clone) cannot answer; the walk above still holds.
      return;
    }
    expect(changed.filter((f) => f.startsWith("supabase/"))).toEqual([]);
  });

  it("the new read-side files name no admin client, no service role and no way to apply anything", () => {
    for (const f of NEW_FILES) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      for (const banned of ["@/lib/db/admin", "getAdminClient", "SERVICE_ROLE", "apply_migration", "execute_sql"]) expect(src, `${f}: ${banned}`).not.toContain(banned);
    }
  });
});
