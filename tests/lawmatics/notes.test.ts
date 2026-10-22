import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTES_MAX_RECORDS, readLawmaticsNotes } from "@/lib/lawmatics/notes";
import { createLawmaticsClient, type LawmaticsClient, type ListResult } from "@/lib/lawmatics/client";
import { SNIPPET_MAX } from "@/lib/reconcile/milestones";

/**
 * Lawmatics notes as evidence: read-only, swept page by page, bounded per run, classified in memory.
 * The Lawmatics API is a fake here; its real `/notes` shape is not verified (see notes.ts).
 */

afterEach(() => vi.restoreAllMocks());

const note = (over: Record<string, unknown> = {}) => ({
  type: "note",
  id: String(Math.random()),
  attributes: { name: "", body: "consult done, sent proposal", notable_id: "p1", notable_type: "Prospect", created_at: "2026-10-16T14:00:00Z", ...over },
});

function fakeClient(handler: (path: string, params: Record<string, string>) => { records: unknown[]; truncated?: boolean } | Error) {
  const calls: Array<{ method: "get" | "listAll"; path: string; params: Record<string, string> }> = [];
  const client: LawmaticsClient = {
    get: async (path, params) => {
      calls.push({ method: "get", path, params: params ?? {} });
      return {};
    },
    listAll: async (path, opts): Promise<ListResult> => {
      const params = opts?.params ?? {};
      calls.push({ method: "listAll", path, params });
      const out = handler(path, params);
      if (out instanceof Error) throw out;
      return { records: out.records as never, included: new Map(), pagesFetched: 1, truncated: out.truncated ?? false, includeDropped: false };
    },
  };
  return { client, calls };
}

describe("readLawmaticsNotes", () => {
  it("asks only for the person's notes, with GET and nothing else", async () => {
    const { client, calls } = fakeClient(() => ({ records: [note()] }));
    await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }]);
    expect(calls).toEqual([{ method: "listAll", path: "/notes", params: { "filter[notable_id]": "p1", "filter[notable_type]": "Prospect" } }]);
    expect(Object.keys(client).sort()).toEqual(["get", "listAll"]);
  });

  it("through the real client every request is a GET (the fake fetch sees no other method)", async () => {
    const seen: Array<string | undefined> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: Record<string, unknown>) => {
      seen.push(init?.method as string | undefined);
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ data: [note()], meta: { total_pages: 1 } }), text: async () => "" };
    });
    const client = createLawmaticsClient({ token: "t", fetchImpl: fetchImpl as never });
    const read = await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }]);
    expect(read.byRecord.get("Prospect:p1")).toMatchObject({ status: "ok" });
    expect(seen.every((m) => m === undefined || m === "GET")).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("keeps date, milestones and a snippet of at most 140 characters", async () => {
    const long = `consult done, sent proposal ${"x ".repeat(200)}`;
    const { client } = fakeClient(() => ({ records: [note({ body: long })] }));
    const read = await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }]);
    const result = read.byRecord.get("Prospect:p1")!;
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].date).toBe("2026-10-16T14:00:00.000Z");
    expect(result.notes[0].milestones).toEqual(expect.arrayContaining(["consult_held", "proposal_sent"]));
    expect(result.notes[0].snippet.length).toBeLessThanOrEqual(SNIPPET_MAX);
    // A note is held as exactly these three things.
    expect(Object.keys(result.notes[0]).sort()).toEqual(["date", "milestones", "snippet"]);
  });

  it("drops a note that names a different record (the server ignored the filter)", async () => {
    const { client } = fakeClient(() => ({ records: [note({ notable_id: "p1" }), note({ notable_id: "someone-else", body: "paid via Lawmatics" })] }));
    const result = (await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }])).byRecord.get("Prospect:p1")!;
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].milestones).not.toContain("paid");
  });

  it("notes that name no record at all are UNAVAILABLE, never 'no notes'", async () => {
    const { client } = fakeClient(() => ({ records: [note({ notable_id: undefined, notable_type: undefined })] }));
    const result = (await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }])).byRecord.get("Prospect:p1")!;
    expect(result.status).toBe("unavailable");
  });

  it("a person with no notes is ok with none: the read worked", async () => {
    const { client } = fakeClient(() => ({ records: [] }));
    expect((await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }])).byRecord.get("Prospect:p1")).toEqual({ status: "ok", notes: [], truncated: false });
  });

  it("a failed read is a named state with a fixed sentence and nothing from the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(() => new Error("SECRET-body-from-lawmatics"));
    const read = await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }, { id: "p2", kind: "Prospect" }]);
    for (const id of ["p1", "p2"]) {
      const r = read.byRecord.get("Prospect:" + id)!;
      expect(r.status).toBe("unavailable");
      expect(JSON.stringify(r)).not.toContain("SECRET");
    }
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain("SECRET");
  });

  it("one person failing does not block the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient((_p, params) => (params["filter[notable_id]"] === "p1" ? new Error("down") : { records: [note({ notable_id: "p2" })] }));
    const read = await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }, { id: "p2", kind: "Prospect" }]);
    expect(read.byRecord.get("Prospect:p1")?.status).toBe("unavailable");
    expect(read.byRecord.get("Prospect:p2")?.status).toBe("ok");
  });

  it("surfaces a page cap on one person's notes as truncated", async () => {
    const { client } = fakeClient(() => ({ records: [note()], truncated: true }));
    const r = (await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }])).byRecord.get("Prospect:p1")!;
    expect(r).toMatchObject({ status: "ok", truncated: true });
  });

  it("is bounded per run: the people beyond the bound are unavailable (not read) and counted", async () => {
    const { client, calls } = fakeClient((_p, params) => ({ records: [note({ notable_id: params["filter[notable_id]"] })] }));
    const targets = Array.from({ length: NOTES_MAX_RECORDS + 7 }, (_, i) => ({ id: `p${i}`, kind: "Prospect" as const }));
    const read = await readLawmaticsNotes(client, targets);
    expect(calls).toHaveLength(NOTES_MAX_RECORDS);
    expect(read.skippedForLimit).toBe(7);
    expect(read.byRecord.get(`Prospect:p${NOTES_MAX_RECORDS + 3}`)).toMatchObject({ status: "unavailable" });
  });

  it("asks once per person even when listed twice", async () => {
    const { client, calls } = fakeClient(() => ({ records: [] }));
    await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }, { id: "p1", kind: "Prospect" }]);
    expect(calls).toHaveLength(1);
  });
});

describe("nothing in the notes reader writes a note body anywhere", () => {
  it("has no insert, update, upsert, fetch POST or logging of text", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/lib/lawmatics/notes.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).not.toMatch(/["'`](POST|PATCH|PUT|DELETE)["'`]/);
    expect(src).not.toMatch(/db\/admin|getAdminClient|getScopedClient/);
    // The only logging is a fixed label and an error NAME.
    for (const line of src.split("\n").filter((l) => l.includes("console."))) expect(line).toMatch(/err instanceof Error \? err\.name/);
  });
});

describe("a 2xx reply that is not JSON:API-shaped is unavailable, never zero notes", () => {
  const bodies: Array<[string, unknown]> = [
    ["{}", {}],
    ["{data:null}", { data: null }],
    ["{error}", { error: "nope" }],
    ["{notes:[...]}", { notes: [note()] }],
  ];
  for (const [label, body] of bodies) {
    it(`${label} through the real client`, async () => {
      const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => "" }));
      const client = createLawmaticsClient({ token: "t", fetchImpl: fetchImpl as never });
      const read = await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }]);
      const r = read.byRecord.get("Prospect:p1")!;
      expect(r.status).toBe("unavailable");
      expect(JSON.stringify(r)).not.toContain("nope");
    });
  }

  it("a genuine empty JSON:API list is still ok with none", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ data: [] }), text: async () => "" }));
    const client = createLawmaticsClient({ token: "t", fetchImpl: fetchImpl as never });
    expect((await readLawmaticsNotes(client, [{ id: "p1", kind: "Prospect" }])).byRecord.get("Prospect:p1")).toEqual({ status: "ok", notes: [], truncated: false });
  });

  it("a prospect and a contact with the same id are kept apart", async () => {
    const { client } = fakeClient((_p, params) => ({ records: [note({ notable_id: "7", notable_type: params["filter[notable_type]"] })] }));
    const read = await readLawmaticsNotes(client, [{ id: "7", kind: "Prospect" }, { id: "7", kind: "Contact" }]);
    expect(read.byRecord.size).toBe(2);
  });
});
