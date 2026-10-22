import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The live loader driven through a fake scoped client that records every call.
 * Nothing in the loader may insert, update, upsert or delete, and the only
 * rpc is the member directory read.
 */
const calls: string[] = [];
const tables: Record<string, { data: unknown; error: unknown }> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const record = (name: string) => (...args: unknown[]) => {
    calls.push(`${table}.${name}${name === "select" ? `(${String(args[0] ?? "")})` : ""}`);
    return b;
  };
  for (const m of ["select", "order", "eq", "neq", "limit", "insert", "update", "upsert", "delete"]) b[m] = record(m);
  const result = () => tables[table] ?? { data: [], error: null };
  b.maybeSingle = () => {
    calls.push(`${table}.maybeSingle`);
    const r = result();
    return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
  };
  b.then = (resolve: (v: unknown) => unknown) => resolve(result());
  return b;
}

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: (t: string) => {
      calls.push(`from(${t})`);
      return builder(t);
    },
    rpc: (name: string) => {
      calls.push(`rpc(${name})`);
      return Promise.resolve({ data: [{ user_id: "u1", email: null, display_name: null, role: "owner" }, { user_id: "u2", email: null, display_name: null, role: "admin" }], error: null });
    },
  }),
}));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    crm_org: { data: { modules: ["mailbox", "agents"] }, error: null },
    crm_org_profile: { data: { display_name: "Hartwell IP", email_signature: "Best", time_zone: "America/New_York" }, error: null },
    mailbox_connection: { data: [{ provider: "microsoft", status: "active" }], error: null },
    lawmatics_connection: { data: { status: "active" }, error: null },
    meeting_source_connection: { data: [{ provider: "zoom", status: "active" }], error: null },
    lawpay_connection: { data: { id: "1", org_id: "o", status: "active", mode: "test", accounts: [], created_at: "2026-01-01" }, error: null },
    agent_setting: { data: [{ agent: "email-intel", enabled: true }], error: null },
    crm_intake_form: { data: [{ id: "f1", name: "Main", slug: "main", status: "live", config: {} }], error: null },
    crm_service_item: { data: [{ active: true, kind: "legal_fee" }], error: null },
  });
});

async function load() {
  const { loadSetupState } = await import("@/lib/setup/load");
  return loadSetupState();
}

describe("loadSetupState (live readers, fake scoped client)", () => {
  it("reads the caller's firm through the scoped client and finds everything done", async () => {
    const { setupChecklist } = await import("@/lib/setup/checklist");
    const state = await load();
    expect(setupChecklist(state)).toMatchObject({ doneCount: 10, complete: true });
  });

  it("writes nothing: no insert, update, upsert or delete, and the only rpc is the member directory", async () => {
    await load();
    expect(calls.length).toBeGreaterThan(8);
    expect(calls.filter((c) => /\.(insert|update|upsert|delete)\b/.test(c))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("rpc(")).sort()).toEqual(["rpc(org_member_directory)"]);
  });

  it("names its columns on the tables with sealed columns", async () => {
    await load();
    for (const t of ["mailbox_connection", "lawmatics_connection", "lawpay_connection", "meeting_source_connection"]) {
      const selects = calls.filter((c) => c.startsWith(`${t}.select(`));
      expect(selects.length, t).toBeGreaterThan(0);
      for (const s of selects) expect(s, s).not.toMatch(/\(\*?\)$/);
    }
  });

  it("a database error on the module list is 'could not be read', not 'no modules'", async () => {
    tables.crm_org = { data: null, error: { message: "relation crm_org_secret_idx violates 23505", code: "23505" } };
    const { setupChecklist } = await import("@/lib/setup/checklist");
    const state = await load();
    expect(state.modules).toEqual({ ok: false });
    const items = setupChecklist(state).items;
    expect(items.find((i) => i.id === "outlook")!.status).toBe("couldnt-check");
    expect(items.find((i) => i.id === "agents")!.status).toBe("couldnt-check");
    expect(JSON.stringify(state)).not.toContain("crm_org_secret_idx");
  });

  it("a database error carrying a secret never reaches the state, and the other items are unaffected", async () => {
    tables.agent_setting = { data: null, error: { message: "duplicate key org 7d2e6a14-0000-4000-8000-000000000001 agent_setting_pkey", code: "23505" } };
    tables.lawpay_connection = { data: null, error: { message: "agent_setting_pkey 7d2e6a14", code: "XX000" } };
    const state = await load();
    expect(state.agents).toEqual({ ok: false });
    expect(state.lawpay).toEqual({ ok: false });
    expect(state.lawmatics.ok).toBe(true);
    expect(state.intakeForms.ok).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/7d2e6a14|agent_setting_pkey/);
  });

  it("a missing intake table (unconfigured) is 'could not be read'", async () => {
    tables.crm_intake_form = { data: null, error: { message: "relation does not exist", code: "42P01" } };
    expect((await load()).intakeForms).toEqual({ ok: false });
  });
});
