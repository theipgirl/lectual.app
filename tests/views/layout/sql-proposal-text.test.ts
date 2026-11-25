import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIEW_KEYS } from "@/lib/views/layout/types";

/** Text checks on the two database proposals (nothing here runs SQL): the final 0119 and the dev-only delta 0119b. */
const D = "docs/pge/2026-11-17-agentic-ip-os/";
const FINAL = readFileSync(`${D}0119-proposed.sql.txt`, "utf8");
const DELTA = readFileSync(`${D}0119b-proposed.sql.txt`, "utf8");

const keysIn = (text: string, re: RegExp): string[] => {
  const m = text.match(re);
  expect(m, String(re)).not.toBeNull();
  return [...m![1].matchAll(/'{1,2}([a-z_]+)'{1,2}/g)].map((x) => x[1]);
};
const fnBody = (text: string, name: string): string => {
  const at = text.indexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThanOrEqual(0);
  return text.slice(at, text.indexOf("\n$$;", at) + 4);
};

describe("both proposals are pure ASCII (they survive any transport)", () => {
  for (const [name, text] of [["0119", FINAL], ["0119b", DELTA]] as const)
    it(name, () => {
      expect(/[^\x00-\x7F]/.test(text)).toBe(false);
      // no \uXXXX escape inside a string either: characters are built with chr()
      expect(text).not.toMatch(/\\u[0-9A-Fa-f]{4}/);
    });
  it("the label and name rules build their characters with chr()", () => {
    for (const f of ["crm_view_layout_column_valid", "crm_stage_clean_name"]) expect(fnBody(FINAL, f)).toContain("pg_catalog.chr(8203)");
    expect(fnBody(FINAL, "crm_view_layout_column_valid")).toContain("pg_catalog.chr(65279)");
  });
});

describe("the view keys", () => {
  const finalKeys = keysIn(FINAL, /constraint crm_view_layout_view_key check \(view_key in \(([^)]*)\)\)/);
  it("the final file's view_key list equals the app's ViewKey list, in order", () => {
    expect(finalKeys).toEqual([...VIEW_KEYS]);
  });
  it("there is no bare review_list key anywhere in the final file's code", () => {
    expect(FINAL).not.toMatch(/'review_list'/);
  });
  it("0119b's constraint definition equals the final file's", () => {
    expect(keysIn(DELTA, /ARRAY\[([^\]]*)\]/)).toEqual(finalKeys);
    expect(keysIn(DELTA, /check \(view_key in \(([^)]*)\)\) not valid/)).toEqual(finalKeys);
    expect(DELTA).toContain("check (public.crm_view_layout_columns_valid(columns))");
    expect(FINAL).toContain("constraint crm_view_layout_columns check (public.crm_view_layout_columns_valid(columns))");
  });
});

describe("0119b brings a database holding the first copy to the final one", () => {
  it("every function it replaces is byte for byte the final file's", () => {
    const names = [...DELTA.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(names).toEqual(["crm_matter_stage_label_key", "crm_view_layout_column_valid", "crm_stage_clean_name", "crm_matter_stage_add", "crm_stage_roles_backfill"]);
    for (const n of names) expect(fnBody(DELTA, n), n).toBe(fnBody(FINAL, n));
  });
  it("each constraint swap is ONE alter table (drop and add together), guarded on the live definition", () => {
    expect(DELTA).toMatch(/pg_get_constraintdef/);
    for (const m of DELTA.matchAll(/alter table public\.crm_view_layout drop constraint if exists (\w+), '\s*\|\| 'add constraint \1/g)) expect(m[1]).toMatch(/^crm_view_layout_(view_key|columns)$/);
    expect((DELTA.match(/drop constraint/g) ?? []).length).toBe(2);
  });
  it("converts any review_list row to review_list_trademarks unless that exists, then removes the old key, before validating", () => {
    const convert = DELTA.indexOf("where o.view_key = 'review_list'");
    const validate = DELTA.indexOf("validate constraint crm_view_layout_view_key");
    expect(convert).toBeGreaterThan(DELTA.indexOf("not valid"));
    expect(validate).toBeGreaterThan(convert);
    expect(DELTA).toContain("not exists (select 1 from public.crm_view_layout t where t.org_id = o.org_id and t.view_key = 'review_list_trademarks')");
    expect(DELTA).toContain("delete from public.crm_view_layout where view_key = 'review_list'");
  });
  it("ends with read-only verification: constraint definitions, no byte above 0x7F in a function body, no review_list row", () => {
    const tail = DELTA.slice(DELTA.indexOf("VERIFICATION"));
    expect(tail).toContain("pg_get_constraintdef");
    expect(tail).toContain("octet_length(prosrc) <> char_length(prosrc)");
    expect(tail).toContain("where view_key = 'review_list'");
    expect(tail).not.toMatch(/^\s*(insert|update|delete|alter|drop|create)\b/m);
  });
  it("the headers say what they are", () => {
    expect(DELTA).toMatch(/DEV ONLY/);
    expect(DELTA).toContain("0119b_editable_views_delta");
    expect(DELTA).toMatch(/NEEDS THE OWNER'S OK/);
    expect(FINAL).toContain("THIS FILE IS THE FINAL ONE FOR A FRESH APPLY ON");
    expect(FINAL).toContain("Revised after the step 3 review: the Weekly review List has one layout per section");
  });
  it("pre-apply check 9 names 0106's two functions", () => {
    expect(FINAL).toContain("0106's two");
    expect(FINAL).toContain("set_config('lectual.loe_*'");
  });
});
