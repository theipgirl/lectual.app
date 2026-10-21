import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_MESSAGES } from "../../src/lib/files/rules";
import { writesTo } from "../matters/helpers/fake-db";
import { DELETE_ROLES, FILE_ID, LEAD, MATTER, NON_DELETE_ROLES, ORG, OTHER_LEAD, OTHER_ORG, SECRET, fileRow, loadActions, makeWorld, pathFor, seedTables } from "./helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const leadPath = pathFor("lead", FILE_ID, "pdf");
const worldWithFile = (opts: Parameters<typeof makeWorld>[0] = {}) =>
  makeWorld({ role: "admin", objects: { [leadPath]: 86_016 }, tables: seedTables({ crm_file: [fileRow()] }), ...opts });
const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");

describe("deleteFileAction: who may delete", () => {
  it.each(DELETE_ROLES)("%s deletes the object and the row", async (role) => {
    const world = worldWithFile({ role });
    const { deleteFileAction, revalidated } = await loadActions(world);
    expect(await deleteFileAction(FILE_ID)).toEqual({ ok: true });
    expect(world.db.rows("crm_file")).toEqual([]);
    expect(world.storage.objects.has(leadPath)).toBe(false);
    expect(revalidated).toEqual([`/dashboard/leads/${LEAD}/`]);
  });

  it.each(NON_DELETE_ROLES)("refuses %s with a sentence and touches neither storage nor the table", async (role) => {
    const world = worldWithFile({ role });
    const { deleteFileAction } = await loadActions(world);
    expect(await deleteFileAction(FILE_ID)).toEqual({ ok: false, error: FILE_MESSAGES.cantDelete });
    expect(world.storage.calls).toEqual([]);
    expect(world.db.froms).toEqual([]);
    expect(world.db.rows("crm_file")).toHaveLength(1);
  });

  it("refuses when the role cannot be resolved, and with no session", async () => {
    for (const opts of [{ role: null }, { client: { roleError: true } }, { client: { signedIn: false } }] as const) {
      const world = worldWithFile(opts);
      const { deleteFileAction } = await loadActions(world);
      const r = await deleteFileAction(FILE_ID);
      expect(r.ok).toBe(false);
      expect(world.storage.calls).toEqual([]);
      expect(world.db.froms).toEqual([]);
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
  });

  it("re-resolves the role on every call", async () => {
    const world = worldWithFile({ role: "admin" });
    const { deleteFileAction } = await loadActions(world);
    world.db.role = "viewer";
    expect((await deleteFileAction(FILE_ID)).ok).toBe(false);
    world.db.role = "owner";
    expect((await deleteFileAction(FILE_ID)).ok).toBe(true);
    expect(world.db.rpcCalls.filter((n) => n === "current_org_role")).toHaveLength(2);
  });
});

describe("deleteFileAction: order and failure branches", () => {
  it("removes the object first and the row second, using the row's own stored path", async () => {
    const world = worldWithFile();
    const { deleteFileAction } = await loadActions(world);
    await deleteFileAction(FILE_ID);
    const [remove] = world.storage.callsTo("remove");
    expect(remove.bucket).toBe("client-files");
    expect(remove.args[0]).toEqual([leadPath]);
    expect(world.storage.rowPresentAtRemove).toEqual([true]); // the row still existed when the object went
    expect(writesTo(world.db, "crm_file").map((w) => w.op)).toEqual(["delete"]);
    expect(world.db.rows("crm_file")).toEqual([]);
  });

  it("keeps the row and returns a sentence when removing the object fails with a real error", async () => {
    const world = worldWithFile();
    world.storage.errors.remove = { message: SECRET, statusCode: "500" };
    const { deleteFileAction } = await loadActions(world);
    const r = await deleteFileAction(FILE_ID);
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.deleteKept });
    expect(world.db.rows("crm_file")).toHaveLength(1);
    expect(writesTo(world.db, "crm_file")).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });

  it("still deletes the row when the object is already gone", async () => {
    const world = worldWithFile();
    world.storage.errors.remove = { message: "Object not found", statusCode: "404" };
    const { deleteFileAction } = await loadActions(world);
    expect(await deleteFileAction(FILE_ID)).toEqual({ ok: true });
    expect(world.db.rows("crm_file")).toEqual([]);
  });

  it("says the file is gone but the entry remains when the row delete fails, and a retry succeeds", async () => {
    const world = worldWithFile();
    world.db.fail("crm_file", "delete", { code: "XX000", message: SECRET });
    const { deleteFileAction } = await loadActions(world);
    const first = await deleteFileAction(FILE_ID);
    expect(first).toEqual({ ok: false, error: FILE_MESSAGES.deleteRowKept });
    expect(JSON.stringify(first)).not.toContain(SECRET);
    expect(world.storage.objects.has(leadPath)).toBe(false);
    expect(world.db.rows("crm_file")).toHaveLength(1);

    // The retry: the database works again, and the object being gone counts as removed.
    world.db.denyDeletes.clear();
    (world.db as unknown as { failures: unknown[] }).failures.length = 0;
    world.storage.errors.remove = { message: "Object not found", statusCode: "404" };
    expect(await deleteFileAction(FILE_ID)).toEqual({ ok: true });
    expect(world.db.rows("crm_file")).toEqual([]);
  });

  it("does not report success when the delete removed no row (RLS filtered it)", async () => {
    const world = worldWithFile();
    world.db.denyDeletes.add("crm_file");
    const { deleteFileAction } = await loadActions(world);
    expect(await deleteFileAction(FILE_ID)).toEqual({ ok: false, error: FILE_MESSAGES.deleteRowKept });
  });
});

describe("deleteFileAction: other firms and bad ids", () => {
  it("treats another org's file id as not found and removes nothing", async () => {
    const other = fileRow({ id: "66666666-6666-4666-8666-666666666666", org_id: OTHER_ORG, lead_id: OTHER_LEAD, storage_path: pathFor("lead", "66666666-6666-4666-8666-666666666666", "pdf", OTHER_ORG, OTHER_LEAD) });
    const world = makeWorld({ role: "owner", tables: seedTables({ crm_file: [other] }), objects: { [String(other.storage_path)]: 5 } });
    const { deleteFileAction } = await loadActions(world);
    expect(await deleteFileAction(String(other.id))).toEqual({ ok: false, error: FILE_MESSAGES.fileNotFound });
    expect(world.storage.callsTo("remove")).toEqual([]);
    expect(world.db.rows("crm_file")).toHaveLength(1);
  });

  it("treats a malformed id as not found with no read at all", async () => {
    const world = worldWithFile();
    const { deleteFileAction } = await loadActions(world);
    for (const id of ["nope", "", "../x"]) expect(await deleteFileAction(id)).toEqual({ ok: false, error: FILE_MESSAGES.fileNotFound });
    expect(world.db.froms).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  it("refuses a row whose path is not inside its own org folder, removing nothing", async () => {
    const world = makeWorld({ tables: seedTables({ crm_file: [fileRow({ storage_path: `${OTHER_ORG}/lead/x/y.pdf` })] }), role: "owner" });
    const { deleteFileAction } = await loadActions(world);
    expect((await deleteFileAction(FILE_ID)).ok).toBe(false);
    expect(world.storage.callsTo("remove")).toEqual([]);
    expect(world.db.rows("crm_file")).toHaveLength(1);
  });

  it("deletes a matter file and revalidates the matter page", async () => {
    const matterPath = pathFor("matter", FILE_ID, "docx");
    const row = fileRow({ lead_id: null, matter_id: MATTER, storage_path: matterPath, file_name: "x.docx" });
    const world = makeWorld({ tables: seedTables({ crm_file: [row] }), objects: { [matterPath]: 5 }, role: "admin" });
    const { deleteFileAction, revalidated } = await loadActions(world);
    expect(await deleteFileAction(FILE_ID)).toEqual({ ok: true });
    expect(revalidated).toEqual([`/dashboard/matters/${MATTER}/`]);
  });

  it("says storage is not set up when the table is missing, and never throws", async () => {
    const world = worldWithFile();
    world.db.fail("crm_file", "select", { code: "PGRST205", message: "Could not find the table" });
    const { deleteFileAction } = await loadActions(world);
    expect(await deleteFileAction(FILE_ID)).toEqual({ ok: false, error: FILE_MESSAGES.notSetUp, notSetUp: true });
  });

  it("returns only fixed sentences for a database read error", async () => {
    const world = worldWithFile();
    world.db.fail("crm_file", "select", { code: "XX000", message: `${SECRET} ${leadPath} ${ORG}` });
    const { deleteFileAction } = await loadActions(world);
    const r = JSON.stringify(await deleteFileAction(FILE_ID));
    for (const secret of [SECRET, leadPath, ORG]) expect(r).not.toContain(secret);
  });
});
