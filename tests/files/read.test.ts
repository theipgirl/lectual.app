import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAD, MATTER, OTHER_ORG, SECRET, fileRow, makeWorld, seedTables } from "./helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function reads(world: ReturnType<typeof makeWorld>) {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
  return import("../../src/lib/files/read");
}

const f = (n: number, over = {}) =>
  fileRow({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, file_name: `f${n}.pdf`, created_at: `2026-10-${String(10 + (n % 20)).padStart(2, "0")}T10:00:00Z`, storage_path: `p/${n}`, ...over });

describe("listFiles", () => {
  it("returns ok with rows newest first, for the parent only", async () => {
    const world = makeWorld({
      tables: seedTables({
        crm_file: [
          fileRow({ id: "a", file_name: "old.pdf", created_at: "2026-10-01T00:00:00Z", storage_path: "1" }),
          fileRow({ id: "b", file_name: "new.pdf", created_at: "2026-10-05T00:00:00Z", storage_path: "2" }),
          fileRow({ id: "c", file_name: "matter.pdf", lead_id: null, matter_id: MATTER, storage_path: "3" }),
          fileRow({ id: "d", file_name: "foreign.pdf", org_id: OTHER_ORG, storage_path: "4" }),
        ],
      }),
    });
    const { listFiles } = await reads(world);
    const lead = await listFiles({ kind: "lead", id: LEAD });
    expect(lead).toMatchObject({ status: "ok", capped: false });
    expect(lead.status === "ok" && lead.files.map((x) => x.file_name)).toEqual(["new.pdf", "old.pdf"]);
    const matter = await listFiles({ kind: "matter", id: MATTER });
    expect(matter.status === "ok" && matter.files.map((x) => x.file_name)).toEqual(["matter.pdf"]);
    expect(world.db.orderCalls).toContainEqual(["crm_file", "created_at"]);
  });

  it("returns ok with no files for a parent with none (a genuine empty)", async () => {
    const { listFiles } = await reads(makeWorld());
    expect(await listFiles({ kind: "lead", id: LEAD })).toEqual({ status: "ok", files: [], capped: false });
  });

  it.each([
    ["PGRST205 code", { code: "PGRST205", message: "anything" }],
    ["42P01 code", { code: "42P01", message: "anything" }],
    ["a message with no code", { message: "Could not find the table 'public.crm_file' in the schema cache" }],
  ])("returns not-set-up for a missing table (%s)", async (_label, error) => {
    const world = makeWorld();
    world.db.fail("crm_file", "select", error);
    const { listFiles } = await reads(world);
    expect(await listFiles({ kind: "lead", id: LEAD })).toEqual({ status: "not-set-up" });
  });

  it("returns unavailable for any other error, never an empty ok, and logs the code only", async () => {
    for (const error of [{ code: "XX000", message: SECRET }, { code: "42501", message: "permission denied" }, { message: SECRET }]) {
      const world = makeWorld();
      world.db.fail("crm_file", "select", error);
      const { listFiles } = await reads(world);
      expect(await listFiles({ kind: "lead", id: LEAD })).toEqual({ status: "unavailable" });
    }
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain(SECRET);
  });

  it("returns unavailable when the client itself throws", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => { throw new Error(SECRET); }) }));
    const { listFiles } = await import("../../src/lib/files/read");
    expect(await listFiles({ kind: "lead", id: LEAD })).toEqual({ status: "unavailable" });
  });

  it("caps at 100 and reports when the cap was hit", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => f(i + 1));
    const { listFiles, LIST_CAP } = await reads(makeWorld({ tables: seedTables({ crm_file: rows }) }));
    const r = await listFiles({ kind: "lead", id: LEAD });
    expect(LIST_CAP).toBe(100);
    expect(r.status === "ok" && r.files).toHaveLength(100);
    expect(r).toMatchObject({ status: "ok", capped: true });
    const exactly = await reads(makeWorld({ tables: seedTables({ crm_file: rows.slice(0, 100) }) }));
    expect(await exactly.listFiles({ kind: "lead", id: LEAD })).toMatchObject({ status: "ok", capped: false });
  });
});

const letter = (over = {}) => ({
  id: "l1", org_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", matter_id: MATTER, doc_type: "loe_general", status: "generated",
  file_name: "Engagement letter.docx", created_by: "user-1", generated_at: "2026-10-18T10:00:00Z", created_at: "2026-10-17T10:00:00Z", ...over,
});

describe("listGeneratedLetters", () => {
  it("returns only the matter's generated letters", async () => {
    const world = makeWorld({
      tables: seedTables({
        crm_document_draft: [
          letter(),
          letter({ id: "l2", status: "queued" }),
          letter({ id: "l3", status: "failed" }),
          letter({ id: "l4", matter_id: "other-matter" }),
          letter({ id: "l5", org_id: OTHER_ORG }),
        ],
      }),
    });
    const { listGeneratedLetters } = await reads(world);
    const r = await listGeneratedLetters(MATTER);
    expect(r.status === "ok" && r.letters.map((l) => l.id)).toEqual(["l1"]);
  });

  it("returns unavailable on error, never an empty ok", async () => {
    const world = makeWorld();
    world.db.fail("crm_document_draft", "select", { code: "XX000", message: SECRET });
    const { listGeneratedLetters } = await reads(world);
    expect(await listGeneratedLetters(MATTER)).toEqual({ status: "unavailable" });
  });
});

describe("loadDocumentsRead", () => {
  it("reads letters only for a matter in a firm with Document Center", async () => {
    const world = makeWorld({ tables: seedTables({ crm_document_draft: [letter()] }) });
    const { loadDocumentsRead } = await reads(world);

    await loadDocumentsRead({ kind: "lead", id: LEAD }, { includeLetters: true });
    expect(world.db.froms).not.toContain("crm_document_draft");

    await loadDocumentsRead({ kind: "matter", id: MATTER }, { includeLetters: false });
    expect(world.db.froms).not.toContain("crm_document_draft");

    const withLetters = await loadDocumentsRead({ kind: "matter", id: MATTER }, { includeLetters: true });
    expect(world.db.froms).toContain("crm_document_draft");
    expect(withLetters.letters?.status).toBe("ok");
  });

  it("a failed files read does not hide the letters, and the reverse", async () => {
    const a = makeWorld({ tables: seedTables({ crm_document_draft: [letter()] }) });
    a.db.fail("crm_file", "select");
    const r1 = await (await reads(a)).loadDocumentsRead({ kind: "matter", id: MATTER }, { includeLetters: true });
    expect(r1.files.status).toBe("unavailable");
    expect(r1.letters?.status).toBe("ok");

    const b = makeWorld({ tables: seedTables({ crm_file: [fileRow({ lead_id: null, matter_id: MATTER, storage_path: "z" })] }) });
    b.db.fail("crm_document_draft", "select");
    const r2 = await (await reads(b)).loadDocumentsRead({ kind: "matter", id: MATTER }, { includeLetters: true });
    expect(r2.files.status).toBe("ok");
    expect(r2.letters?.status).toBe("unavailable");
  });
});

describe("buildEntries", () => {
  const file = (id: string, at: string, uploaded_by: string | null = "user-1") => ({ id, file_name: `${id}.pdf`, mime: "application/pdf", size_bytes: 1000, uploaded_by, created_at: at });
  const ltr = (id: string, generated_at: string | null, created_at: string) => ({ id, doc_type: "loe_general", file_name: null, created_by: "user-1", generated_at, created_at });

  it("merges files and letters newest first (letters by generation time, else creation time)", async () => {
    const { buildEntries } = await reads(makeWorld());
    const out = buildEntries(
      {
        files: { status: "ok", capped: false, files: [file("f-old", "2026-10-01T00:00:00Z"), file("f-new", "2026-10-20T00:00:00Z")] },
        letters: { status: "ok", capped: false, letters: [ltr("l-gen", "2026-10-15T00:00:00Z", "2026-10-02T00:00:00Z"), ltr("l-created", null, "2026-10-25T00:00:00Z")] },
      },
      [{ userId: "user-1", name: "Dawn" }],
    );
    expect(out.map((e) => e.id)).toEqual(["l-created", "f-new", "l-gen", "f-old"]);
    expect(out.map((e) => e.kind)).toEqual(["letter", "file", "letter", "file"]);
    expect(out[0]).toMatchObject({ name: "Engagement letter", typeLabel: "Engagement letter", who: "Dawn" });
  });

  it("keeps a stable order on ties: files before letters, each in the order read", async () => {
    const { buildEntries } = await reads(makeWorld());
    const t = "2026-10-20T00:00:00Z";
    const out = buildEntries(
      { files: { status: "ok", capped: false, files: [file("a", t), file("b", t)] }, letters: { status: "ok", capped: false, letters: [ltr("c", t, t), ltr("d", t, t)] } },
      null,
    );
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("says 'A teammate' when the directory failed, the user is gone, or there is no uploader", async () => {
    const { buildEntries, UNKNOWN_WHO } = await reads(makeWorld());
    const read = { files: { status: "ok" as const, capped: false, files: [file("a", "2026-10-20T00:00:00Z"), file("b", "2026-10-19T00:00:00Z", "gone-user"), file("c", "2026-10-18T00:00:00Z", null)] }, letters: null };
    expect(UNKNOWN_WHO).toBe("A teammate");
    expect(buildEntries(read, null).map((e) => e.who)).toEqual(["A teammate", "A teammate", "A teammate"]);
    expect(buildEntries(read, [{ userId: "user-1", name: "Dawn" }]).map((e) => e.who)).toEqual(["Dawn", "A teammate", "A teammate"]);
    expect(buildEntries(read, [{ userId: "user-1", name: "  " }]).map((e) => e.who)[0]).toBe("A teammate");
  });

  it("lists nothing from a read that did not succeed", async () => {
    const { buildEntries } = await reads(makeWorld());
    expect(buildEntries({ files: { status: "unavailable" }, letters: { status: "unavailable" } }, null)).toEqual([]);
    expect(buildEntries({ files: { status: "not-set-up" }, letters: null }, null)).toEqual([]);
  });
});
