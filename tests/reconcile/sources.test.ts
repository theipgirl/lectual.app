import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LawmaticsClient } from "../../src/lib/lawmatics/client";
import { OTHER_ORG, S, SECRET, STAGES } from "./helpers";
import { L, foreignLead, lawmaticsStub, leadRow, makeWorld } from "./world";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");

async function load(connection: { client?: () => Promise<LawmaticsClient> } = {}) {
  vi.resetModules();
  vi.doMock("@/lib/lawmatics/connection", async (orig) => ({
    ...(await orig<typeof import("../../src/lib/lawmatics/connection")>()),
    firmLawmaticsClient: connection.client ?? (async () => {
      throw new Error("not mocked");
    }),
  }));
  return import("../../src/lib/reconcile/sources");
}

describe("readStages", () => {
  it("returns the firm's stages in pipeline order, and none from another firm", async () => {
    const world = makeWorld({ stages: [...makeWorld().db.rows("crm_stage"), { id: "zz", org_id: OTHER_ORG, name: "Elsewhere", category: "open", order_index: 0 }] });
    const { readStages } = await load();
    const stages = await readStages(world.client as never);
    expect(stages.map((s) => s.name)).toEqual(STAGES.map((s) => s.name));
    expect(stages[7]).toEqual({ id: S.signed, name: "Signed LOE / Deposit Received", category: "won", orderIndex: 7 });
  });

  it("throws on a failed read, never returning an empty list", async () => {
    const world = makeWorld();
    world.db.fail("crm_stage", "select");
    const { readStages } = await load();
    await expect(readStages(world.client as never)).rejects.toBeTruthy();
  });
});

describe("readLeads", () => {
  it("maps the columns it names and hides another firm's leads", async () => {
    const world = makeWorld({ leads: [leadRow({ id: L.amara, first_name: "Amara", last_name: "Nwosu", sheet_key: "k1", lawmatics_id: "77" }), foreignLead()] });
    const { readLeads } = await load();
    const read = await readLeads(world.client as never);
    expect(read.truncated).toBe(false);
    expect(read.leads).toEqual([
      { id: L.amara, firstName: "Amara", lastName: "Nwosu", email: "0001@intake.invalid", currentStageId: S.pnc, sheetKey: "k1", lawmaticsId: "77", practiceArea: null },
    ]);
    const [, columns] = world.db.selects.find(([t]) => t === "crm_lead")!;
    expect(columns).not.toContain("*");
  });

  it("pages past the 1,000-row default", async () => {
    const leads = Array.from({ length: 2350 }, (_, i) => leadRow({ id: `22222222-0000-4000-8000-${String(i).padStart(12, "0")}`, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
    const world = makeWorld({ leads });
    const { readLeads } = await load();
    const read = await readLeads(world.client as never);
    expect(read.leads).toHaveLength(2350);
    expect(read.truncated).toBe(false);
    expect(new Set(read.leads.map((l) => l.id)).size).toBe(2350);
  });

  it("stops at the cap and says the list was cut short", async () => {
    const leads = Array.from({ length: 10_050 }, (_, i) => leadRow({ id: `33333333-0000-4000-8000-${String(i).padStart(12, "0")}`, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 1000).toISOString() }));
    const world = makeWorld({ leads });
    const { readLeads, LEAD_CAP } = await load();
    const read = await readLeads(world.client as never);
    expect(read.leads).toHaveLength(LEAD_CAP);
    expect(read.truncated).toBe(true);
  });

  it("throws on a failed read", async () => {
    const world = makeWorld({ leads: [leadRow({ id: L.amara })] });
    world.db.fail("crm_lead", "select");
    const { readLeads } = await load();
    await expect(readLeads(world.client as never)).rejects.toBeTruthy();
  });
});

describe("readStoredMail", () => {
  const mail = (leadId: string, i: number, payload: Record<string, unknown> = {}) => ({
    id: `m-${leadId.slice(-3)}-${i}`,
    org_id: "aaaaaaaa-0000-4000-8000-000000000001",
    lead_id: leadId,
    type: "email_sent",
    payload: { type: "loe-invoice", sensitive: false, at: "2026-09-01T10:00:00Z", ...payload },
    created_at: "2026-09-02T00:00:00Z",
  });

  it("reads classification, sensitivity and date from the stored payload", async () => {
    const world = makeWorld({
      activity: [
        mail(L.amara, 1),
        mail(L.amara, 2, { type: "other", sensitive: true, at: "2026-09-03T10:00:00Z" }),
        { ...mail(L.kwame, 3), type: "note" },
        { ...mail(L.priya, 4), payload: {}, created_at: "2026-08-01T00:00:00Z" },
      ],
    });
    const { readStoredMail } = await load();
    const read = await readStoredMail(world.client as never, [L.amara, L.kwame, L.priya]);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.byLead.get(L.amara)).toEqual([
      { type: "other", sensitive: true, at: "2026-09-03T10:00:00Z" },
      { type: "loe-invoice", sensitive: false, at: "2026-09-01T10:00:00Z" },
    ]);
    expect(read.byLead.has(L.kwame)).toBe(false); // a note is not mail
    expect(read.byLead.get(L.priya)).toEqual([{ type: null, sensitive: false, at: "2026-08-01T00:00:00Z" }]);
    expect(read.total).toBe(3);
  });

  it("reads past one page of mail and across batches of leads", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => mail(L.amara, i));
    const world = makeWorld({ activity: many });
    const { readStoredMail } = await load();
    const ids = Array.from({ length: 120 }, (_, i) => (i === 0 ? L.amara : `44444444-0000-4000-8000-${String(i).padStart(12, "0")}`));
    const read = await readStoredMail(world.client as never, ids);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.byLead.get(L.amara)).toHaveLength(1200);
    expect(world.db.selects.filter(([t]) => t === "crm_activity").length).toBeGreaterThanOrEqual(4);
  });

  it("a failed read is unavailable, with a sentence that holds no database text", async () => {
    const world = makeWorld({ activity: [mail(L.amara, 1)] });
    world.db.fail("crm_activity", "select", { code: "XX000", message: SECRET });
    const { readStoredMail } = await load();
    const read = await readStoredMail(world.client as never, [L.amara]);
    expect(read.status).toBe("unavailable");
    expect(JSON.stringify(read)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });

  it("more mail than it will read for one batch is unavailable, not a partial answer", async () => {
    const world = makeWorld({ activity: Array.from({ length: 10_001 }, (_, i) => mail(L.amara, i)) });
    const { readStoredMail } = await load();
    expect((await readStoredMail(world.client as never, [L.amara])).status).toBe("unavailable");
  });

  it("asks for nothing when there are no leads", async () => {
    const world = makeWorld();
    const { readStoredMail } = await load();
    expect(await readStoredMail(world.client as never, [])).toEqual({ status: "ok", byLead: new Map(), total: 0 });
    expect(world.db.froms).toEqual([]);
  });
});

describe("readLawmatics", () => {
  it("reads the firm's book with read operations only", async () => {
    const stub = lawmaticsStub();
    const { readLawmatics } = await load({ client: async () => stub.client });
    const read = await readLawmatics();
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.records[0]).toMatchObject({ lawmaticsId: "100", stageName: "Consultation Scheduled" });
    expect(Object.keys(stub.client).sort()).toEqual(["get", "listAll"]);
    expect(stub.calls.every((c) => c.method === "listAll" || c.method === "get")).toBe(true);
    expect(stub.calls.map((c) => c.path).sort()).toEqual(["/contacts", "/prospects"]);
  });

  it("not connected is its own state, with the connection's own sentence", async () => {
    const { readLawmatics } = await load({
      client: async () => {
        const { LawmaticsNotConnectedError } = await import("../../src/lib/lawmatics/connection");
        throw new LawmaticsNotConnectedError();
      },
    });
    const read = await readLawmatics();
    expect(read).toEqual({ status: "not-connected", reason: expect.stringContaining("isn't connected") });
  });

  it("a failing pull is unavailable, and carries nothing from the error", async () => {
    const { readLawmatics } = await load({
      client: async () => {
        throw new Error(SECRET);
      },
    });
    const read = await readLawmatics();
    expect(read.status).toBe("unavailable");
    expect(JSON.stringify(read)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });

  it("a truncated pull is unavailable (incomplete), not a smaller book", async () => {
    const stub = lawmaticsStub({ truncated: true });
    const { readLawmatics } = await load({ client: async () => stub.client });
    const read = await readLawmatics();
    expect(read.status).toBe("unavailable");
    expect(JSON.stringify(read)).toContain("only part");
    expect(JSON.stringify(read)).not.toContain(SECRET);
  });

  it("a pull that lost its stage relationships is unavailable", async () => {
    const stub = lawmaticsStub({ includeDropped: true });
    const { readLawmatics } = await load({ client: async () => stub.client });
    const read = await readLawmatics();
    expect(read.status).toBe("unavailable");
    expect(JSON.stringify(read)).not.toContain(SECRET);
  });

  it("a failed contacts fetch makes the pull incomplete, so it is unavailable too", async () => {
    const stub = lawmaticsStub({ contactsFail: true });
    const { readLawmatics } = await load({ client: async () => stub.client });
    expect((await readLawmatics()).status).toBe("unavailable");
  });
});
