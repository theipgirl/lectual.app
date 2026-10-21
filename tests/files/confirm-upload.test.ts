import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_MESSAGES } from "../../src/lib/files/rules";
import { FILE_ID, LEAD, MATTER, NON_STAFF_ROLES, ORG, OTHER_LEAD, OTHER_MATTER, SECRET, STAFF_ROLES, loadActions, makeWorld, pathFor } from "./helpers";
import { writesTo } from "../matters/helpers/fake-db";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const leadPath = pathFor("lead", FILE_ID, "pdf");
const matterPath = pathFor("matter", FILE_ID, "pdf");
const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");

describe("confirmUploadAction: the row and the timeline entry", () => {
  it("inserts one row for a lead with exactly the expected keys, from the parent and the object", async () => {
    const world = makeWorld({ objects: { [leadPath]: 84_000 } });
    const { confirmUploadAction, revalidated } = await loadActions(world);
    const r = await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "Signed LOE.pdf");
    expect(r).toEqual({ ok: true, fileId: FILE_ID });

    const inserts = writesTo(world.db, "crm_file");
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["file_name", "id", "lead_id", "matter_id", "mime", "org_id", "size_bytes", "storage_path"]);
    expect(payload).toEqual({
      id: FILE_ID,
      org_id: ORG,
      lead_id: LEAD,
      matter_id: null,
      storage_path: leadPath,
      file_name: "Signed LOE.pdf",
      mime: "application/pdf",
      size_bytes: 84_000,
    });
    expect(payload).not.toHaveProperty("uploaded_by");
    expect(payload).not.toHaveProperty("contact_id");
    expect(world.db.rows("crm_file")[0].uploaded_by).toBe("user-1"); // the database's own default
    expect(revalidated).toEqual([`/dashboard/leads/${LEAD}/`]);
  });

  it("inserts one row for a matter with matter_id set and lead_id null", async () => {
    const world = makeWorld({ objects: { [matterPath]: 10 } });
    const { confirmUploadAction, revalidated } = await loadActions(world);
    expect((await confirmUploadAction({ kind: "matter", id: MATTER }, FILE_ID, "x.pdf")).ok).toBe(true);
    const payload = writesTo(world.db, "crm_file")[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({ lead_id: null, matter_id: MATTER, storage_path: matterPath });
    expect(revalidated).toEqual([`/dashboard/matters/${MATTER}/`]);
  });

  it.each(STAFF_ROLES)("%s may confirm", async (role) => {
    const world = makeWorld({ role, objects: { [leadPath]: 10 } });
    const { confirmUploadAction } = await loadActions(world);
    expect((await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf")).ok).toBe(true);
  });

  it("logs exactly one file_uploaded activity with the name and size and without the storage path", async () => {
    const world = makeWorld({ objects: { [leadPath]: 84_000 } });
    const { confirmUploadAction } = await loadActions(world);
    await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "Signed LOE.pdf");
    const acts = world.db.activity();
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ type: "file_uploaded", lead_id: LEAD, matter_id: null, org_id: ORG });
    expect(acts[0].payload).toEqual({ file_id: FILE_ID, file_name: "Signed LOE.pdf", size_bytes: 84_000 });
    expect(JSON.stringify(acts[0])).not.toContain(leadPath);
    expect(JSON.stringify(acts[0])).not.toContain("storage_path");
  });

  it("on a lead, counts as a touch (last_activity_at updates); on a matter it touches no lead", async () => {
    const lead = makeWorld({ objects: { [leadPath]: 10 } });
    await (await loadActions(lead)).confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
    expect(lead.db.rows("crm_lead").find((l) => l.id === LEAD)!.last_activity_at).toEqual(expect.any(String));

    const matter = makeWorld({ objects: { [matterPath]: 10 } });
    await (await loadActions(matter)).confirmUploadAction({ kind: "matter", id: MATTER }, FILE_ID, "x.pdf");
    expect(matter.db.rows("crm_lead").every((l) => l.last_activity_at === null)).toBe(true);
    expect(writesTo(matter.db, "crm_lead")).toEqual([]);
    expect(matter.db.activity()[0]).toMatchObject({ matter_id: MATTER, lead_id: null });
  });
});

describe("confirmUploadAction: failures", () => {
  it("still succeeds when the activity write fails, and logs the failure", async () => {
    const world = makeWorld({ objects: { [leadPath]: 10 } });
    world.db.fail("crm_activity", "insert");
    const { confirmUploadAction } = await loadActions(world);
    const r = await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
    expect(r).toEqual({ ok: true, fileId: FILE_ID });
    expect(world.db.rows("crm_file")).toHaveLength(1);
    expect(logged()).toContain("file_uploaded");
  });

  it("returns a sentence, logs no activity, and removes the object when the row insert fails", async () => {
    const world = makeWorld({ objects: { [leadPath]: 10 } });
    world.db.fail("crm_file", "insert", { code: "XX000", message: SECRET });
    const { confirmUploadAction } = await loadActions(world);
    const r = await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.saveFailed });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(world.db.activity()).toEqual([]);
    expect(world.storage.callsTo("remove")[0].args[0]).toEqual([leadPath]);
    expect(world.storage.objects.has(leadPath)).toBe(false);
    expect(logged()).not.toContain(SECRET);
  });

  it("still reports the row failure when the object cleanup itself fails", async () => {
    const world = makeWorld({ objects: { [leadPath]: 10 } });
    world.db.fail("crm_file", "insert");
    world.storage.errors.remove = { message: SECRET };
    const { confirmUploadAction } = await loadActions(world);
    const r = await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.saveFailed });
    expect(logged()).not.toContain(SECRET);
  });

  it("reads a second confirm for the same file as already saved, not an error, and logs nothing twice", async () => {
    const world = makeWorld({ objects: { [leadPath]: 10 } });
    const { confirmUploadAction, revalidated } = await loadActions(world);
    await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
    const again = await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
    expect(again).toEqual({ ok: true, fileId: FILE_ID, alreadySaved: true });
    expect(world.db.rows("crm_file")).toHaveLength(1);
    expect(world.db.activity()).toHaveLength(1);
    expect(world.storage.callsTo("remove")).toEqual([]); // the saved file's object is never cleaned up
    expect(revalidated).toHaveLength(2); // the page refreshes either way
  });

  it("says storage is not set up for a missing table, without throwing", async () => {
    for (const error of [{ code: "PGRST205", message: "Could not find the table 'public.crm_file' in the schema cache" }, { code: "42P01", message: "relation \"crm_file\" does not exist" }]) {
      const world = makeWorld({ objects: { [leadPath]: 10 } });
      world.db.fail("crm_file", "insert", error);
      const { confirmUploadAction } = await loadActions(world);
      const r = await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
      expect(r).toEqual({ ok: false, error: FILE_MESSAGES.notSetUp, notSetUp: true });
    }
  });

  it("says storage is not set up when the bucket is missing", async () => {
    const world = makeWorld();
    world.storage.errors.list = { message: "Bucket not found", statusCode: "404" };
    const { confirmUploadAction } = await loadActions(world);
    expect(await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf")).toEqual({ ok: false, error: FILE_MESSAGES.notSetUp, notSetUp: true });
  });

  it("returns a generic sentence for another storage error", async () => {
    const world = makeWorld();
    world.storage.errors.list = { message: SECRET, statusCode: "500" };
    const { confirmUploadAction } = await loadActions(world);
    const r = await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.generic });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });
});

describe("confirmUploadAction: refusals", () => {
  it("refuses a parent from another org as not found", async () => {
    const world = makeWorld({ objects: { [pathFor("lead", FILE_ID, "pdf", ORG, OTHER_LEAD)]: 10 } });
    const { confirmUploadAction } = await loadActions(world);
    expect(await confirmUploadAction({ kind: "lead", id: OTHER_LEAD }, FILE_ID, "x.pdf")).toEqual({ ok: false, error: FILE_MESSAGES.notFound });
    expect(await confirmUploadAction({ kind: "matter", id: OTHER_MATTER }, FILE_ID, "x.pdf")).toEqual({ ok: false, error: FILE_MESSAGES.notFound });
    expect(writesTo(world.db, "crm_file")).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  it.each(NON_STAFF_ROLES)("refuses %s", async (role) => {
    const world = makeWorld({ role, objects: { [leadPath]: 10 } });
    const { confirmUploadAction } = await loadActions(world);
    expect(await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf")).toEqual({ ok: false, error: FILE_MESSAGES.cantUpload });
    expect(writesTo(world.db, "crm_file")).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  it.each(["not-a-uuid", "", `${FILE_ID}/../x`, "../../etc"])("refuses file id %j", async (id) => {
    const world = makeWorld({ objects: { [leadPath]: 10 } });
    const { confirmUploadAction } = await loadActions(world);
    expect(await confirmUploadAction({ kind: "lead", id: LEAD }, id, "x.pdf")).toEqual({ ok: false, error: FILE_MESSAGES.badUpload });
    expect(world.storage.calls).toEqual([]);
  });

  it("refuses when no object exists at the rebuilt path (nothing was uploaded, or it was uploaded elsewhere)", async () => {
    const world = makeWorld({ objects: { [pathFor("lead", FILE_ID, "pdf", "cccccccc-cccc-4ccc-8ccc-cccccccccccc")]: 10 } });
    const { confirmUploadAction } = await loadActions(world);
    expect(await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf")).toEqual({ ok: false, error: FILE_MESSAGES.badUpload });
    expect(writesTo(world.db, "crm_file")).toEqual([]);
  });

  it("refuses a name whose extension differs from the object's (the path is rebuilt from the name)", async () => {
    const world = makeWorld({ objects: { [leadPath]: 10 } });
    const { confirmUploadAction } = await loadActions(world);
    expect(await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.docx")).toEqual({ ok: false, error: FILE_MESSAGES.badUpload });
    expect(await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.exe")).toEqual({ ok: false, error: FILE_MESSAGES.badType });
  });

  it("refuses a stored object larger than 25 MB", async () => {
    const world = makeWorld({ objects: { [leadPath]: 26_214_401 } });
    const { confirmUploadAction } = await loadActions(world);
    const r = await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf");
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.tooBig });
    expect(writesTo(world.db, "crm_file")).toEqual([]);
  });

  it("accepts an object of exactly 25 MB and stores its real size", async () => {
    const world = makeWorld({ objects: { [leadPath]: 26_214_400 } });
    const { confirmUploadAction } = await loadActions(world);
    expect((await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf")).ok).toBe(true);
    expect(world.db.rows("crm_file")[0].size_bytes).toBe(26_214_400);
  });
});

describe("confirmUploadAction: the stored name", () => {
  it("is cleaned, at most 255 characters, and is not part of the path", async () => {
    const hostile = `../../${"x".repeat(400)}\u0000.pdf`;
    const world = makeWorld({ objects: { [leadPath]: 10 } });
    const { confirmUploadAction } = await loadActions(world);
    expect((await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, hostile)).ok).toBe(true);
    const row = world.db.rows("crm_file")[0];
    expect(String(row.file_name).length).toBeLessThanOrEqual(255);
    expect(row.file_name).not.toMatch(/[\\/\u0000]/);
    expect(String(row.file_name).endsWith(".pdf")).toBe(true);
    expect(row.storage_path).toBe(leadPath);
  });
});

describe("what the browser can learn", () => {
  it("never returns a message, constraint name, path or org id from a database error", async () => {
    const world = makeWorld({ objects: { [leadPath]: 10 } });
    world.db.fail("crm_file", "insert", { code: "23514", message: `new row for relation "crm_file" violates check constraint "crm_file_path_in_org" ${SECRET} ${leadPath} ${ORG}` });
    const { confirmUploadAction } = await loadActions(world);
    const r = JSON.stringify(await confirmUploadAction({ kind: "lead", id: LEAD }, FILE_ID, "x.pdf"));
    for (const secret of [SECRET, "crm_file_path_in_org", leadPath, ORG]) expect(r).not.toContain(secret);
    for (const secret of [SECRET, "crm_file_path_in_org"]) expect(logged()).not.toContain(secret);
  });
});
