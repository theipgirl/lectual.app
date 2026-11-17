import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_BOM, CSV_MAX_ROWS } from "@/lib/intake-forms/csv";
import { boothRow, mockScopedDb, newDb } from "./helpers/forms-db";
import type { FakeDb } from "../matters/helpers/fake-db";

/** Event CSV: every status, formula prefixing, and never a header-only file on a failed read. */

const lead = (id: string, first: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: "org-1",
  first_name: first,
  last_name: "Tester",
  business_name: "Tester Studio",
  email: `${first.toLowerCase()}@example.test`,
  phone: "555-0100",
  ...over,
});

const tables = () => ({
  crm_booth_scorecard: [
    boothRow("c1", { lead_id: "l1", score: 40, band: "partial", temperature: "hot", gaps: ["Gap A.", "Gap B."], created_at: "2026-11-15T19:42:00Z", completed_at: "2026-11-15T19:46:00Z" }),
    boothRow("c2", { lead_id: "l2", created_at: "2026-11-14T10:00:00Z" }),
    boothRow("c3", { lead_id: "gone", created_at: "2026-11-13T10:00:00Z" }),
    boothRow("o1", { org_id: "org-2", lead_id: "l9" }),
  ],
  crm_lead: [lead("l1", "=Ada", { business_name: "Quill, Inc" }), lead("l2", "Bo")],
});

async function get(db: FakeDb, query: string, opts: Parameters<typeof mockScopedDb>[1] = {}) {
  vi.resetModules();
  mockScopedDb(db, opts);
  const { GET } = await import("../../src/app/dashboard/forms/event-export/route");
  return GET(new Request(`https://app.example.test/dashboard/forms/event-export/?${query}`));
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.doUnmock("@/lib/db/scoped-client"));

describe("event CSV", () => {
  it("401 signed out, 403 for roles that can't export", async () => {
    expect((await get(newDb(tables()), "event=urban-golf-2026", { signedIn: false })).status).toBe(401);
    for (const role of ["viewer", "social_media"]) expect((await get(newDb(tables(), role), "event=urban-golf-2026")).status, role).toBe(403);
  });

  it("403 when the role can't be read (fails closed)", async () => {
    const noRole = newDb(tables());
    noRole.role = null;
    expect((await get(noRole, "event=urban-golf-2026")).status).toBe(403);
    const odd = newDb(tables(), "wizard");
    expect((await get(odd, "event=urban-golf-2026")).status).toBe(403);
  });

  it("200 for every role that may export", async () => {
    const { ROLES } = await import("@/lib/auth/roles");
    const { canExportCsv } = await import("@/lib/intake-forms/export-csv");
    for (const role of ROLES.filter((r) => canExportCsv(r))) expect((await get(newDb(tables(), role), "event=urban-golf-2026")).status, role).toBe(200);
  });

  it("400 for a hostile code (quote, CR/LF, slash, space): it never reaches the filename", async () => {
    for (const bad of ['urban"golf', "urban%0D%0AX-Evil:%201", "a%2Fb", "a%20b", "a;b"]) {
      const res = await get(newDb(tables()), `event=${bad}`);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get("content-disposition"), bad).toBeNull();
    }
  });

  it("400 for a missing or over-long code", async () => {
    expect((await get(newDb(tables()), "")).status).toBe(400);
    expect((await get(newDb(tables()), `event=${"x".repeat(121)}`)).status).toBe(400);
  });

  it("404 when the firm has no cards for the code, including a code only another firm has", async () => {
    expect((await get(newDb(tables()), "event=nope")).status).toBe(404);
    const db = newDb({ ...tables(), crm_booth_scorecard: [boothRow("z", { org_id: "org-2", event_code: "their-event" })] });
    expect((await get(db, "event=their-event")).status).toBe(404);
  });

  it("returns the people as a CSV with the right columns, prefixing, quoting and filename", async () => {
    const res = await get(newDb(tables()), "event=urban-golf-2026");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="urban-golf-2026-results.csv"');
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_BOM).toBe("\ufeff");
    const body = "\ufeff" + (await res.text());
    const lines = body.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Name,Email,Phone,Business,Taken at (UTC),Score,Band,Temperature,Finished,Gaps");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`'=Ada Tester,'=ada@example.test,555-0100,"Quill, Inc",2026-11-15T19:42:00.000Z`.replace(".000Z", "Z") + ",40,partial,hot,Yes,Gap A.; Gap B.");
    expect(lines[2]).toContain("Bo Tester,bo@example.test");
    expect(lines[2]).toContain(",No,");
    expect(lines[3].startsWith("Lead not available,")).toBe(true);
  });

  it("503 for a missing table, 500 for a failed card or lead read: never a header-only file", async () => {
    const missing = newDb(tables());
    missing.fail("crm_booth_scorecard", "select", { code: "42P01", message: "x" });
    expect((await get(missing, "event=urban-golf-2026")).status).toBe(503);
    for (const table of ["crm_booth_scorecard", "crm_lead"]) {
      const db = newDb(tables());
      db.fail(table, "select");
      const res = await get(db, "event=urban-golf-2026");
      expect(res.status, table).toBe(500);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const body = await res.text();
      expect(body).not.toContain("Name,Email");
      expect(body).not.toContain("message");
    }
  });

  it("413 over the ceiling", async () => {
    const many = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => boothRow(`m${i}`, { lead_id: "l2" }));
    const res = await get(newDb({ crm_booth_scorecard: many, crm_lead: tables().crm_lead }), "event=urban-golf-2026");
    expect(res.status).toBe(413);
  }, 60_000);
});
