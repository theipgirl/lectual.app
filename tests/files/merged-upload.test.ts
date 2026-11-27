import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writesTo } from "../matters/helpers/fake-db";
import { MERGE_POINTER_UNREADABLE } from "../../src/lib/ui/words";
import { LEAD, ORG, loadActions, makeWorld, seedTables } from "./helpers";

const MERGED = "77777777-7777-4777-8777-777777777777";
const FILE = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const tables = () =>
  seedTables({
    crm_lead: [
      { id: LEAD, org_id: ORG, first_name: "K", last_name: "Keeper", merged_into_id: null },
      { id: MERGED, org_id: ORG, first_name: "M", last_name: "Merged", merged_into_id: LEAD },
    ],
  });

describe("an upload from a page opened before a merge goes to the keeper", () => {
  it("request and confirm agree on the keeper's path; row and timeline use the keeper", async () => {
    const keeperPath = `${ORG}/lead/${LEAD}/${FILE}.pdf`;
    const world = makeWorld({ tables: tables(), objects: { [keeperPath]: 1000 } });
    const { requestUploadAction, confirmUploadAction, revalidated } = await loadActions(world);

    const req = await requestUploadAction({ kind: "lead", id: MERGED }, "a.pdf", "application/pdf", 1000);
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    const [call] = world.storage.callsTo("createSignedUploadUrl");
    expect(call.args[0]).toBe(`${ORG}/lead/${LEAD}/${req.fileId}.pdf`);

    const done = await confirmUploadAction({ kind: "lead", id: MERGED }, FILE, "a.pdf");
    expect(done).toEqual({ ok: true, fileId: FILE });
    const [insert] = writesTo(world.db, "crm_file");
    expect(insert.payload).toMatchObject({ lead_id: LEAD, storage_path: keeperPath });
    expect(JSON.stringify(world.db.rows("crm_file"))).not.toContain(MERGED);
    expect(revalidated).toEqual([`/dashboard/leads/${LEAD}/`, "/dashboard/review/"]);
    expect(world.db.rows("crm_activity").every((a) => a.lead_id !== MERGED)).toBe(true);
  });

  it("an unreadable pointer refuses with the merge sentence and writes nothing", async () => {
    const world = makeWorld({ tables: tables(), objects: { [`${ORG}/lead/${LEAD}/${FILE}.pdf`]: 10 } });
    world.db.fail("crm_lead", "select");
    const { requestUploadAction, confirmUploadAction } = await loadActions(world);
    expect(await requestUploadAction({ kind: "lead", id: MERGED }, "a.pdf", "application/pdf", 10)).toEqual({ ok: false, error: MERGE_POINTER_UNREADABLE });
    expect(await confirmUploadAction({ kind: "lead", id: MERGED }, FILE, "a.pdf")).toEqual({ ok: false, error: MERGE_POINTER_UNREADABLE });
    expect(world.storage.callsTo("createSignedUploadUrl")).toHaveLength(0);
    expect(writesTo(world.db, "crm_file")).toHaveLength(0);
  });

  it("matters are unchanged", async () => {
    const world = makeWorld({ tables: tables() });
    const { requestUploadAction } = await loadActions(world);
    const r = await requestUploadAction({ kind: "matter", id: "22222222-2222-4222-8222-222222222222" }, "a.pdf", "", 10);
    expect(r.ok).toBe(true);
  });
});
