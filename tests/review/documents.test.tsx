import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LEAD, MATTER, OTHER_LEAD, OTHER_MATTER, OTHER_ORG, ORG, fileRow, makeWorld, seedTables } from "../files/helpers";
import { row, TODAY } from "./fixtures";

const SECRET_NAME = "<b>Client&Secret</b>.pdf";
const letter = (over = {}) => ({ id: "l1", org_id: ORG, matter_id: MATTER, status: "generated", doc_type: "opinion_letter", file_name: "Opinion letter.docx", created_by: "u-reb", generated_at: "2026-10-25T12:00:00Z", created_at: "2026-10-25T11:00:00Z", ...over });
const members = [{ userId: "u-reb", name: "Rebecca", role: "owner" }];

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

type World = ReturnType<typeof makeWorld>;

function mockDb(world: World, modules: string[] | null = ["document-center"]) {
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
  vi.doMock("@/lib/org/modules", () => ({
    orgHasModule: vi.fn(async (m: string) => (modules ?? []).includes(m)),
    activeOrgModulesOrNull: vi.fn(async () => modules),
  }));
  vi.doMock("@/lib/matters/stages", () => ({ listMatterStages: vi.fn(async () => []) }));
  vi.doMock("@/lib/pipeline/stages", () => ({ listStages: vi.fn(async () => []) }));
}

describe("the documents reads (reusing loadDocumentsRead)", () => {
  it("a matter: its own files and its generated letters, as two reads", async () => {
    const world = makeWorld({ tables: seedTables({ crm_file: [fileRow({ id: "f1", lead_id: null, matter_id: MATTER, file_name: "App.pdf" }), fileRow({ id: "f2", lead_id: LEAD })], crm_document_draft: [letter()] }) });
    mockDb(world);
    const { readRecordDocuments } = await import("../../src/lib/review/detail-load");
    const r = await readRecordDocuments({ kind: "matter", id: MATTER });
    expect(r.files.status === "ok" && r.files.files.map((f) => f.id)).toEqual(["f1"]);
    expect(r.letters?.status).toBe("ok");
  });

  it("a matter in a firm without Document Center reads no letters; a lead never does", async () => {
    const world = makeWorld({ tables: seedTables({ crm_document_draft: [letter()] }) });
    mockDb(world, []);
    const { readRecordDocuments } = await import("../../src/lib/review/detail-load");
    expect((await readRecordDocuments({ kind: "matter", id: MATTER })).letters).toBeNull();
    expect((await readRecordDocuments({ kind: "lead", id: LEAD })).letters).toBeNull();
    expect(world.db.froms).not.toContain("crm_document_draft");
  });

  it("another firm's id reads as nothing: the record is missing and no document read is made", async () => {
    const world = makeWorld({ tables: seedTables({ crm_file: [fileRow({ id: "x", org_id: OTHER_ORG, lead_id: OTHER_LEAD }), fileRow({ id: "y", org_id: OTHER_ORG, lead_id: null, matter_id: OTHER_MATTER })] }) });
    mockDb(world);
    const { loadReviewDetail } = await import("../../src/lib/review/detail-load");
    expect(await loadReviewDetail({ kind: "matter", id: OTHER_MATTER })).toEqual({ status: "missing" });
    expect(await loadReviewDetail({ kind: "lead", id: OTHER_LEAD })).toEqual({ status: "missing" });
    expect(world.db.froms).not.toContain("crm_file");
    // Even a direct read of the loader cannot see another firm's rows (RLS).
    const { listFiles } = await import("../../src/lib/files/read");
    expect(await listFiles({ kind: "lead", id: OTHER_LEAD })).toEqual({ status: "ok", files: [], capped: false });
  });

  it("the detail carries the documents of the record it read", async () => {
    const world = makeWorld({ tables: seedTables({ crm_file: [fileRow({ id: "f1" })] }) });
    mockDb(world);
    const { loadReviewDetail } = await import("../../src/lib/review/detail-load");
    const d = await loadReviewDetail({ kind: "lead", id: LEAD });
    expect(d.status).toBe("ok");
    expect(d.status === "ok" && d.documents.files.status).toBe("ok");
  });

  it("the deck read is the same reader for one record", async () => {
    const world = makeWorld({ tables: seedTables({ crm_file: [fileRow({ id: "f1" })] }) });
    mockDb(world);
    const { loadDeckDocuments } = await import("../../src/lib/review/detail-load");
    const r = await loadDeckDocuments({ kind: "lead", id: LEAD });
    expect(r.ok && r.read.files.status).toBe("ok");
    expect(world.db.froms.filter((t) => t === "crm_file")).toHaveLength(1);
  });
});

describe("capped, merged leads, unreadable modules", () => {
  const ok = { status: "ok" as const };
  const lead2 = "77777777-7777-4777-8777-777777777777";
  const mergedWorld = () =>
    makeWorld({
      tables: seedTables({
        crm_lead: [
          { id: LEAD, org_id: ORG, first_name: "K", last_name: "Keeper", merged_into_id: null },
          { id: lead2, org_id: ORG, first_name: "M", last_name: "Merged", merged_into_id: LEAD },
        ],
        crm_file: [fileRow({ id: "own" }), fileRow({ id: "child", lead_id: lead2 }), fileRow({ id: "child2", lead_id: lead2 })],
      }),
    });

  it("'+N or more' when a reader hit its cap, in the panel and the deck", async () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, file_name: `n${i}.pdf`, mime: "x", size_bytes: 1, uploaded_by: null, created_at: `2026-10-${10 + i}T10:00:00Z` }));
    const { ReviewDocuments, DeckDocuments } = await import("../../src/components/review/ReviewDocuments");
    const read = { files: { ...ok, capped: true, files }, letters: null };
    const panel = renderToStaticMarkup(<ReviewDocuments open={{ kind: "lead", id: LEAD }} documents={read as never} members={members} today={TODAY} timeZone="America/New_York" canWrite={false} />);
    expect(panel).toContain("+2 or more");
    expect(renderToStaticMarkup(<DeckDocuments read={read as never} members={members} today={TODAY} timeZone="America/New_York" />)).toContain("+7 or more");
  });

  it("a lead's panel lists the merged leads' files, as the lead page does", async () => {
    const world = mergedWorld();
    mockDb(world);
    const { readRecordDocuments } = await import("../../src/lib/review/detail-load");
    const r = await readRecordDocuments({ kind: "lead", id: LEAD });
    expect(r.files.status === "ok" && r.files.files.map((f) => f.id).sort()).toEqual(["child", "child2", "own"]);
    expect(r.mergedPartial).toBe(false);
  });

  it("an unreadable merged set lists the keeper's own and says the history is partial, never 'No documents yet.'", async () => {
    const world = makeWorld();
    world.db.fail("crm_lead", "select");
    mockDb(world);
    const { readRecordDocuments } = await import("../../src/lib/review/detail-load");
    const r = await readRecordDocuments({ kind: "lead", id: LEAD });
    expect(r.mergedPartial).toBe(true);
    const { ReviewDocuments } = await import("../../src/components/review/ReviewDocuments");
    const html = renderToStaticMarkup(<ReviewDocuments open={{ kind: "lead", id: LEAD }} documents={{ files: { ...ok, capped: false, files: [] }, letters: null, mergedPartial: true } as never} members={members} today={TODAY} timeZone="America/New_York" canWrite={false} />);
    expect(html).toContain("History from merged leads couldn&#x27;t be loaded.");
    expect(html).not.toContain("No documents yet.");
  });

  it("a keeper's count includes its merged leads' files", async () => {
    const world = mergedWorld();
    mockDb(world);
    const { readDocumentCounts } = await import("../../src/lib/review/load");
    const counts = await readDocumentCounts(world.client as never, [], [LEAD]);
    expect(counts.get(`lead:${LEAD}`)).toBe(3);
    expect(counts.has(`lead:${lead2}`)).toBe(false);
  });

  it("a failed merged read rejects the counts (no too-low number); a database without 0107 behaves as before", async () => {
    const bad = mergedWorld();
    bad.db.fail("crm_lead", "select");
    mockDb(bad);
    const { readDocumentCounts } = await import("../../src/lib/review/load");
    await expect(readDocumentCounts(bad.client as never, [], [LEAD])).rejects.toThrow();
    vi.resetModules();
    const old = makeWorld({ tables: seedTables({ crm_file: [fileRow({ id: "own" })] }) });
    old.db.fail("crm_lead", "select", { code: "42703", message: "column does not exist" });
    mockDb(old);
    const mod = await import("../../src/lib/review/load");
    const live = await import("../../src/lib/leads/live");
    live.resetLeadMergeSupport();
    expect((await mod.readDocumentCounts(old.client as never, [], [LEAD])).get(`lead:${LEAD}`)).toBe(1);
  });

  it("an unreadable module list makes a matter's letters 'unavailable', so the sentence shows and not 'No documents yet.'", async () => {
    mockDb(makeWorld(), null);
    const { readRecordDocuments } = await import("../../src/lib/review/detail-load");
    const r = await readRecordDocuments({ kind: "matter", id: MATTER });
    expect(r.letters).toEqual({ status: "unavailable" });
    const { documentsView } = await import("../../src/lib/review/documents");
    expect(documentsView(r, null, 8)).toMatchObject({ lettersFailed: true, empty: false });
  });
});

describe("documentsView states", () => {
  const ok = { status: "ok" as const, capped: false };
  it("empty only when every read worked and found nothing", async () => {
    const { documentsView } = await import("../../src/lib/review/documents");
    const v = (files: unknown, letters: unknown) => documentsView({ files, letters } as never, null, 8);
    expect(v({ ...ok, files: [] }, null).empty).toBe(true);
    expect(v({ ...ok, files: [] }, { ...ok, letters: [] }).empty).toBe(true);
    expect(v({ status: "unavailable" }, null)).toMatchObject({ empty: false, filesFailed: true });
    expect(v({ status: "not-set-up" }, null)).toMatchObject({ empty: false, filesNotSetUp: true });
    expect(v({ ...ok, files: [] }, { status: "unavailable" })).toMatchObject({ empty: false, lettersFailed: true });
  });
});

describe("the count tag", () => {
  it("shows only a known count above zero", async () => {
    const { documentsTag } = await import("../../src/lib/review/documents");
    expect(documentsTag(3)).toBe("3 documents");
    expect(documentsTag(1)).toBe("1 document");
    for (const bad of [0, null, undefined, -1, 1.5, Number.NaN]) expect(documentsTag(bad)).toBeNull();
  });

  it("card, deck and sheet draw nothing for 0, unknown or a failed count", async () => {
    const { DocTag } = await import("../../src/components/review/shared");
    expect(renderToStaticMarkup(<DocTag row={{ documentCount: 4 }} />)).toContain("4 documents");
    for (const documentCount of [0, null, undefined]) expect(renderToStaticMarkup(<DocTag row={{ documentCount }} />)).toBe("");
  });

  async function loaded(world: World, modules: string[] | null = ["document-center"]) {
    vi.resetModules();
    mockDb(world, modules);
    const { readDocumentCounts } = await import("../../src/lib/review/load");
    return readDocumentCounts(world.client as never, [MATTER], [LEAD]);
  }

  it("counts files per record plus letters per matter, in one read per table and chunk", async () => {
    const world = makeWorld({
      tables: seedTables({
        crm_file: [fileRow({ id: "a" }), fileRow({ id: "b" }), fileRow({ id: "c", lead_id: null, matter_id: MATTER }), fileRow({ id: "z", org_id: OTHER_ORG })],
        crm_document_draft: [letter(), letter({ id: "l2" }), letter({ id: "l3", status: "failed" })],
      }),
    });
    const counts = await loaded(world);
    expect(counts.get(`lead:${LEAD}`)).toBe(2);
    expect(counts.get(`matter:${MATTER}`)).toBe(3);
    expect(world.db.froms.filter((t) => t === "crm_file")).toHaveLength(2);
    expect(world.db.froms.filter((t) => t === "crm_document_draft")).toHaveLength(1);
  });

  it("counts no letters for a firm without Document Center", async () => {
    const world = makeWorld({ tables: seedTables({ crm_document_draft: [letter()] }) });
    const counts = await loaded(world, []);
    expect(counts.get(`matter:${MATTER}`)).toBeUndefined();
    expect(world.db.froms).not.toContain("crm_document_draft");
  });

  it("a failed files read, a failed letters read and an unreadable module list each reject (so no tag, and a named gap)", async () => {
    const a = makeWorld();
    a.db.fail("crm_file", "select");
    await expect(loaded(a)).rejects.toThrow();
    const b = makeWorld();
    b.db.fail("crm_document_draft", "select");
    await expect(loaded(b)).rejects.toThrow();
    await expect(loaded(makeWorld(), null)).rejects.toThrow();
  });

  it("the review load names 'documents' and leaves every count unset when the count fails; it never writes 0", async () => {
    const world = makeWorld({ tables: seedTables({ crm_file: [fileRow({ id: "a", lead_id: null, matter_id: MATTER })] }) });
    mockDb(world);
    vi.doMock("@/lib/matters", () => ({ listMatters: vi.fn(async () => [{ id: MATTER, status: "open", lead_id: null, title: "Acme", owner_name: "Acme", matter_number: "TM-1", stage_id: null, type: "TM" }]) }));
    vi.doMock("@/lib/pipeline", () => ({ listLeads: vi.fn(async () => []), listStages: vi.fn(async () => []) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
    vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "unconfigured" })) }));
    vi.doMock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: vi.fn(async () => ({ status: "ok", byLead: {} })) }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
    vi.doMock("@/app/dashboard/matters/list-utils", () => ({ matterIdsNeedingReview: () => new Set() }));
    const { loadReview } = await import("../../src/lib/review/load");
    const good = await loadReview();
    expect(good.status === "ok" && good.failed).not.toContain("documents");
    expect(good.status === "ok" && good.rows[0].documentCount).toBe(1);
    world.db.fail("crm_file", "select");
    const bad = await loadReview();
    expect(bad.status === "ok" && bad.failed).toContain("documents");
    expect(bad.status === "ok" && bad.rows.every((r) => r.documentCount === undefined)).toBe(true);
  });

  it("the existing note names it", async () => {
    const { detailsNote } = await import("../../src/lib/review/notes");
    expect(detailsNote(["documents"])).toBe("Some details couldn't load (documents). Refresh to try again.");
  });
});

describe("the panel's Documents section", () => {
  const ok = { status: "ok" as const, capped: false };
  const file = (id: string, at: string, name = "App.pdf") => ({ id, file_name: name, mime: "application/pdf", size_bytes: 1000, uploaded_by: "u-reb", created_at: at });
  async function render(documents: unknown, canWrite = true, kind: "matter" | "lead" = "matter") {
    const { ReviewDocuments } = await import("../../src/components/review/ReviewDocuments");
    return renderToStaticMarkup(<ReviewDocuments open={{ kind, id: MATTER }} documents={documents as never} members={members} today={TODAY} timeZone="America/New_York" canWrite={canWrite} />);
  }

  it("lists newest first with name, kind, date and who, through the existing download routes", async () => {
    const html = await render({
      files: { ...ok, files: [file("f1", "2026-10-20T15:00:00Z", SECRET_NAME)] },
      letters: { ...ok, letters: [{ id: "l1", doc_type: "opinion_letter", file_name: "Opinion letter.docx", created_by: "u-reb", generated_at: "2026-10-25T12:00:00Z", created_at: "2026-10-25T11:00:00Z" }] },
    });
    expect(html.indexOf("Opinion letter.docx")).toBeLessThan(html.indexOf("Client&amp;Secret"));
    expect(html).toContain('href="/dashboard/files/f1/download/"');
    expect(html).toContain('href="/dashboard/documents/l1/download/"');
    expect(html).toContain("Letter · ");
    expect(html).toContain("File · PDF");
    expect(html).toContain("Rebecca");
    expect(html).toContain("Oct 25");
    expect(html).not.toContain("<b>Client");
    expect(html).not.toContain("No documents yet.");
  });

  it("empty: 'No documents yet.' only when every read worked", async () => {
    expect(await render({ files: { ...ok, files: [] }, letters: null })).toContain("No documents yet.");
    expect(await render({ files: { ...ok, files: [] }, letters: { ...ok, letters: [] } })).toContain("No documents yet.");
  });

  it("a failed read is a fixed sentence and never 'No documents yet.'; the other read still shows", async () => {
    const files = await render({ files: { status: "unavailable" }, letters: { ...ok, letters: [{ id: "l1", doc_type: "opinion_letter", file_name: "L.docx", created_by: null, generated_at: null, created_at: "2026-10-25T11:00:00Z" }] } });
    expect(files).toContain("Files couldn&#x27;t be loaded. Refresh to try again.");
    expect(files).toContain("L.docx");
    expect(files).not.toContain("No documents yet.");
    const letters = await render({ files: { ...ok, files: [file("f1", "2026-10-20T15:00:00Z")] }, letters: { status: "unavailable" } });
    expect(letters).toContain("Generated letters couldn&#x27;t be loaded");
    expect(letters).toContain("App.pdf");
    expect(await render({ files: { status: "unavailable" }, letters: null })).not.toContain("No documents yet.");
  });

  it("not set up is its own sentence, not empty", async () => {
    const html = await render({ files: { status: "not-set-up" }, letters: null });
    expect(html).toContain("File storage isn&#x27;t set up for this firm yet.");
    expect(html).not.toContain("No documents yet.");
  });

  it("has the 'Open all documents' link to the page's card, and the comment entry point only where a note can be written", async () => {
    const docs = { files: { ...ok, files: [] }, letters: null };
    const matter = await render(docs, true, "matter");
    expect(matter).toContain(`href="/dashboard/matters/${MATTER}/#documents"`);
    expect(matter).toContain("Open all documents");
    expect(matter).toContain('href="#rv-sec-note"');
    expect(matter).toContain("Comment on a document");
    const lead = await render(docs, false, "lead");
    expect(lead).toContain(`href="/dashboard/leads/${MATTER}/#documents"`);
    expect(lead).not.toContain("Comment on a document");
  });

  it("more than eight: the rest is counted, not listed", async () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`f${i}`, `2026-10-${String(10 + i).padStart(2, "0")}T10:00:00Z`, `n${i}.pdf`));
    const html = await render({ files: { ...ok, files }, letters: null });
    expect(html).toContain("+2 more");
    expect(html.match(/rv-doc-link/g)).toHaveLength(8);
  });
});

describe("the Cards deck's documents", () => {
  const ok = { status: "ok" as const, capped: false };
  const files = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, file_name: `d${i}.pdf`, mime: "application/pdf", size_bytes: 1, uploaded_by: null, created_at: `2026-10-${10 + i}T10:00:00Z` }));
  async function render(read: unknown) {
    const { DeckDocuments } = await import("../../src/components/review/ReviewDocuments");
    return renderToStaticMarkup(<DeckDocuments read={read as never} members={members} today={TODAY} timeZone="America/New_York" />);
  }
  it("up to three newest links and '+N more'", async () => {
    const html = await render({ files: { ...ok, files }, letters: null });
    expect(html.match(/rv-doc-link/g)).toHaveLength(3);
    expect(html).toContain("d4.pdf");
    expect(html).not.toContain("d1.pdf");
    expect(html).toContain("+2 more");
  });
  it("three or fewer has no '+N more'; a failed read says so", async () => {
    expect(await render({ files: { ...ok, files: files.slice(0, 3) }, letters: null })).not.toContain("more");
    expect(await render(null)).toContain("Documents couldn&#x27;t be loaded.");
  });
  it("the big card draws them for the current card", async () => {
    const { CardsDeck } = await import("../../src/components/review/CardsDeck");
    const { parseReviewParams } = await import("../../src/lib/review/params");
    vi.doMock("@/app/dashboard/review/card-actions", () => ({}));
    const html = renderToStaticMarkup(
      <CardsDeck
        card={{ row: row({ documentCount: 5 }), bucket: "week" } as never}
        pos={{ index: 0, position: 1, total: 1, prev: null, next: null } as never}
        personName="Rebecca"
        personId="u-reb"
        note={null}
        docs={{ ok: true, read: { files: { ...ok, files }, letters: null } }}
        timeZone="America/New_York"
        today={TODAY}
        members={members}
        canWrite={false}
        params={parseReviewParams({})}
      />,
    );
    expect(html).toContain("d4.pdf");
    expect(html).toContain("+2 more");
  });
});
