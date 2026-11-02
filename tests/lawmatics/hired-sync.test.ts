import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/intake-forms/lawmatics-sync", () => ({ firmToken: async () => "tok" }));

const { runHiredSync } = await import("@/lib/lawmatics/hired-sync");

type Row = Record<string, unknown>;

function fakeAdmin(opts: { connections?: Row[]; matters?: Row[]; failInsertFor?: string[] } = {}) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const updates: Array<{ table: string; patch: Row; filters: Row }> = [];
  const connections = opts.connections ?? [{ id: "c1", org_id: "org-from-connection" }];
  const tables: Record<string, Row[]> = {
    lawmatics_connection: connections,
    crm_matter: opts.matters ?? [],
    crm_lead: [],
    crm_matter_stage: [{ id: "st1", label: "Signed LOE / Deposit Received" }],
  };
  const seenOrgFilters: string[] = [];
  const from = (table: string) => {
    let op: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    const filters: Row = {};
    const b: Record<string, unknown> = {};
    const result = () => {
      if (op === "insert") {
        if (table === "crm_matter" && opts.failInsertFor?.includes(String(payload.title))) return { data: null, error: { code: "23505" } };
        inserts.push({ table, row: payload });
        return { data: { id: `new-${inserts.length}` }, error: null };
      }
      if (op === "update") {
        updates.push({ table, patch: payload, filters });
        return { data: [{ id: filters.id }], error: null };
      }
      if (filters.org_id) seenOrgFilters.push(String(filters.org_id));
      return { data: tables[table] ?? [], error: null };
    };
    for (const k of ["select", "order", "range"]) b[k] = () => b;
    b.insert = (r: Row) => ((op = "insert"), (payload = r), b);
    b.update = (r: Row) => ((op = "update"), (payload = r), b);
    b.eq = (k: string, v: unknown) => ((filters[k] = v), b);
    b.is = (k: string, v: unknown) => ((filters[`${k}:is`] = v), b);
    b.single = () => Promise.resolve(result());
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return b;
  };
  return { admin: { from } as never, inserts, updates, seenOrgFilters };
}

const rec = (id: string, title: string, name = "Ada Lovelace"): Row => ({
  id,
  attributes: { name, status: "hired", converted_date: "2026-11-03", case_title: title, case_number: id, custom_fields: [{ name: "Practice Area", value: "Trademark" }] },
});

function lm(pages: { prospects: Row[]; truncated?: boolean }) {
  return {
    get: async () => ({}),
    listAll: async (path: string) =>
      path === "/practice_areas"
        ? { records: [], included: new Map(), truncated: false }
        : { records: pages.prospects, included: new Map(), truncated: !!pages.truncated },
  } as never;
}

describe("runHiredSync", () => {
  it("creates matters stamped with the CONNECTION's org_id and logs matter_opened", async () => {
    const f = fakeAdmin();
    const s = await runHiredSync({ admin: f.admin, client: () => lm({ prospects: [rec("1", "ALPHA")] }), getToken: async () => "t" });
    expect(s).toMatchObject({ connections: 1, created: 1, failedFirms: 0 });
    const matter = f.inserts.find((i) => i.table === "crm_matter")!.row;
    expect(matter).toMatchObject({ org_id: "org-from-connection", status: "open", lawmatics_id: "1", stage_id: "st1" });
    expect(matter.stage_entered_at).toBeTruthy();
    expect(matter.lawmatics_synced_at).toBeTruthy();
    const act = f.inserts.find((i) => i.table === "crm_activity")!.row;
    expect(act).toMatchObject({ org_id: "org-from-connection", type: "matter_opened", actor_type: "system" });
    expect(act.payload).toEqual({ summary: "Matter added from Lawmatics (hired)", source: "lawmatics-sync", lawmatics_id: "1" });
    expect(f.seenOrgFilters.every((o) => o === "org-from-connection")).toBe(true);
  });

  it("a truncated Lawmatics read creates nothing and counts a failed firm", async () => {
    const f = fakeAdmin();
    const s = await runHiredSync({ admin: f.admin, client: () => lm({ prospects: [rec("1", "ALPHA")], truncated: true }), getToken: async () => "t" });
    expect(s.created).toBe(0);
    expect(s.failedFirms).toBe(1);
    expect(f.inserts).toHaveLength(0);
  });

  it("a firm with no usable token is a failed firm and writes nothing", async () => {
    const f = fakeAdmin();
    const s = await runHiredSync({ admin: f.admin, client: () => lm({ prospects: [rec("1", "ALPHA")] }), getToken: async () => null });
    expect(s.failedFirms).toBe(1);
    expect(f.inserts).toHaveLength(0);
  });

  it("one failed insert does not stop the rest", async () => {
    const f = fakeAdmin({ failInsertFor: ["BETA"] });
    const s = await runHiredSync({
      admin: f.admin,
      client: () => lm({ prospects: [rec("1", "ALPHA"), rec("2", "BETA"), rec("3", "GAMMA")] }),
      getToken: async () => "t",
    });
    expect(s.created).toBe(2);
    expect(s.failedWrites).toBe(1);
    expect(s.failedFirms).toBe(0);
  });

  it("links an unlinked matter, guarded by lawmatics_id IS NULL, and logs matter_updated", async () => {
    const f = fakeAdmin({ matters: [{ id: "m9", owner_name: "Ada Lovelace", title: "ALPHA", mark_text: null, matter_number: "TM-1", lawmatics_id: null }] });
    const s = await runHiredSync({ admin: f.admin, client: () => lm({ prospects: [rec("1", "ALPHA")] }), getToken: async () => "t" });
    expect(s).toMatchObject({ created: 0, linked: 1 });
    expect(f.updates[0].patch).toMatchObject({ lawmatics_id: "1" });
    expect(Object.keys(f.updates[0].patch).sort()).toEqual(["lawmatics_id", "lawmatics_synced_at"]);
    expect(f.updates[0].filters).toMatchObject({ id: "m9", org_id: "org-from-connection", "lawmatics_id:is": null });
    expect(f.inserts.find((i) => i.table === "crm_activity")!.row.type).toBe("matter_updated");
  });
});
