import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guardOffenders, scanForLeadTable } from "./live-guard-scan";

/**
 * M5 (lectual 0107): every crm_lead read or write leaves out merged leads, follows them to the keeper, or carries a
 * reason. Every occurrence of the table name as a string ("crm_lead": `.from("crm_lead")`, `readIn("crm_lead", …)`,
 * `from(x ? … : "crm_lead")`) passes only when:
 *   - it is wrapped in `live(...)` (src/lib/leads/live.ts), or
 *   - its statement names `merged_into_id` / the `merged` flag (it reads the pointer and follows or skips it), or
 *   - its statement is an insert (a new lead is never merged), or
 *   - a `// live-guard: <reason>` comment sits on its line or in the three lines above it.
 * A new list read uses `live(...)`; anything else says why it may see a merged lead.
 */
const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("crm_lead reads and writes respect merged leads (M5)", () => {
  it("every occurrence in src is live(...), follows the pointer, is an insert, or carries a live-guard reason", () => {
    const bad: string[] = [];
    for (const file of walk(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel === "src/lib/db/types.ts") continue;
      for (const line of guardOffenders(fs.readFileSync(file, "utf8"))) bad.push(`${rel}:${line}`);
    }
    expect(bad).toEqual([]);
  });

  it("the main lists use live(...)", () => {
    for (const file of ["src/lib/pipeline/leads.ts", "src/lib/intake/leads.ts", "src/lib/intake/lost.ts", "src/lib/nav-counts.ts", "src/app/dashboard/intake/reconcile/actions.ts"]) {
      expect(fs.readFileSync(path.join(ROOT, file), "utf8"), file).toMatch(/live\(/);
    }
  });
});

describe("the guard itself", () => {
  const offenders = (code: string) => guardOffenders(code);

  it("catches a bare list read", () => {
    expect(offenders(`const { data } = await db.from("crm_lead").select("*").order("x");`)).toEqual([1]);
  });
  it("catches the table name passed as an argument, and in a conditional", () => {
    expect(offenders(`const rows = await readIn("crm_lead", cols, "id", ids);`)).toEqual([1]);
    expect(offenders(`const q = db.from(kind === "matter" ? "crm_matter" : "crm_lead").select("id");`)).toEqual([1]);
  });
  it("passes live(...), the pointer, an insert and a marked line", () => {
    expect(offenders(`await leadRead(({ live }) => live(db.from("crm_lead").select("*")));`)).toEqual([]);
    expect(offenders(`await db.from("crm_lead").select("id, merged_into_id").eq("id", x);`)).toEqual([]);
    expect(offenders(`await db.from("crm_lead").insert({ a: 1 });`)).toEqual([]);
    expect(offenders(`// live-guard: reads the page's own lead by id, which redirects a merged one\nawait db.from("crm_lead").select("id").eq("id", x);`)).toEqual([]);
    expect(offenders(`await db.from("crm_lead").select("id").eq("id", x); // live-guard: the page's own lead, redirected when merged`)).toEqual([]);
  });
  it("a marker needs a reason, and only covers the next three lines", () => {
    expect(offenders(`// live-guard:\nawait db.from("crm_lead").select("id");`)).toEqual([2]);
    expect(offenders(`// live-guard: a reason long enough\n\n\n\nawait db.from("crm_lead").select("id");`)).toEqual([5]);
  });
  it("ignores type references and comments", () => {
    expect(scanForLeadTable(`type Lead = Database["public"]["Tables"]["crm_lead"]["Row"];\n// from("crm_lead") in a comment`)).toEqual([]);
  });
});
