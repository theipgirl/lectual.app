import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * loadConsultsStrip (Sprint 6): the strip's reads, through mocked meetings libs and a mocked scoped
 * client. The window is 14 days, newest first, five rows and an "N more"; a failed meetings read is
 * `unavailable`; the reads that only decorate a row degrade without hiding the rows.
 */

const NOW = Date.parse("2026-10-20T16:00:00Z");
const TZ = "America/New_York";
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

type M = {
  id: string;
  provider: "zoom" | "fathom";
  title: string;
  started_at: string | null;
  duration_seconds: number | null;
  lead_id: string | null;
  matter_id: string | null;
  has_transcript: boolean;
};
const meeting = (id: string, over: Partial<M> = {}): M => ({
  id,
  provider: "zoom",
  title: `Call ${id}`,
  started_at: day(1),
  duration_seconds: 1800,
  lead_id: "lead-1",
  matter_id: null,
  has_transcript: true,
  ...over,
});

type Opts = {
  meetings?: M[] | "fail";
  conns?: { ok: true; connections: Array<{ provider: "zoom" | "fathom"; status: "active" | "reauth" | "revoked"; last_import_at: string | null }> } | { ok: false };
  leads?: Array<{ id: string; first_name: string | null; last_name: string | null; business_name: string | null }> | "fail";
  markers?: Array<{ payload: Record<string, unknown> }> | "fail";
  matters?: Array<{ id: string; lead_id: string | null }>;
};

async function load(opts: Opts = {}, proposals: Array<{ id: string; leadId: string | null; createdAt: string; source: string }> = []) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = (m: string) => (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return q;
      };
      for (const m of ["select", "eq", "in", "order", "limit"]) q[m] = chain(m);
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        let result: unknown;
        if (table === "crm_lead") result = opts.leads === "fail" ? Promise.reject(new Error("x")) : Promise.resolve({ data: opts.leads ?? [{ id: "lead-1", first_name: "Sana", last_name: "Okafor", business_name: "Northbound Supply" }], error: null });
        else if (table === "crm_activity") result = opts.markers === "fail" ? Promise.reject(new Error("x")) : Promise.resolve({ data: opts.markers ?? [], error: null });
        else if (table === "crm_matter") result = Promise.resolve({ data: opts.matters ?? [], error: null });
        else result = Promise.resolve({ data: [], error: null });
        return (result as Promise<unknown>).then(res, rej);
      };
      return q;
    },
  };
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client) }));
  vi.doMock("@/lib/meetings/read", () => ({
    listMeetings: vi.fn(async () => (opts.meetings === "fail" ? { status: "unavailable" } : { status: "ok", meetings: opts.meetings ?? [meeting("m1")] })),
  }));
  vi.doMock("@/lib/meetings/connection", () => ({
    listMeetingConnections: vi.fn(async () => opts.conns ?? { ok: true, connections: [{ provider: "zoom", status: "active", last_import_at: new Date(NOW - 6 * 60_000).toISOString() }] }),
  }));
  const { loadConsultsStrip } = await import("../../src/lib/proposals/consults-load");
  return { data: await loadConsultsStrip({ now: NOW, tz: TZ, proposals }), calls };
}

describe("loadConsultsStrip", () => {
  beforeEach(() => vi.resetModules());

  it("builds a row from the meeting and its lead: client, company, the design's line", async () => {
    const { data } = await load();
    expect(data.header).toEqual({ title: "Zoom consults", status: { kind: "connected", text: "connected · last sync 6 min ago" } });
    expect(data.meetings).toEqual({
      status: "ok",
      more: 0,
      rows: [
        {
          id: "m1",
          provider: "zoom",
          clientName: "Sana Okafor",
          company: "Northbound Supply",
          line: "Zoom consult · yesterday · 30 min · transcript synced",
          state: "ready",
          proposalId: null,
          leadId: "lead-1",
          matterId: null,
        },
      ],
    });
  });

  it("keeps the last 14 days only, newest first, five rows and the rest as 'more'", async () => {
    const meetings = [
      ...Array.from({ length: 7 }, (_, i) => meeting(`m${i}`, { started_at: day(i + 1) })),
      meeting("old", { started_at: day(15) }),
      meeting("nodate", { started_at: null }),
    ].reverse();
    const { data } = await load({ meetings });
    if (data.meetings.status !== "ok") throw new Error("expected ok");
    expect(data.meetings.rows.map((r) => r.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(data.meetings.more).toBe(2);
  });

  it("no meetings in the window is an ok read with no rows, not unavailable", async () => {
    const { data } = await load({ meetings: [meeting("old", { started_at: day(30) })] });
    expect(data.meetings).toEqual({ status: "ok", rows: [], more: 0 });
  });

  it("a failed meetings read is unavailable, and the header is still read on its own", async () => {
    const { data } = await load({ meetings: "fail" });
    expect(data.meetings).toEqual({ status: "unavailable" });
    expect(data.header.status.kind).toBe("connected");
  });

  it("a failed connections read is its own header line, and the rows still load", async () => {
    const { data } = await load({ conns: { ok: false } });
    expect(data.header.status).toEqual({ kind: "unavailable", text: "connection status couldn't be loaded" });
    expect(data.meetings.status).toBe("ok");
  });

  it("a reauth connection is shown as needing reconnecting", async () => {
    const { data } = await load({ conns: { ok: true, connections: [{ provider: "zoom", status: "reauth", last_import_at: null }] } });
    expect(data.header.status.kind).toBe("reauth");
  });

  it("Drafted from the agent's marker, by meeting id, linking to its proposal", async () => {
    const { data } = await load({ markers: [{ payload: { source: "consult-proposal", meeting_id: "m1", proposal_id: "p-9", queue_id: "q-1" } }] });
    if (data.meetings.status !== "ok") throw new Error("expected ok");
    expect(data.meetings.rows[0]).toMatchObject({ state: "drafted", proposalId: "p-9" });
  });

  it("a marker for another meeting doesn't mark this one", async () => {
    const { data } = await load({ markers: [{ payload: { meeting_id: "m-other", proposal_id: "p-9" } }] });
    if (data.meetings.status !== "ok") throw new Error("expected ok");
    expect(data.meetings.rows[0].state).toBe("ready");
  });

  it("falls back to a proposal for the same lead created after the meeting", async () => {
    const { data } = await load({}, [{ id: "p-fallback", leadId: "lead-1", createdAt: new Date(NOW - 3_600_000).toISOString(), source: "manual" }]);
    if (data.meetings.status !== "ok") throw new Error("expected ok");
    expect(data.meetings.rows[0]).toMatchObject({ state: "drafted", proposalId: "p-fallback" });
  });

  it("a failed marker read falls back instead of hiding the rows", async () => {
    const { data } = await load({ markers: "fail" });
    if (data.meetings.status !== "ok") throw new Error("expected ok");
    expect(data.meetings.rows[0].state).toBe("ready");
  });

  it("a failed lead read falls back to the meeting's title, never an empty name", async () => {
    const { data } = await load({ leads: "fail" });
    if (data.meetings.status !== "ok") throw new Error("expected ok");
    expect(data.meetings.rows[0].clientName).toBe("Call m1");
    expect(data.meetings.rows[0].company).toBeNull();
  });

  it("transcribing and unlinked meetings", async () => {
    const { data } = await load({ meetings: [meeting("m1", { has_transcript: false }), meeting("m2", { lead_id: null, started_at: day(2) })] });
    if (data.meetings.status !== "ok") throw new Error("expected ok");
    expect(data.meetings.rows.map((r) => r.state)).toEqual(["transcribing", "unlinked"]);
    expect(data.meetings.rows[1]).toMatchObject({ clientName: "Call m2", leadId: null });
  });

  it("uses the matter's lead for a meeting linked only to a matter", async () => {
    const { data, calls } = await load({ meetings: [meeting("m1", { lead_id: null, matter_id: "mat-1" })], matters: [{ id: "mat-1", lead_id: "lead-1" }] });
    if (data.meetings.status !== "ok") throw new Error("expected ok");
    expect(data.meetings.rows[0]).toMatchObject({ state: "ready", leadId: "lead-1", clientName: "Sana Okafor" });
    expect(calls.some((c) => c.table === "crm_matter")).toBe(true);
  });

  it("reads only through the scoped client, and only the columns it names", async () => {
    const { calls } = await load({ markers: [] });
    const selects = calls.filter((c) => c.method === "select").map((c) => `${c.table}:${c.args[0]}`);
    expect(selects).toContain("crm_lead:id, first_name, last_name, business_name");
    expect(selects).toContain("crm_activity:payload");
    expect(selects.some((s) => s.endsWith(":*"))).toBe(false);
  });
});
