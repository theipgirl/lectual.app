import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/auth/roles";

/**
 * The proposal file for lectual 0116 (crm_org_member self-insert and self-promotion guard), read as TEXT. Nothing here touches a
 * database. Comment lines are stripped for the SQL assertions and kept for the prose ones.
 */
const ROOT = path.resolve(__dirname, "../..");
const FILE = "docs/pge/2026-11-17-agentic-ip-os/0116-proposed.sql.txt";
const raw = readFileSync(path.join(ROOT, FILE), "utf8");
/** SQL with every `--` comment removed (no string literal in the file contains `--`). */
const sql = raw.replace(/--.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const SQL = flat(sql);
const HEADER = raw.slice(0, raw.indexOf("-- ── 1. Schema `private`"));

/** The text of `create or replace function <schema>.<name>(...)` up to its closing `$$`. */
function fn(qualified: string): string {
  const at = sql.indexOf(`create or replace function ${qualified}(`);
  expect(at, qualified).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("$$", at);
  const close = sql.indexOf("$$", open + 2);
  return flat(sql.slice(at, close + 2));
}

const PREFIXES = [
  "member_owner_guard_no_session",
  "member_owner_guard_wrong_org",
  "member_owner_guard_immutable",
  "member_owner_guard_self_insert",
  "member_owner_guard_self_role",
  "member_owner_guard_not_admin",
  "member_owner_guard_not_owner",
  "member_owner_guard_rank",
  "member_owner_guard_last_owner",
] as const;

const TRUST = [
  "current_user = 'service_role'",
  "pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER')",
];

describe("0116 proposal: header and prose", () => {
  it("is a proposal only, applied nowhere, and says where it goes", () => {
    expect(raw.split("\n")[1]).toBe("-- PROPOSAL ONLY. NOT A MIGRATION OF THIS REPO. NOT APPLIED ANYWHERE (not lectual-dev, not lectual-prod).");
    expect(raw).toContain("lectual/supabase/migrations/0116_member_owner_guard.sql");
    expect(raw).toContain("apply to lectual-dev");
    expect(raw).toContain("only with the owner's OK");
  });

  it("quotes the three 0002 write policies it narrows", () => {
    for (const p of ["member_insert_admin", "member_update_admin", "member_delete_admin"]) expect(raw).toContain(`create policy ${p} on crm_org_member`);
  });

  it("names the 0115 dependency and the order to apply", () => {
    expect(raw).toContain("Apply 0116 BEFORE 0115, or in the same deploy.");
  });

  it("lists every writer it found, in both repos, and the wipe() and removeMember notes", () => {
    for (const w of [
      "src/lib/settings/members.ts inviteMember",
      "src/lib/settings/admin.ts setMemberRole",
      "src/lib/settings/members.ts removeMember",
      "scripts/seed-demo-firm.mts",
      "scripts/invite-members.ts",
      "scripts/provision-tenant.ts",
      "scripts/grant-platform-admin.ts (`pnpm platform-admin`)",
      "tests/helpers/seed.ts",
      "provision_org(p_name, p_slug)",
      "provision_org_for_owner",
      "never reads the returned `error`, so a refused user delete is SILENT there",
      "revoke_member_sessions BEFORE the delete",
    ]) expect(raw, w).toContain(w);
  });

  it("explains why cascades reach the AFTER trigger at depth 1, and what deleting a sole owner's auth user does", () => {
    expect(HEADER).toContain("The AFTER ROW trigger does NOT: the cascade's AFTER row events are run at the end of the outer statement, at");
    expect(HEADER).toContain("deleting the auth user of a firm's only");
    expect(raw).toContain("Deleting the auth user of a firm's only owner (Supabase auth admin, or the service role) succeeds through the parent_gone test");
  });

  it("records Taylor's Nov 23 decisions, the pre-apply checks and the remaining questions", () => {
    expect(HEADER).toContain("TABLE REVOKES (decided, Taylor, Nov 23: keep them)");
    expect(raw).not.toContain("flagged");
    for (const d of ["D1.", "D2.", "D3.", "D4."]) expect(HEADER, d).toContain(`--   ${d}`);
    expect(HEADER).toContain("READ-ONLY: it shows the rows (ids and roles, no emails) and removes\n--      NOTHING");
    expect(HEADER).toContain("select enum_range(null::public.crm_role);");
    expect(HEADER).toContain("r.rolname in ('authenticated', 'anon', 'authenticator', 'service_role', 'supabase_auth_admin')");
    expect(HEADER).toContain("'public.provision_org_for_owner(text,text,uuid,text,text,text)'::regprocedure");
    expect(HEADER).toContain("where table_schema = 'public' and table_name = 'crm_org_member' order by ordinal_position");
    for (const q of ["Q1.", "Q2.", "Q3.", "Q4."]) expect(HEADER, q).toContain(`--   ${q}`);
    expect(HEADER).toContain("Should a DENIED platform-admin attempt be audited too?");
    expect(HEADER).toContain("neither the REST API nor /graphql/v1 exposes schema `private`");
    expect(HEADER).toContain("PRODUCTION SHAPE (checked on prod by the director, Nov 23)");
  });

  it("carries the isolation cases the requests asked for", () => {
    const cases = raw.slice(raw.indexOf("-- Cases to add to lectual tests/tenant-isolation.test.ts"));
    expect(cases.length).toBeGreaterThan(100);
    for (const s of [
      "PA inserts (A, PA, 'owner'): 42501 member_owner_guard_self_insert",
      "(A, PA, 'admin')",
      "AD updates own row to owner",
      "SA: the same refusals as case 3",
      "O1 inserts (A, O2, 'owner'): succeeds",
      "AD invites (inserts) (A, newUser, 'paralegal')",
      "Service role:",
      "OB (firm B's owner",
      "BOTH owner rows survive",
      "`supabase.auth.admin.deleteUser(U)` (GoTrue, which deletes",
      "Assert the returned `error` is null",
      "deleting firm A in ONE statement",
      "AD is REMOVED from firm A by O1 while AD's token",
      "AD is\n--      DEMOTED to paralegal",
      "PA (no membership in A,\n--      is_platform_admin true) re-roles P paralegal -> attorney: succeeds",
    ]) expect(cases, s).toContain(s);
  });
});

describe("0116 proposal: rank mirror and platform admin audit (Taylor, Nov 23)", () => {
  it("quotes the app's rank lines it mirrors, and each one is still in its named function (text, not line numbers)", () => {
    for (const l of [
      "export function hasRole(actual: Role, required: Role): boolean { return RANK[actual] <= RANK[required]; }",
      "src/lib/settings/members.ts, inviteMember:   if (!hasRole(callerRole, role))",
      "src/lib/settings/members.ts, removeMember:   if (!hasRole(callerRole, current))",
      "src/lib/settings/admin.ts, setMemberRole:    if (!targetCurrentRole || !hasRole(callerRole, targetCurrentRole))",
      "src/lib/settings/admin.ts, setMemberRole:    if (!hasRole(callerRole, role))",
    ]) expect(HEADER, l).toContain(l);
    expect(HEADER).not.toMatch(/src\/lib\/settings\/(members|admin)\.ts:\d+/);
    expect(readFileSync(path.join(ROOT, "src/lib/auth/roles.ts"), "utf8")).toContain("return RANK[actual] <= RANK[required];");
    /** The body of `export async function <name>(` up to the next top-level `export `. */
    const bodyOf = (file: string, name: string) => {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      const at = src.indexOf(`export async function ${name}(`);
      expect(at, `${file} ${name}`).toBeGreaterThanOrEqual(0);
      const next = src.indexOf("\nexport ", at + 1);
      return src.slice(at, next === -1 ? undefined : next);
    };
    const count = (hay: string, needle: string) => hay.split(needle).length - 1;
    const invite = bodyOf("src/lib/settings/members.ts", "inviteMember");
    const remove = bodyOf("src/lib/settings/members.ts", "removeMember");
    const setRole = bodyOf("src/lib/settings/admin.ts", "setMemberRole");
    expect(count(invite, "if (!hasRole(callerRole, role)) {")).toBe(1);
    expect(count(remove, "if (!hasRole(callerRole, current)) {")).toBe(1);
    expect(count(setRole, "if (!targetCurrentRole || !hasRole(callerRole, targetCurrentRole)) {")).toBe(1);
    expect(count(setRole, "if (!hasRole(callerRole, role)) {")).toBe(1);
  });

  it("the database's rank list is exactly the app's ROLES, in order", () => {
    const m = SQL.match(/v_ranks constant text\[\] := array\[([^\]]+)\];/);
    expect(m).not.toBeNull();
    const list = m![1].split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
    expect(list).toEqual([...ROLES]);
  });

  it("the rank check reads the caller's real row and applies hasRole to the new and the old role", () => {
    const f = fn("public.crm_org_member_owner_guard");
    expect(f).toContain("if v_facts.caller_role is not null then v_caller_rank := pg_catalog.array_position(v_ranks, v_facts.caller_role);");
    expect(f).toContain("(tg_op in ('INSERT', 'UPDATE') and coalesce(pg_catalog.array_position(v_ranks, new.role::text), 0) < v_caller_rank)");
    expect(f).toContain("(tg_op in ('UPDATE', 'DELETE') and coalesce(pg_catalog.array_position(v_ranks, old.role::text), 0) < v_caller_rank)");
    expect(f.indexOf("member_owner_guard_not_owner")).toBeLessThan(f.indexOf("member_owner_guard_rank"));
  });

  it("quotes 0050's audit table and adds only nullable columns and one CHECK", () => {
    expect(HEADER).toContain("--     user_id    uuid not null references auth.users(id) on delete cascade,");
    expect(SQL).toContain("alter table public.platform_admin_audit add column if not exists action text, add column if not exists target_user_id uuid, add column if not exists old_role public.crm_role, add column if not exists new_role public.crm_role;");
    expect(SQL).toContain("add constraint platform_admin_audit_member_write_shape check ( (action is null and target_user_id is null and old_role is null and new_role is null) or (action = 'member_insert' and target_user_id is not null and old_role is null and new_role is not null) or (action = 'member_update' and target_user_id is not null and old_role is not null and new_role is not null) or (action = 'member_delete' and target_user_id is not null and old_role is not null and new_role is null) ) not valid;");
    expect(SQL).toContain("end $$; alter table public.platform_admin_audit validate constraint platform_admin_audit_member_write_shape;");
    expect(SQL).not.toMatch(/\b(grant|revoke)\b[^;]*\bon\s+(table\s+)?public\.platform_admin_audit\b/i);
    expect(SQL).not.toMatch(/policy[^;]*platform_admin_audit/i);
  });

  it("the audit trigger is SECURITY DEFINER, takes no arguments, reads only NEW/OLD/TG_OP, and nothing else writes member rows", () => {
    expect(sql).not.toContain("private.crm_org_member_audit");
    const t = fn("public.crm_org_member_platform_audit");
    expect(t).toContain("public.crm_org_member_platform_audit() returns trigger language plpgsql security definer set search_path = ''");
    const order = [
      "if v_uid is null then return null; end if;",
      "if tg_op = 'DELETE' and old.user_id = v_uid then return null; end if;",
      "if pg_catalog.pg_trigger_depth() > 1 then return null; end if;",
      "if tg_op = 'DELETE' and (not exists (select 1 from public.crm_org o where o.id = v_org) or not exists (select 1 from auth.users u where u.id = v_target)) then return null; end if;",
      "if exists (select 1 from public.crm_org_member m where m.org_id = v_org and m.user_id = v_uid) then return null; end if;",
      "if not exists (select 1 from public.platform_admin p where p.user_id = v_uid) then return null; end if;",
      "values (v_uid, v_org, 'member_insert', v_target, null, new.role);",
      "values (v_uid, v_org, 'member_update', v_target, old.role, new.role);",
      "values (v_uid, v_org, 'member_delete', v_target, old.role, null);",
    ];
    let last = -1;
    for (const o of order) {
      const at = t.indexOf(o);
      expect(at, o).toBeGreaterThan(last);
      last = at;
    }
    expect(t).not.toContain("current_user");
    expect(t).not.toMatch(/exception\s+when/i);
    for (const r of ["public", "anon", "authenticated", "service_role"]) expect(SQL).toContain(`revoke execute on function public.crm_org_member_platform_audit() from ${r};`);
    expect(SQL).not.toMatch(/grant execute on function public\.crm_org_member_platform_audit/);
    expect(SQL).toContain("create trigger crm_org_member_platform_audit_trg after insert or update or delete on public.crm_org_member for each row execute function public.crm_org_member_platform_audit();");
    // The only statements in the file that insert into the audit table are the three branches of the trigger.
    expect(SQL.match(/insert into public\.platform_admin_audit/g)).toHaveLength(3);
  });

  it("carries the audit and rank isolation cases", () => {
    const cases = raw.slice(raw.indexOf("-- Cases to add to lectual tests/tenant-isolation.test.ts"));
    for (const c of ["--  18. Platform admin audit", "exactly ONE new platform_admin_audit row", "add NO audit\n--      row; by the service role, none", "select from platform_admin_audit: 0 rows", "--  19. Rank (rule c2, member_owner_guard_rank)", "SA inserts (A, newUser, 'admin'): rank", "equal rank is allowed", "not bounded by rank",
      "(i) Forging: no function writes a member_* audit row on request",
      "--  20. A platform admin who is ALSO a real member (production's demo firm)",
      "(b) With O2 still an owner, PO deletes their OWN row: succeeds, with NO audit row.",
      "PO updates their own\n--          row to admin -> 42501 member_owner_guard_self_role",
      "supabase.auth.admin.deleteUser(PO) returns error null",
      "(A, newUser, 'paralegal') succeeds with exactly ONE audit row (user_id PO, org A, member_insert)",
      "--  21. Rank list and enum", "as\n--      SETS",
      "accept\n--      not_admin there",
    ]) expect(cases, c).toContain(c);
  });
});

describe("0116 proposal: the SQL", () => {
  it("is additive: no drop, no delete, no policy change, and the only grant change on the table is the flagged revoke", () => {
    expect(SQL).not.toMatch(/\bdrop\s/i);
    expect(SQL).not.toMatch(/\bdelete\s+from\b/i);
    expect(SQL).not.toMatch(/\b(create|alter)\s+policy\b/i);
    const tableGrants = SQL.match(/\b(grant|revoke)\s+[a-z, ]+\s+on\s+(table\s+)?public\.crm_org_member\b[^;]*;/gi) ?? [];
    expect(tableGrants).toEqual([
      "revoke truncate, references, trigger on public.crm_org_member from anon, authenticated;",
      "revoke maintain on public.crm_org_member from anon, authenticated';",
    ]);
    expect(SQL).toContain("execute 'revoke maintain on public.crm_org_member from anon, authenticated'");
    expect(SQL).toContain("if pg_catalog.current_setting('server_version_num')::int >= 170000 then");
  });

  it("puts the two helpers in schema private, closed to public and anon, with EXECUTE narrowed", () => {
    expect(SQL).toContain("create schema if not exists private;");
    expect(SQL).toContain("revoke all on schema private from public;");
    expect(SQL).toContain("revoke all on schema private from anon;");
    expect(SQL).toContain("grant usage on schema private to authenticated;");
    expect(SQL).not.toContain("grant usage on schema private to service_role;");
    expect(SQL).not.toMatch(/create or replace function public\.crm_org_member_(owner|caller)_facts/);
    for (const sig of ["private.crm_org_member_caller_facts(boolean)", "private.crm_org_member_parent_gone(uuid, uuid)"]) {
      expect(SQL, sig).toContain(`revoke all on function ${sig} from public;`);
      expect(SQL, sig).toContain(`revoke all on function ${sig} from anon;`);
    }
    expect(SQL).toContain("grant execute on function private.crm_org_member_caller_facts(boolean) to authenticated;");
    expect(SQL).toContain("revoke all on function private.crm_org_member_parent_gone(uuid, uuid) from authenticated;");
    expect(SQL).not.toMatch(/grant execute on function private\.crm_org_member_parent_gone\(uuid, uuid\) to (authenticated|service_role)/);
    expect(SQL).toContain("execute 'grant execute on function private.crm_org_member_parent_gone(uuid, uuid) to supabase_auth_admin'");
  });

  it("the facts helper is SECURITY DEFINER, search_path '', answers only for the caller, reads the TABLE, and locks only when asked", () => {
    const f = fn("private.crm_org_member_caller_facts");
    expect(f).toContain("security definer");
    expect(f).toContain("set search_path = ''");
    expect(f).toContain("p_lock boolean, out caller_role text, out caller_is_platform_admin boolean, out owner_count integer");
    expect(f).toContain("v_org uuid := public.current_org_id()");
    expect(f).toContain("v_uid uuid := auth.uid()");
    expect(f).toContain("select m.role::text into caller_role from public.crm_org_member m where m.org_id = v_org and m.user_id = v_uid;");
    expect(f).toContain("caller_is_platform_admin := coalesce(public.is_platform_admin(), false);");
    expect(f).toContain("if p_lock then perform pg_catalog.pg_advisory_xact_lock(");
    expect(f).not.toContain("current_org_role");
  });

  it("the parent_gone helper is SECURITY DEFINER, search_path '', and true when the firm OR the auth user is gone", () => {
    const f = fn("private.crm_org_member_parent_gone");
    expect(f).toContain("security definer");
    expect(f).toContain("set search_path = ''");
    expect(f).toContain("select not exists (select 1 from public.crm_org o where o.id = p_org) or not exists (select 1 from auth.users u where u.id = p_user);");
  });

  it("both guards are SECURITY INVOKER with search_path '' and never trust the role claim", () => {
    for (const name of ["public.crm_org_member_owner_guard", "public.crm_org_member_last_owner_guard"]) {
      const f = fn(name);
      expect(f, name).not.toContain("security definer");
      expect(f, name).toContain("set search_path = ''");
      expect(f, name).not.toContain("current_org_role");
      expect(f, name).toContain("if pg_catalog.pg_trigger_depth() > 1 then");
      for (const t of TRUST) expect(f, name).toContain(t);
      expect(SQL).toContain(`revoke execute on function ${name}() from authenticated;`);
    }
  });

  it("the BEFORE guard: self rules, foreign rows, every-column immutability, real admin tier, real owner", () => {
    const f = fn("public.crm_org_member_owner_guard");
    expect(f).toContain("if v_uid is null then raise exception 'member_owner_guard_no_session");
    expect(f).toContain("if tg_op = 'INSERT' and new.user_id = v_uid then raise exception 'member_owner_guard_self_insert");
    expect(f).toContain("if tg_op = 'UPDATE' and old.user_id = v_uid and new.role is distinct from old.role then raise exception 'member_owner_guard_self_role");
    expect(f).toContain("new.org_id is distinct from v_org");
    expect(f).toContain("old.org_id is distinct from v_org");
    expect(f).toContain("if tg_op = 'UPDATE' and (pg_catalog.to_jsonb(new) - 'role') is distinct from (pg_catalog.to_jsonb(old) - 'role') then raise exception 'member_owner_guard_immutable");
    expect(f).toContain("v_touches_owner := new.role = 'owner'");
    expect(f).toContain("v_touches_owner := new.role is distinct from old.role and (old.role = 'owner' or new.role = 'owner')");
    expect(f).toContain("v_touches_owner := old.role = 'owner'");
    expect(f).toContain("from private.crm_org_member_caller_facts(v_touches_owner) f");
    expect(f).toContain("if not (coalesce(v_facts.caller_role, '') in ('owner', 'admin', 'senior_admin') or coalesce(v_facts.caller_is_platform_admin, false)) then raise exception 'member_owner_guard_not_admin");
    expect(f).toContain("if v_touches_owner and coalesce(v_facts.caller_role, '') <> 'owner' then raise exception 'member_owner_guard_not_owner");
    // Foreign rows are refused before the self and facts checks read anything; trust before the session test.
    expect(f.indexOf("member_owner_guard_wrong_org")).toBeLessThan(f.indexOf("member_owner_guard_self_insert"));
    expect(f.indexOf("member_owner_guard_wrong_org")).toBeLessThan(f.indexOf("crm_org_member_caller_facts("));
    expect(f.indexOf("current_user = 'service_role'")).toBeLessThan(f.indexOf("member_owner_guard_no_session"));
  });

  it("the AFTER guard lets GoTrue's cascade through (never asking for authenticated), then keeps at least one owner under the lock", () => {
    const f = fn("public.crm_org_member_last_owner_guard");
    const gone = "if tg_op = 'DELETE' and current_user <> 'authenticated' then if private.crm_org_member_parent_gone(old.org_id, old.user_id) then return null; end if; end if;";
    expect(f).toContain(gone);
    expect(f.indexOf("current_user = 'service_role'")).toBeLessThan(f.indexOf(gone));
    expect(f.indexOf(gone)).toBeLessThan(f.indexOf("member_owner_guard_wrong_org"));
    expect(f).toContain("if old.role is distinct from 'owner' then return null;");
    expect(f).toContain("from private.crm_org_member_caller_facts(true) f;");
    expect(f).toContain("if coalesce(v_facts.owner_count, 0) < 1 then raise exception 'member_owner_guard_last_owner");
  });

  it("every refusal is 42501 with a stable prefix, and every prefix is in the header", () => {
    for (const p of PREFIXES) {
      expect(SQL, p).toMatch(new RegExp(`raise exception '${p}: (?:[^']|'')*' using errcode = '42501'`));
      expect(HEADER, p).toContain(p);
    }
    expect(SQL.match(/errcode = '(\d+)'/g)?.every((m) => m.includes("42501"))).toBe(true);
  });

  it("creates the three triggers idempotently", () => {
    expect(SQL).toContain("create trigger crm_org_member_platform_audit_trg after insert or update or delete on public.crm_org_member");
    expect(SQL).toContain("create trigger crm_org_member_owner_guard_trg before insert or update or delete on public.crm_org_member for each row execute function public.crm_org_member_owner_guard();");
    expect(SQL).toContain("create trigger crm_org_member_last_owner_guard_trg after update or delete on public.crm_org_member for each row execute function public.crm_org_member_last_owner_guard();");
    expect(SQL.match(/if not exists \( select 1 from pg_trigger/g)).toHaveLength(3);
  });

  it("is pinned: any change to the file is deliberate", () => {
    // Changed on purpose (re-review, Nov 23): no argument audit function, SECURITY DEFINER audit trigger with the self-delete skip,
    // NOT VALID + VALIDATE, narrowed parent_gone, the production shape (case 20), case 21, Q3/Q4. Was 4eb22683c0a5bf4c48c49f65552a195f
    // (Taylor's answers), before that 39f9e6208b131b4cd1798db7084a3a6f (8b4d8fc) and b0b8fe095abf6ccb39ced4e398e5c10a.
    expect(createHash("md5").update(raw).digest("hex")).toBe("4d2a91d1a21578ec49528d75c06a91ad");
  });
});
