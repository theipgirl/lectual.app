import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_ID, ORG, OTHER_LEAD, OTHER_ORG, fileRow, makeWorld, pathFor, seedTables } from "./helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function get(world: ReturnType<typeof makeWorld>, id: string) {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
  const { GET } = await import("../../src/app/dashboard/files/[id]/download/route");
  return GET(new Request("https://app.test/dashboard/files/x/download/") as never, { params: Promise.resolve({ id }) });
}

const withFile = (over = {}, role = "viewer") => makeWorld({ role, tables: seedTables({ crm_file: [fileRow(over)] }) });

describe("GET /dashboard/files/[id]/download", () => {
  it("answers 303 to a signed URL minted through the scoped client with a 60-second expiry and the original name", async () => {
    const world = withFile();
    const res = await get(world, FILE_ID);
    expect(res.status).toBe(303);
    const [call] = world.storage.callsTo("createSignedUrl");
    expect(call.bucket).toBe("client-files");
    expect(call.args[0]).toBe(pathFor("lead", FILE_ID, "pdf"));
    expect(call.args[1]).toBe(60);
    expect(call.args[2]).toEqual({ download: "Signed LOE.pdf" });
    expect(res.headers.get("location")).toBe(`https://storage.test/object/sign/client-files/${pathFor("lead", FILE_ID, "pdf")}?token=DL&exp=60`);
  });

  it("lets any signed-in member download, a viewer included", async () => {
    for (const role of ["viewer", "social_media", "attorney", "owner"]) {
      expect((await get(withFile({}, role), FILE_ID)).status).toBe(303);
    }
  });

  it("reads the row through the scoped client only", async () => {
    const world = withFile();
    await get(world, FILE_ID);
    expect(world.db.froms).toEqual(["crm_file"]);
  });

  it("answers 404 for a row that is not found (another org's id is invisible under RLS)", async () => {
    const other = fileRow({ org_id: OTHER_ORG, lead_id: OTHER_LEAD, storage_path: pathFor("lead", FILE_ID, "pdf", OTHER_ORG, OTHER_LEAD) });
    const world = makeWorld({ tables: seedTables({ crm_file: [other] }) });
    const res = await get(world, FILE_ID);
    expect(res.status).toBe(404);
    expect(world.storage.calls).toEqual([]);
    expect((await get(withFile(), "99999999-9999-4999-8999-999999999999")).status).toBe(404);
  });

  it("answers 404 for a signed-URL error", async () => {
    const world = withFile();
    world.storage.errors.createSignedUrl = { message: "Object not found" };
    expect((await get(world, FILE_ID)).status).toBe(404);
  });

  it("answers 404 for a row with no path, and for a database error", async () => {
    expect((await get(withFile({ storage_path: "" }), FILE_ID)).status).toBe(404);
    expect((await get(withFile({ storage_path: null }), FILE_ID)).status).toBe(404);
    const failing = withFile();
    failing.db.fail("crm_file", "select");
    const res = await get(failing, FILE_ID);
    expect(res.status).toBe(404);
    expect(failing.storage.calls).toEqual([]);
  });

  it("is a different route from the letters download, which is unchanged", async () => {
    const { readFileSync } = await import("node:fs");
    const letters = readFileSync("src/app/dashboard/documents/[id]/download/route.ts", "utf8");
    expect(letters).toContain('"matter-documents"');
    expect(letters).not.toContain("client-files");
    expect(ORG).toBeTruthy();
  });
});
