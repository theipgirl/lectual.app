import { beforeEach, describe, expect, it, vi } from "vitest";
import { storedConsult } from "./fixtures";

/**
 * The three Outlook readers through a mocked scoped client. The admin client is
 * mocked to explode if anything touches it: these reads are RLS-scoped only.
 */

type Outcome = { data?: unknown; error?: { code?: string; message: string } | null } | "throws";
let outcome: Outcome | ((table: string) => Outcome) = { data: [], error: null };
const queries: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
const clientRequests = { scoped: 0 };

function builder(table: string) {
  const rec = { table, calls: [] as Array<[string, unknown[]]> };
  queries.push(rec);
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lt", "in", "order", "limit"]) {
    q[m] = (...args: unknown[]) => {
      rec.calls.push([m, args]);
      return q;
    };
  }
  q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
    const o = typeof outcome === "function" ? outcome(table) : outcome;
    if (o === "throws") return Promise.reject(new Error("socket hang up")).then(ok, bad);
    return Promise.resolve({ data: o.data ?? null, error: o.error ?? null }).then(ok, bad);
  };
  return q;
}

beforeEach(() => {
  vi.resetModules();
  queries.length = 0;
  clientRequests.scoped = 0;
  outcome = { data: [], error: null };
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => {
      clientRequests.scoped += 1;
      return { from: (t: string) => builder(t) };
    }),
  }));
  vi.doMock("@/lib/db/admin", () => {
    throw new Error("the admin client must not be used by a read");
  });
});

const NOW = new Date("2026-10-21T12:00:00Z");

async function readers() {
  return import("@/lib/calendar/outlook-read");
}

const calls = (q: { calls: Array<[string, unknown[]]> }, name: string) => q.calls.filter(([m]) => m === name).map(([, a]) => a);

describe("F15: listOutlookCalendarEvents", () => {
  it("ok with events", async () => {
    outcome = { data: [storedConsult()], error: null };
    const { listOutlookCalendarEvents } = await readers();
    const r = await listOutlookCalendarEvents("2026-10-18", "2026-10-24");
    expect(r).toEqual({ status: "ok", events: [storedConsult()] });
    expect(queries[0].table).toBe("crm_calendar_event");
    expect(calls(queries[0], "eq")).toContainEqual(["source", "outlook"]);
  });

  it("ok with an empty list only when the query succeeded with no rows", async () => {
    outcome = { data: [], error: null };
    const { listOutlookCalendarEvents } = await readers();
    expect(await listOutlookCalendarEvents("2026-10-18", "2026-10-24")).toEqual({ status: "ok", events: [] });
  });

  it("unavailable when the query errors or throws", async () => {
    const { listOutlookCalendarEvents } = await readers();
    outcome = { data: null, error: { code: "57014", message: "statement timeout" } };
    expect(await listOutlookCalendarEvents("2026-10-18", "2026-10-24")).toEqual({ status: "unavailable" });
    outcome = "throws";
    expect(await listOutlookCalendarEvents("2026-10-18", "2026-10-24")).toEqual({ status: "unavailable" });
  });

  it("database-update-needed for a missing column, by code or by wording", async () => {
    const { listOutlookCalendarEvents } = await readers();
    outcome = { data: null, error: { code: "42703", message: "column crm_calendar_event.source does not exist" } };
    expect(await listOutlookCalendarEvents("2026-10-18", "2026-10-24")).toEqual({ status: "database-update-needed" });
    outcome = { data: null, error: { message: "Could not find the 'join_url' column of 'crm_calendar_event' in the schema cache" } };
    expect(await listOutlookCalendarEvents("2026-10-18", "2026-10-24")).toEqual({ status: "database-update-needed" });
  });
});

describe("F15: loadBookedConsult", () => {
  it("asks for this lead's earliest consult from now on", async () => {
    outcome = { data: [storedConsult()], error: null };
    const { loadBookedConsult } = await readers();
    const r = await loadBookedConsult("lead-amara", NOW);
    expect(r).toEqual({ status: "ok", event: storedConsult() });
    const q = queries[0];
    expect(calls(q, "eq")).toEqual(expect.arrayContaining([["lead_id", "lead-amara"], ["is_consult", true], ["source", "outlook"]]));
    expect(calls(q, "gte")).toContainEqual(["starts_at", NOW.toISOString()]);
    expect(calls(q, "order")[0]).toEqual(["starts_at", { ascending: true }]);
    expect(calls(q, "limit")[0]).toEqual([1]);
  });

  it("ok with event null only when the query succeeded with no rows", async () => {
    const { loadBookedConsult } = await readers();
    outcome = { data: [], error: null };
    expect(await loadBookedConsult("lead-amara", NOW)).toEqual({ status: "ok", event: null });
  });

  it("unavailable on an error or a throw; database-update-needed on a missing column", async () => {
    const { loadBookedConsult } = await readers();
    outcome = { data: null, error: { code: "XX000", message: "boom" } };
    expect(await loadBookedConsult("l", NOW)).toEqual({ status: "unavailable" });
    outcome = "throws";
    expect(await loadBookedConsult("l", NOW)).toEqual({ status: "unavailable" });
    outcome = { data: null, error: { code: "42703", message: "column lead_id does not exist" } };
    expect(await loadBookedConsult("l", NOW)).toEqual({ status: "database-update-needed" });
  });
});

describe("F15: loadConsultsForToday", () => {
  const at = (iso: string, id: string, over = {}) => storedConsult({ id, starts_at: iso, ...over });

  it("keeps consults from today (firm zone) to 7 days out, soonest first, capped at 8, with lead names", async () => {
    // 2026-10-21 12:00Z is 08:00 on the 21st in New York.
    const rows = [
      at("2026-10-21T03:00:00Z", "last-night"), // 23:00 on the 20th in New York: not today
      at("2026-10-21T14:00:00Z", "today"),
      at("2026-10-28T15:00:00Z", "day-7"),
      at("2026-10-29T15:00:00Z", "day-8"),
    ];
    outcome = { data: rows, error: null };
    const { loadConsultsForToday } = await readers();
    const r = await loadConsultsForToday(NOW, "America/New_York");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consults.map((c) => c.id)).toEqual(["today", "day-7"]);

    const many = Array.from({ length: 12 }, (_, i) => at(`2026-10-22T${String(10 + i).padStart(2, "0")}:00:00Z`, `c${i}`));
    outcome = { data: many, error: null };
    const capped = await loadConsultsForToday(NOW, "America/New_York");
    expect(capped.status === "ok" && capped.consults).toHaveLength(8);
  });

  it("names the linked lead from the firm's own lead row", async () => {
    outcome = (table) =>
      table === "crm_lead"
        ? { data: [{ id: "lead-amara", first_name: "Amara", last_name: "Nwosu", business_name: null, email: "a@x.org" }], error: null }
        : { data: [at("2026-10-22T15:00:00Z", "c1")], error: null };
    const { loadConsultsForToday } = await readers();
    const r = await loadConsultsForToday(NOW, "America/New_York");
    expect(r.status === "ok" && r.consults[0].lead_name).toBe("Amara Nwosu");
    expect(queries.map((q) => q.table)).toEqual(["crm_calendar_event", "crm_lead"]);
  });

  it("a lead-name failure still lists the consult, without a name", async () => {
    outcome = (table) => (table === "crm_lead" ? { data: null, error: { message: "denied" } } : { data: [at("2026-10-22T15:00:00Z", "c1")], error: null });
    const { loadConsultsForToday } = await readers();
    const r = await loadConsultsForToday(NOW, "America/New_York");
    expect(r.status === "ok" && r.consults).toMatchObject([{ id: "c1", lead_id: "lead-amara", lead_name: null }]);
  });

  it("ok with an empty list only for a successful read; unavailable on error or throw; database-update-needed on a missing column", async () => {
    const { loadConsultsForToday } = await readers();
    outcome = { data: [], error: null };
    expect(await loadConsultsForToday(NOW, "America/New_York")).toEqual({ status: "ok", consults: [] });
    outcome = { data: null, error: { code: "XX000", message: "boom" } };
    expect(await loadConsultsForToday(NOW, "America/New_York")).toEqual({ status: "unavailable" });
    outcome = "throws";
    expect(await loadConsultsForToday(NOW, "America/New_York")).toEqual({ status: "unavailable" });
    outcome = { data: null, error: { code: "42703", message: "column is_consult does not exist" } };
    expect(await loadConsultsForToday(NOW, "America/New_York")).toEqual({ status: "database-update-needed" });
  });
});

describe("F15: the scoped client is the only client", () => {
  it("never loads the admin module, and the source imports none", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/calendar/outlook-read.ts", "utf8");
    expect(src).not.toMatch(/db\/admin|getAdminClient|SERVICE_ROLE/);
    expect(src).toContain("getScopedClient");
    const { loadBookedConsult } = await readers();
    await loadBookedConsult("l", NOW);
    expect(clientRequests.scoped).toBe(1);
  });
});
