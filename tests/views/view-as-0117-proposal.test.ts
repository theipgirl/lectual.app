import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The lectual 0117 proposal (owner_view_as_event), text-pinned here until it is copied to the lectual repo (spec acceptance
 * test 18; lectual's own migration-text test repeats these). Nothing here runs SQL.
 */
const raw = readFileSync(path.resolve(__dirname, "../../docs/pge/2026-11-17-agentic-ip-os/0117-proposed.sql.txt"), "utf8");
const SQL = raw
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ");

describe("0117 owner_view_as_event (proposal text)", () => {
  it("is a proposal only", () => {
    expect(raw).toMatch(/^-- =+\n-- PROPOSAL ONLY\. NOT A MIGRATION OF THIS REPO\. NOT APPLIED ANYWHERE/);
  });

  it("lists every error prefix it raises", () => {
    const raised = [...SQL.matchAll(/raise exception '(view_as_[a-z_]+):/g)].map((m) => m[1]);
    expect(new Set(raised)).toEqual(new Set(["view_as_append_only", "view_as_no_delete", "view_as_no_session", "view_as_needs_member_guard", "view_as_not_owner", "view_as_self", "view_as_target_not_member", "view_as_bad_reason"]));
    for (const p of raised) expect(raw.split("ERROR PREFIXES")[1]).toContain(p);
  });

  it("no foreign key on the user columns; the firm cascades", () => {
    expect(SQL).toContain("org_id uuid not null references public.crm_org (id) on delete cascade");
    expect(SQL).toMatch(/actor_id uuid not null, target_user_id uuid not null,/);
    expect(SQL.match(/references /g)).toHaveLength(1);
  });

  it("authenticated: SELECT only; no insert, update or delete; MAINTAIN revoked on PostgreSQL 17", () => {
    expect(SQL).toContain("grant select on public.owner_view_as_event to authenticated;");
    expect(SQL).toContain("revoke insert, update, delete, truncate, references, trigger on public.owner_view_as_event from authenticated;");
    expect(SQL).not.toMatch(/grant (insert|update|delete)[^;]*on public\.owner_view_as_event to authenticated/);
    expect(SQL).toContain("revoke insert, update, delete, truncate, references, trigger on public.owner_view_as_event from service_role;");
    expect(SQL).toContain("if pg_catalog.current_setting('server_version_num')::int >= 170000 then execute 'revoke maintain on public.owner_view_as_event from anon, authenticated, service_role';");
  });

  it("the SELECT policy names the table on both sides and checks current_org_id(), never the role claim", () => {
    const policy = SQL.slice(SQL.indexOf("create policy owner_view_as_event_select_owner"), SQL.indexOf("end $$;", SQL.indexOf("create policy owner_view_as_event_select_owner")));
    expect(policy).toContain("owner_view_as_event.org_id = public.current_org_id()");
    expect(policy).toContain("m.org_id = owner_view_as_event.org_id");
    expect(policy).toContain("m.user_id = auth.uid()");
    expect(policy).toContain("m.role = 'owner'");
    expect(policy).not.toContain("current_org_role");
  });

  it("the 0116 guard check is strict, and state applies it and the close rule", () => {
    expect(SQL).toContain("t.tgname = 'crm_org_member_owner_guard_trg' and t.tgenabled in ('O', 'A') and t.tgfoid = 'public.crm_org_member_owner_guard()'::regprocedure");
    const state = SQL.slice(SQL.indexOf("create or replace function public.owner_view_as_state()"));
    expect(state).toContain("perform public.owner_view_as_require_member_guard();");
    expect(state).toContain("perform public.owner_view_as_close_stale(v_org, v_uid);");
    for (const fn of ["owner_view_as_start(p_target uuid)", "owner_view_as_end(p_reason text)"]) {
      expect(SQL.slice(SQL.indexOf(`create or replace function public.${fn}`)).split("$$;")[0]).toContain("perform public.owner_view_as_require_member_guard();");
    }
  });

  it("is pinned: any change to the file is deliberate", () => {
    // Nov 24 (security review): MAINTAIN revoked behind the PostgreSQL 17 guard, case T7.
    expect(createHash("md5").update(raw).digest("hex")).toBe("ccc5b60563a103b5b17563b24bc486b2");
  });
});
