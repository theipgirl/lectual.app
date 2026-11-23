import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F1: the proposal file for lectual 0115, read as TEXT. Nothing here touches a database. Comment lines are stripped for the SQL
 * assertions and kept for the prose ones.
 */
const ROOT = path.resolve(__dirname, "../..");
const FILE = "docs/pge/2026-11-17-agentic-ip-os/0115-proposed.sql.txt";
const raw = readFileSync(path.join(ROOT, FILE), "utf8");
/** SQL with every `--` comment removed (no string literal in the file contains `--`). */
const sql = raw.replace(/--.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const SQL = flat(sql);

/** The body of `create or replace function public.<name>(...)` between its two `$$`. */
function body(name: string): string {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("$$", at);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(at, close + 2);
}
/** A function body with its string literals removed (the lock keys and the messages), so a name check sees only identifiers. */
const withoutLiterals = (s: string) => s.replace(/'(?:[^']|'')*'/g, "''");

const FUNCTIONS = ["crm_custom_field_options_valid", "crm_custom_field_rules", "crm_custom_value_rules", "crm_custom_value_delete_rules"] as const;

describe("0115 proposal: header and prose", () => {
  it("starts with the PROPOSAL ONLY header and says where it goes", () => {
    expect(raw.split("\n")[0]).toBe("-- PROPOSAL ONLY. NOT A MIGRATION OF THIS REPO. NOT APPLIED ANYWHERE (not lectual-dev, not lectual-prod).");
    expect(raw).toContain("NOT APPLIED ANYWHERE");
    expect(raw).toContain("lectual/supabase/migrations/0115_custom_columns.sql");
    expect(raw).toContain("0108 and 0110-0114 are spoken for");
    expect(raw).toMatch(/apply to lectual-dev first/i);
    expect(raw).toMatch(/lectual-prod\s+--\s+only with the owner's OK|lectual-prod only with the owner's OK/);
  });

  it("names what it was checked against: 0085, 0089, 0097, 0099, 0103, 0104, 0105, 0106, 0107, not a live database", () => {
    const line = raw.split("\n").find((l) => l.includes("Checked against this repo's types and lectual migrations")) ?? "";
    for (const n of ["0085", "0089", "0097", "0099", "0103", "0104", "0105", "0106", "0107"]) expect(line, n).toContain(n);
    expect(raw).toContain("NOT a live");
    expect(raw).toMatch(/Depends on: 0001 \(crm_org, crm_org_member unique \(org_id, user_id\)\), 0002 \(current_org_id \/ current_org_role\),\s*--\s*0104 \(crm_lead_id_org_uniq, crm_matter_id_org_uniq\), 0107 \(crm_lead\.merged_into_id\)/);
  });

  // Changed on purpose (Taylor, Nov 23): the open question is answered, owner only.
  it("states that custom money is owner only, and why RLS enforces it", () => {
    expect(raw).not.toContain("OPEN QUESTION FOR THE FIRM (custom money visibility)");
    expect(raw).toContain("CUSTOM MONEY IS OWNER ONLY (Taylor, Nov 23; this replaces the earlier open question)");
    expect(raw).toMatch(/`value_cents is not null` is true for\s+--\s+exactly the money rows/);
    expect(raw).toMatch(/Not chosen: a column grant on value_cents/);
  });

  it("records the trigger rename from the spec", () => {
    expect(raw).toContain("`crm_custom_value_check`");
    expect(raw).toContain("`crm_custom_value_rules` (function) and\n--   `crm_custom_value_rules_trg` (trigger)");
  });

  it("states the lock order with the single-row precondition and 40P01", () => {
    expect(raw).toContain("deadlock-free ONLY for single-row statements, each in its own transaction");
    expect(raw).toContain("40P01");
    expect(raw).toMatch(/one row per\s+--\s+request, one transaction/);
    expect(raw).toMatch(/foreign field id briefly holds another firm's field key/);
    expect(raw).toMatch(/Value writes take only the per-field SHARED advisory lock/);
    expect(raw).toMatch(/then, when options or archived change, the per-field EXCLUSIVE lock: always in that order/);
  });

  it("has the known-limits paragraphs", () => {
    const limits = raw.slice(raw.indexOf("-- KNOWN LIMITS AND BEHAVIOUR"));
    expect(limits).toMatch(/Archive keeps every value row/);
    expect(limits).toMatch(/Restore re-checks the 40-column limit and the label rule/);
    expect(limits).toMatch(/Delete of a field: there is no DELETE policy and no DELETE grant/);
    expect(limits).toMatch(/Removed member: that member's person value rows in that firm are deleted/);
    expect(limits).toMatch(/one-value CHECK/);
    expect(limits).toMatch(/Merge \(0107\): crm_merge_leads moves no value/);
    expect(limits).toContain('"From a merged duplicate"');
    expect(limits).toMatch(/A lead's values do not copy to its matter/);
    expect(limits).toMatch(/Matter type change: nothing stops crm_matter\.type changing/);
    expect(limits).toMatch(/read first, then insert, or update by id; a 23505 on insert means re-read and update/);
    // the cascade explanation under the value table
    expect(raw).toMatch(/the CHECK is evaluated on that UPDATE\s+--\s+and no trigger can bypass a CHECK/);
  });

  it("never says the conflict-update word, onConflict, or prune; no drop, no delete from, no seed rows", () => {
    expect(raw).not.toMatch(/upsert/i);
    expect(raw).not.toContain("onConflict");
    expect(raw).not.toMatch(/prune/i);
    expect(sql).not.toMatch(/\bdrop\s/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.crm_custom_/i);
  });

  it("lists the 22 isolation cases, each with a key phrase, plus the manual check", () => {
    const cases = raw.slice(raw.indexOf("-- Cases to add to lectual tests/tenant-isolation.test.ts"));
    const phrases: Record<number, RegExp> = {
      1: /Firm B reads 0 of firm A's fields and 0 of its values/,
      2: /naming firm A's field: 23503 custom_value_no_field/,
      3: /as the service role with a forged org_id/,
      4: /whose field belongs to B: 23503 custom_value_no_field/,
      5: /No oracle/,
      6: /UPDATE and DELETE of firm A's values affect 0 rows/,
      7: /exists in auth\.users but has no crm_org_member row/,
      8: /viewer and social_media: value insert refused \(42501\); value update and delete affect 0 rows/,
      9: /attorney, intake, paralegal, law_clerk and clerk insert, update and delete a value; none of them can insert a field \(42501\);\s+--\s+their rename or archive of a field affects 0 rows/,
      10: /DELETE of a field is refused for everyone, owner included/,
      11: /Value rules, each with its prefix or code/,
      12: /Immutables/,
      13: /Field rules: the 41st live field/,
      14: /created_by = a colleague: 42501/,
      15: /anon reads nothing and writes nothing; TRUNCATE is refused/,
      16: /Archive keeps the values \(count unchanged\)/,
      17: /deleting the firm in ONE statement removes its fields and values/,
      18: /Removing a member who holds person values succeeds/,
      19: /Deleting an auth user who created a field and last updated a value on an ARCHIVED field succeeds/,
      20: /Merged leads: \(a\)/,
      21: /The existing 0104 \/ 0105 \/ 0107 cases stay green/,
      // Nov 23: custom money is owner only.
      22: /Money is owner only \(Taylor, Nov 23\)[\s\S]*admin, senior_admin,\s+--\s+attorney, paralegal and viewer of firm A read 0 money values[\s\S]*firm B's owner reads nothing/,
    };
    for (let n = 1; n <= 22; n++) {
      const start = cases.search(new RegExp(`--\\s+${n}\\. `));
      expect(start, `case ${n}`).toBeGreaterThanOrEqual(0);
      const next = n < 22 ? cases.search(new RegExp(`--\\s+${n + 1}\\. `)) : cases.indexOf("Manual check");
      expect(cases.slice(start, next), `case ${n}`).toMatch(phrases[n]);
    }
    expect(cases).toContain("Manual check (not a vitest case): two sessions on lectual-dev");
    expect(cases).toMatch(/fails with custom_value_bad_choice/);
  });
});

describe("0115 proposal: statement order (R2-5)", () => {
  const at = (needle: string) => {
    const i = sql.indexOf(needle);
    expect(i, needle).toBeGreaterThanOrEqual(0);
    return i;
  };

  it("function, then tables, then indexes, then trigger functions, then triggers, then grants, then RLS, then comments", () => {
    const fn = at("create or replace function public.crm_custom_field_options_valid");
    const guard = at("crm_lead_id_org_uniq unique (id, org_id)");
    const t1 = at("create table if not exists public.crm_custom_field");
    const t2 = at("create table if not exists public.crm_custom_value");
    const ix = at("create unique index if not exists crm_custom_field_label_live_uniq");
    const lastIx = sql.lastIndexOf("create index if not exists");
    const tf = at("create or replace function public.crm_custom_field_rules");
    const trg = at("create trigger crm_custom_field_rules_trg");
    const grants = at("revoke all on public.crm_custom_field from anon;");
    const rls = at("alter table public.crm_custom_field enable row level security;");
    const pol = at("create policy crm_custom_field_select_member");
    const com = at("comment on table public.crm_custom_field");
    expect(fn).toBeLessThan(guard);
    expect(guard).toBeLessThan(t1);
    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(ix);
    expect(lastIx).toBeLessThan(tf);
    expect(sql.lastIndexOf("create or replace function")).toBeLessThan(trg);
    expect(sql.lastIndexOf("create trigger")).toBeLessThan(grants);
    expect(sql.lastIndexOf("revoke all on function")).toBeLessThan(rls);
    expect(rls).toBeLessThan(pol);
    expect(sql.lastIndexOf("create policy")).toBeLessThan(com);
  });

  it("each function is defined before its first use", () => {
    expect(at("create or replace function public.crm_custom_field_options_valid")).toBeLessThan(at("public.crm_custom_field_options_valid(kind, options)"));
    for (const [fn, trg] of [
      ["crm_custom_field_rules", "create trigger crm_custom_field_rules_trg"],
      ["crm_custom_value_rules", "create trigger crm_custom_value_rules_trg"],
      ["crm_custom_value_delete_rules", "create trigger crm_custom_value_delete_trg"],
    ]) {
      const def = at(`create or replace function public.${fn}()`);
      const uses = [...sql.matchAll(new RegExp(`public\\.${fn}\\(`, "g"))].map((m) => m.index ?? 0);
      expect(Math.min(...uses), fn).toBe(def + "create or replace function ".length);
      expect(def).toBeLessThan(at(trg));
    }
    // the parent-key guard comes before the value table's composite FKs
    expect(at("crm_matter_id_org_uniq unique (id, org_id)")).toBeLessThan(at("constraint crm_custom_value_lead_org_fk"));
  });
});

describe("0115 proposal: tables", () => {
  it("both tables, every column and CHECK", () => {
    expect(SQL).toContain("create table if not exists public.crm_custom_field (");
    expect(SQL).toContain("create table if not exists public.crm_custom_value (");
    for (const col of [
      "id uuid primary key default gen_random_uuid()",
      "org_id uuid not null references public.crm_org(id) on delete cascade",
      "section text not null",
      "label text not null",
      "kind text not null",
      "options jsonb not null default '[]'",
      "position int not null default 0",
      "archived boolean not null default false",
      "created_by uuid default auth.uid() references auth.users(id) on delete set null",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ])
      expect(SQL, col).toContain(col);
    expect(SQL).toContain("constraint crm_custom_field_section check (section in ('trademarks', 'contracts', 'both'))");
    expect(SQL).toContain("constraint crm_custom_field_label_len check (char_length(label) between 1 and 60)");
    expect(SQL).toContain("constraint crm_custom_field_label_trimmed check (label = btrim(label))");
    expect(SQL).toContain("constraint crm_custom_field_kind check (kind in ('text', 'date', 'money', 'choice', 'person'))");
    expect(SQL).toContain("constraint crm_custom_field_options check (public.crm_custom_field_options_valid(kind, options))");
    expect(SQL).toContain("constraint crm_custom_field_position check (position between 0 and 1000)");
    expect(SQL).toContain("constraint crm_custom_field_id_org_uniq unique (id, org_id)");

    for (const col of [
      "field_id uuid not null",
      "lead_id uuid,",
      "matter_id uuid,",
      "value_text text,",
      "value_date date,",
      "value_cents bigint,",
      "value_choice text,",
      "value_user_id uuid,",
      "updated_by uuid default auth.uid() references auth.users(id) on delete set null",
    ])
      expect(SQL, col).toContain(col);
    expect(SQL).toContain("constraint crm_custom_value_one_record check (num_nonnulls(lead_id, matter_id) = 1)");
    expect(SQL).toContain("constraint crm_custom_value_one_value check (num_nonnulls(value_text, value_date, value_cents, value_choice, value_user_id) = 1)");
    // Non-blocking review note taken: an empty text is not a value (an emptied value is deleted).
    expect(SQL).toContain("check (char_length(value_text) between 1 and 500)");
    expect(SQL).toContain("check (value_cents between 0 and 100000000000)");
    expect(SQL).toContain("check (char_length(value_choice) <= 40)");
    expect((SQL.match(/num_nonnulls\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(SQL).toContain("constraint crm_custom_value_one_per_record unique nulls not distinct (field_id, lead_id, matter_id)");
  });

  it("the four composite FKs by name with their actions, and no referential set-null on value_user_id", () => {
    const fk = (name: string) => flat(SQL.slice(SQL.indexOf(`constraint ${name}`), SQL.indexOf(",", SQL.indexOf("on delete", SQL.indexOf(`constraint ${name}`)))));
    expect(fk("crm_custom_value_field_org_fk")).toBe("constraint crm_custom_value_field_org_fk foreign key (field_id, org_id) references public.crm_custom_field (id, org_id) match simple on update no action on delete cascade");
    expect(fk("crm_custom_value_lead_org_fk")).toBe("constraint crm_custom_value_lead_org_fk foreign key (lead_id, org_id) references public.crm_lead (id, org_id) match simple on update no action on delete cascade");
    expect(fk("crm_custom_value_matter_org_fk")).toBe("constraint crm_custom_value_matter_org_fk foreign key (matter_id, org_id) references public.crm_matter (id, org_id) match simple on update no action on delete cascade");
    expect(SQL).toContain("constraint crm_custom_value_value_user_org_fk foreign key (org_id, value_user_id) references public.crm_org_member (org_id, user_id) match simple on update no action on delete cascade");
    expect(raw).not.toMatch(/on delete set null \(value_user_id\)/i);
  });

  it("indexes, the partial label index included", () => {
    expect(SQL).toContain("create unique index if not exists crm_custom_field_label_live_uniq on public.crm_custom_field (org_id, section, lower(btrim(label))) where not archived;");
    for (const ix of [
      "on public.crm_custom_field (org_id, position)",
      "on public.crm_custom_field (created_by)",
      "on public.crm_custom_value (org_id, lead_id)",
      "on public.crm_custom_value (org_id, matter_id)",
      "on public.crm_custom_value (field_id)",
      "on public.crm_custom_value (org_id, value_user_id)",
      "on public.crm_custom_value (updated_by)",
    ])
      expect(SQL, ix).toContain(ix);
  });

  it("is idempotent: guarded blocks for constraints, triggers and policies", () => {
    expect(SQL).toContain("if not exists (select 1 from pg_constraint where conname = 'crm_lead_id_org_uniq')");
    expect(SQL).toContain("if not exists (select 1 from pg_constraint where conname = 'crm_matter_id_org_uniq')");
    for (const p of ["crm_custom_field_select_member", "crm_custom_field_insert_admin", "crm_custom_field_update_admin", "crm_custom_value_select_member", "crm_custom_value_insert_staff", "crm_custom_value_update_staff", "crm_custom_value_delete_staff"])
      expect(SQL, p).toContain(`policyname = '${p}'`);
  });
});

describe("0115 proposal: functions and triggers", () => {
  it("every function sets search_path = '' and names crm_ / current_org_ / uid( only schema-qualified (literals and comments stripped)", () => {
    for (const fn of FUNCTIONS) {
      const b = body(fn);
      expect(b, fn).toMatch(/set search_path = ''/);
      const ids = withoutLiterals(b.slice(b.indexOf("$$")));
      expect(ids, fn).not.toMatch(/(?<!public\.)\bcrm_/);
      expect(ids, fn).not.toMatch(/(?<!public\.)\bcurrent_org_/);
      expect(ids, fn).not.toMatch(/(?<!auth\.)\buid\(/);
    }
  });

  it("the lock keys, verbatim on the unstripped text", () => {
    const field = body("crm_custom_field_rules");
    const value = body("crm_custom_value_rules");
    const del = body("crm_custom_value_delete_rules");
    expect(field).toContain("perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_custom_field:' || new.org_id::text, 0));");
    expect(field).toContain("perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_custom_value_field:' || new.id::text, 0));");
    expect(value).toContain("perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('crm_custom_value_field:' || new.field_id::text, 0));");
    expect(del).toContain("perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('crm_custom_value_field:' || old.field_id::text, 0));");
    // the shared lock comes before the field is read
    expect(value.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(value.indexOf("from public.crm_custom_field"));
    expect(del.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(del.indexOf("from public.crm_custom_field"));
    // the org lock before the per-field exclusive lock, and both before the limit and label checks
    expect(field.indexOf("'crm_custom_field:'")).toBeLessThan(field.indexOf("'crm_custom_value_field:'"));
    expect(field.indexOf("'crm_custom_value_field:'")).toBeLessThan(field.indexOf("custom_field_limit"));
  });

  it("the two narrow referential-action branches, and no other pg_trigger_depth() but the delete trigger's", () => {
    const field = flat(body("crm_custom_field_rules"));
    const value = flat(body("crm_custom_value_rules"));
    expect(field).toContain("if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') and new.created_by is null then return new; end if;");
    expect(value).toContain("if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and (to_jsonb(new) - 'updated_by') = (to_jsonb(old) - 'updated_by') and new.updated_by is null then return new; end if;");
    const del = flat(body("crm_custom_value_delete_rules"));
    expect(del).toContain("if pg_trigger_depth() > 1 then return old; end if;");
    expect((sql.match(/pg_trigger_depth\(\)/g) ?? []).length).toBe(3);
    // each bypass is the first statement of its function, before any lock or check
    expect(field.indexOf("pg_trigger_depth")).toBeLessThan(field.indexOf("custom_field_immutable"));
    expect(value.indexOf("pg_trigger_depth")).toBeLessThan(value.indexOf("custom_value_immutable"));
  });

  it("the lookups filter by id AND firm", () => {
    const value = flat(body("crm_custom_value_rules"));
    expect(value).toContain("from public.crm_custom_field where id = new.field_id and org_id = new.org_id;");
    expect(value).toContain("from public.crm_lead where id = new.lead_id and org_id = new.org_id;");
    expect(value).toContain("from public.crm_matter where id = new.matter_id and org_id = new.org_id;");
    expect(flat(body("crm_custom_field_rules"))).toContain("where v.field_id = new.id and v.org_id = new.org_id");
  });

  it("the rule steps run in the contract's order", () => {
    const value = body("crm_custom_value_rules");
    // Nov 23: the money owner-only refusal comes right after the field is read, before the record (changed on purpose).
    const order = ["custom_value_immutable", "custom_value_one_record", "pg_advisory_xact_lock_shared", "custom_value_no_field", "custom_value_money_owner_only", "custom_value_no_record", "custom_value_merged_lead", "custom_value_field_archived", "custom_value_wrong_section", "custom_value_empty", "custom_value_wrong_kind", "custom_value_bad_choice", "new.updated_by := auth.uid()"];
    for (let i = 1; i < order.length; i++) expect(value.indexOf(order[i - 1]), `${order[i - 1]} < ${order[i]}`).toBeLessThan(value.indexOf(order[i]));
    const field = body("crm_custom_field_rules");
    const forder = ["custom_field_immutable", "pg_advisory_xact_lock(", "custom_field_limit", "custom_field_label_taken", "custom_field_options_in_use", "new.created_at := now()"];
    for (let i = 1; i < forder.length; i++) expect(field.indexOf(forder[i - 1]), `${forder[i - 1]} < ${forder[i]}`).toBeLessThan(field.indexOf(forder[i]));
    expect(field).toContain("if auth.uid() is not null then\n      new.created_by := auth.uid();");
    expect(field).toContain("new.updated_at := now();");
    expect(value).toContain("new.updated_at := now();");
  });

  it("the immutables: a value's id, org_id, field_id, lead_id, matter_id exactly; a field's id, org_id, kind, section, created_by, created_at", () => {
    const value = body("crm_custom_value_rules");
    const vBlock = value.slice(0, value.indexOf("custom_value_immutable"));
    const vCols = [...vBlock.slice(vBlock.lastIndexOf("if tg_op = 'UPDATE' then")).matchAll(/new\.(\w+) is distinct from old\.\1/g)].map((m) => m[1]);
    expect(vCols).toEqual(["id", "org_id", "field_id", "lead_id", "matter_id"]);
    const field = body("crm_custom_field_rules");
    const fBlock = field.slice(0, field.indexOf("custom_field_immutable"));
    const fCols = [...fBlock.slice(fBlock.lastIndexOf("if tg_op = 'UPDATE' then")).matchAll(/new\.(\w+) is distinct from old\.\1/g)].map((m) => m[1]);
    expect(fCols).toEqual(["id", "org_id", "kind", "section", "created_by", "created_at"]);
  });

  it("each of the 15 prefixes is the start of a raise exception message, with its errcode on that raise (R2-4)", () => {
    const codes: Record<string, string> = {
      custom_field_limit: "23514",
      custom_field_immutable: "23514",
      custom_field_label_taken: "23505",
      custom_field_options_in_use: "23514",
      custom_value_immutable: "23514",
      custom_value_one_record: "23514",
      custom_value_no_field: "23503",
      custom_value_no_record: "23503",
      custom_value_merged_lead: "23514",
      custom_value_field_archived: "23514",
      custom_value_wrong_section: "23514",
      custom_value_empty: "23514",
      custom_value_wrong_kind: "23514",
      custom_value_bad_choice: "23514",
      custom_value_money_owner_only: "42501",
    };
    const raises = [...sql.matchAll(/raise exception '([a-z_]+):(?:[^']|'')*'\s+using errcode = '(\d{5})';/g)].map((m) => [m[1], m[2]] as const);
    expect(Object.keys(codes)).toHaveLength(15);
    for (const [prefix, code] of Object.entries(codes)) {
      const mine = raises.filter(([p]) => p === prefix);
      expect(mine.length, prefix).toBeGreaterThanOrEqual(1);
      for (const [, c] of mine) expect(c, prefix).toBe(code);
    }
    // nothing else is raised
    for (const [p] of raises) expect(Object.keys(codes)).toContain(p);
  });

  it("one fixed message per not-found prefix: a foreign id and an invented one read the same", () => {
    const msgs = (prefix: string) => new Set([...sql.matchAll(new RegExp(`raise exception '(${prefix}:(?:[^']|'')*)'`, "g"))].map((m) => m[1]));
    expect(msgs("custom_value_no_field").size).toBe(1);
    expect(msgs("custom_value_no_record").size).toBe(1);
  });

  it("the three triggers, by name, table and timing, each behind a pg_trigger guard (R2-2)", () => {
    for (const [name, table, timing, fn] of [
      ["crm_custom_field_rules_trg", "crm_custom_field", "before insert or update", "crm_custom_field_rules"],
      ["crm_custom_value_rules_trg", "crm_custom_value", "before insert or update", "crm_custom_value_rules"],
      ["crm_custom_value_delete_trg", "crm_custom_value", "before delete", "crm_custom_value_delete_rules"],
    ]) {
      expect(SQL, name).toContain(`where tgname = '${name}' and tgrelid = 'public.${table}'::regclass) then create trigger ${name} ${timing} on public.${table} for each row execute function public.${fn}();`);
    }
  });

  it("the trigger functions run as the caller (no security definer)", () => {
    for (const fn of FUNCTIONS) expect(body(fn), fn).not.toMatch(/security definer/i);
  });
});

describe("0115 proposal: grants and RLS", () => {
  const lines = sql.split("\n").map((l) => l.trim());
  const grantLines = lines.filter((l) => /^(grant|revoke)\b/.test(l));

  it("exactly the grant and revoke lines, in 0099 / 0103 order", () => {
    expect(grantLines).toEqual([
      "revoke all on public.crm_custom_field from anon;",
      "revoke insert, update, delete, truncate, references, trigger on public.crm_custom_field from authenticated;",
      "grant select on public.crm_custom_field to authenticated;",
      "grant insert (org_id, section, label, kind, options, position) on public.crm_custom_field to authenticated;",
      "grant update (label, options, position, archived) on public.crm_custom_field to authenticated;",
      "revoke truncate, references, trigger on public.crm_custom_field from anon, authenticated;",
      "revoke all on public.crm_custom_value from anon;",
      "revoke insert, update, delete, truncate, references, trigger on public.crm_custom_value from authenticated;",
      "grant select, delete on public.crm_custom_value to authenticated;",
      "grant insert (org_id, field_id, lead_id, matter_id, value_text, value_date, value_cents, value_choice, value_user_id) on public.crm_custom_value to authenticated;",
      "grant update (value_text, value_date, value_cents, value_choice, value_user_id) on public.crm_custom_value to authenticated;",
      "revoke truncate, references, trigger on public.crm_custom_value from anon, authenticated;",
      "revoke all on function public.crm_custom_field_rules() from public, anon, authenticated;",
      "revoke all on function public.crm_custom_value_rules() from public, anon, authenticated;",
      "revoke all on function public.crm_custom_value_delete_rules() from public, anon, authenticated;",
    ]);
  });

  it("each table's revoke from authenticated comes before that table's first grant", () => {
    for (const t of ["crm_custom_field", "crm_custom_value"]) {
      const revoke = grantLines.indexOf(`revoke insert, update, delete, truncate, references, trigger on public.${t} from authenticated;`);
      const firstGrant = grantLines.findIndex((l) => l.startsWith("grant ") && l.includes(`public.${t} `));
      expect(revoke, t).toBeGreaterThanOrEqual(0);
      expect(revoke, t).toBeLessThan(firstGrant);
    }
  });

  it("no UPDATE grant names a pointer or a stamp, and the field table has no DELETE grant", () => {
    for (const l of grantLines.filter((x) => x.startsWith("grant update"))) for (const c of ["org_id", "field_id", "lead_id", "matter_id", "updated_by", "created_by"]) expect(l, c).not.toContain(c);
    expect(grantLines.some((l) => l.startsWith("grant") && /delete/.test(l) && l.includes("crm_custom_field "))).toBe(false);
  });

  it("RLS on both; policies keyed on the firm with the contract's role lists; no DELETE policy on fields", () => {
    expect(SQL).toContain("alter table public.crm_custom_field enable row level security;");
    expect(SQL).toContain("alter table public.crm_custom_value enable row level security;");
    const policies = [...SQL.matchAll(/create policy (\w+) on public\.(\w+) ([\s\S]*?\));(?= end if;)/g)].map((m) => ({ name: m[1], table: m[2], text: m[3] }));
    expect(policies.map((p) => p.name)).toEqual([
      "crm_custom_field_select_member",
      "crm_custom_field_insert_admin",
      "crm_custom_field_update_admin",
      "crm_custom_value_select_member",
      "crm_custom_value_insert_staff",
      "crm_custom_value_update_staff",
      "crm_custom_value_delete_staff",
    ]);
    for (const p of policies) expect(p.text, p.name).toContain("public.current_org_id()");
    const ADMIN = "('owner', 'admin', 'senior_admin')";
    const STAFF = "('owner', 'admin', 'senior_admin', 'attorney', 'intake', 'paralegal', 'law_clerk', 'clerk')";
    const by = (n: string) => policies.find((p) => p.name === n)!.text;
    expect(by("crm_custom_field_select_member")).toBe("for select using (org_id = public.current_org_id())");
    // Nov 23: every value policy carries the money row predicate (owner only); the field select is unchanged.
    const MONEY = "and (value_cents is null or public.current_org_role() = 'owner')";
    expect(by("crm_custom_value_select_member")).toBe(`for select using ( org_id = public.current_org_id() ${MONEY} )`);
    expect(by("crm_custom_value_insert_staff")).toContain(MONEY);
    expect(by("crm_custom_value_update_staff").split(MONEY)).toHaveLength(3);
    expect(by("crm_custom_value_delete_staff")).toContain(MONEY);
    expect(by("crm_custom_field_insert_admin")).toContain(`public.current_org_role() in ${ADMIN}`);
    expect(by("crm_custom_field_update_admin").split(ADMIN)).toHaveLength(3);
    expect(by("crm_custom_value_insert_staff")).toContain(`public.current_org_role() in ${STAFF}`);
    expect(by("crm_custom_value_update_staff").split(STAFF)).toHaveLength(3);
    const del = by("crm_custom_value_delete_staff");
    expect(del).toMatch(/^for delete using/);
    expect(del).toContain(`public.current_org_role() in ${STAFF}`);
    expect(del).toContain("not f.archived");
    expect(del).toContain("merged_into_id is null");
    expect(policies.filter((p) => p.table === "crm_custom_field").some((p) => /for delete/.test(p.text))).toBe(false);
    expect(SQL).not.toMatch(/platform_admin\b(?!\))/);
  });
});

describe("0115 proposal: the app maps its prefixes in ONE place (Sprint 3)", () => {
  it("only src/lib/custom-columns/errors.ts names one of the 15 prefixes", () => {
    const prefixes = [...new Set([...sql.matchAll(/raise exception '([a-z_]+):/g)].map((m) => m[1]))];
    expect(prefixes).toHaveLength(15);
    const re = new RegExp(`\\b(${prefixes.join("|")})\\b`);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && re.test(readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, "src"));
    expect(hits).toEqual(["src/lib/custom-columns/errors.ts"]);
  });
});

/* ── Sprint 3: CO2 (MAINTAIN), D8's five additions, R17, and the SQL that CO1's read side mirrors ── */

describe("0115 proposal: Sprint 3 additions (D8)", () => {
  const lines = raw.split("\n");
  const lastGrant = Math.max(...lines.map((l, i) => (/^grant\b/.test(l.trim()) ? i : -1)));

  it("CO2: MAINTAIN is revoked from anon and authenticated on both tables, inside one version-guarded do block after the last grant", () => {
    const at = sql.indexOf("pg_catalog.current_setting('server_version_num')::int >= 170000");
    expect(at).toBeGreaterThan(0);
    const block = sql.slice(sql.lastIndexOf("do $$", at), sql.indexOf("$$;", at) + 3);
    expect(flat(block)).toBe(
      "do $$ begin if pg_catalog.current_setting('server_version_num')::int >= 170000 then execute 'revoke maintain on public.crm_custom_field from anon, authenticated'; execute 'revoke maintain on public.crm_custom_value from anon, authenticated'; end if; end $$;",
    );
    const blockLine = lines.findIndex((l) => l.includes("server_version_num"));
    expect(blockLine).toBeGreaterThan(lastGrant);
    // still inside section 6, before row level security
    expect(at).toBeLessThan(sql.indexOf("alter table public.crm_custom_field enable row level security;"));
    expect((SQL.match(/revoke maintain/g) ?? []).length).toBe(2);
  });

  it("the WRITES line about Move", () => {
    const writes = raw.slice(raw.indexOf("-- WRITES"), raw.indexOf("-- ====", raw.indexOf("-- WRITES")));
    expect(writes).toContain("--   * Move in Settings -> Columns is two single-row position updates in two requests, never one statement or one transaction.");
  });

  it("the two KNOWN LIMITS lines, verbatim (N4's wording for the second)", () => {
    const limits = raw.slice(raw.indexOf("-- KNOWN LIMITS AND BEHAVIOUR"));
    expect(limits).toContain(
      "--   * lectual.app mirrors the label and option CHECKs exactly (Postgres `btrim` default characters, `char_length` in code points); its writes clean whitespace and control characters first.",
    );
    expect(limits).toContain(
      "--   * A failed Move can leave two columns sharing a position; they then order by label. A further Move repairs it; if it can't, archive and restore one of them.",
    );
  });

  it("R17: isolation case 15 names the MAINTAIN check", () => {
    const cases = raw.slice(raw.indexOf("-- Cases to add to lectual tests/tenant-isolation.test.ts"));
    const c15 = cases.slice(cases.search(/--\s+15\. /), cases.search(/--\s+16\. /));
    expect(c15).toContain("On PostgreSQL 17, `has_table_privilege` for `authenticated` and `anon` with `MAINTAIN` on both tables is false.");
  });

  it("exactly the five additions over Sprint 2's file, and nothing else changed (the file without them is byte for byte Sprint 2's)", () => {
    const single = [
      "--   * Move in Settings -> Columns is two single-row position updates in two requests, never one statement or one transaction.\n",
      "--   * lectual.app mirrors the label and option CHECKs exactly (Postgres `btrim` default characters, `char_length` in code points); its writes clean whitespace and control characters first.\n",
      "--   * A failed Move can leave two columns sharing a position; they then order by label. A further Move repairs it; if it can't, archive and restore one of them.\n",
      "--      On PostgreSQL 17, `has_table_privilege` for `authenticated` and `anon` with `MAINTAIN` on both tables is false.\n",
    ];
    let without = raw;
    for (const l of single) {
      expect(without.split(l)).toHaveLength(2);
      without = without.replace(l, "");
    }
    const start = without.indexOf("\n-- PostgreSQL 17 adds the MAINTAIN privilege");
    const end = without.indexOf("end\n$$;\n", start) + "end\n$$;\n".length;
    expect(start).toBeGreaterThan(0);
    without = without.slice(0, start) + without.slice(end);
    // Changed on purpose (Taylor, Nov 23): the owner-only money change is a deliberate edit, so the baseline is now the file with it
    // (the money header, step 5b, the four policy predicates, a KNOWN LIMITS line and isolation case 22). Was 9a366b25be82ef207dcbd410f6daa106 (dbec367).
    expect(createHash("md5").update(without).digest("hex")).toBe("20ee3205e2b79b8a3468b565555f9edf");
  });

  it("CO1: the SQL the app's read side mirrors", () => {
    expect(SQL).toContain("constraint crm_custom_field_label_len check (char_length(label) between 1 and 60)");
    expect(SQL).toContain("constraint crm_custom_field_label_trimmed check (label = btrim(label))");
    const opts = flat(body("crm_custom_field_options_valid"));
    expect(opts).toContain("pg_catalog.jsonb_array_length(p_options) between 1 and 30");
    expect(opts).toContain("pg_catalog.char_length(e.v #>> '{}') not between 1 and 40");
    expect(opts).toContain("(e.v #>> '{}') <> pg_catalog.btrim(e.v #>> '{}')");
    expect(opts).toContain("pg_catalog.count(distinct pg_catalog.lower(e.v #>> '{}'))");
    expect(opts).toContain("else p_options = '[]'::jsonb");
  });
});
