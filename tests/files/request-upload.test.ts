import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_MESSAGES, EXTENSION_MIME } from "../../src/lib/files/rules";
import { LEAD, MATTER, NON_STAFF_ROLES, ORG, OTHER_LEAD, OTHER_MATTER, OTHER_ORG, SECRET, STAFF_ROLES, loadActions, makeWorld, seedTables } from "./helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MB = 1024 * 1024;

describe("requestUploadAction: a signed upload for a lead or matter", () => {
  it.each(STAFF_ROLES)("%s gets a signed upload for a lead at {org}/lead/{lead}/{file}.pdf", async (role) => {
    const world = makeWorld({ role });
    const { requestUploadAction } = await loadActions(world);
    const r = await requestUploadAction({ kind: "lead", id: LEAD }, "Signed LOE.pdf", "application/pdf", 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [call] = world.storage.callsTo("createSignedUploadUrl");
    expect(call.bucket).toBe("client-files");
    expect(call.args[0]).toMatch(new RegExp(`^${ORG}/lead/${LEAD}/${UUID}\\.pdf$`));
    expect(call.args[0]).toBe(`${ORG}/lead/${LEAD}/${r.fileId}.pdf`);
    expect(r.signedUrl).toContain(`${ORG}/lead/${LEAD}/${r.fileId}.pdf`);
    expect(r.token).toBe("TKN");
    expect(r.mime).toBe("application/pdf");
  });

  it.each(STAFF_ROLES)("%s gets a signed upload for a matter at {org}/matter/{matter}/{file}.docx", async (role) => {
    const world = makeWorld({ role });
    const { requestUploadAction } = await loadActions(world);
    const r = await requestUploadAction({ kind: "matter", id: MATTER }, "letter.docx", "", 1000);
    expect(r.ok).toBe(true);
    const [call] = world.storage.callsTo("createSignedUploadUrl");
    expect(call.args[0]).toMatch(new RegExp(`^${ORG}/matter/${MATTER}/${UUID}\\.docx$`));
  });

  it("takes the org from the parent ROW, even when the browser sends extra fields", async () => {
    const world = makeWorld({
      tables: seedTables({ crm_lead: [{ id: LEAD, org_id: OTHER_ORG }] }),
    });
    // The session's org is OTHER_ORG here, matching the row; nothing in the call names an org.
    world.db.orgId = OTHER_ORG;
    const { requestUploadAction } = await loadActions(world);
    const hostile = { kind: "lead", id: LEAD, org_id: ORG, orgId: ORG } as unknown as { kind: "lead"; id: string };
    const r = await requestUploadAction(hostile, "a.pdf", "application/pdf", 10);
    expect(r.ok).toBe(true);
    const [call] = world.storage.callsTo("createSignedUploadUrl");
    expect(String(call.args[0]).startsWith(`${OTHER_ORG}/lead/${LEAD}/`)).toBe(true);
    expect(String(call.args[0])).not.toContain(ORG);
  });

  it("has no org parameter in its signature", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/app/dashboard/files/actions.ts"), "utf8");
    const sig = src.slice(src.indexOf("export async function requestUploadAction("), src.indexOf("): Promise<RequestUploadResult>"));
    expect(sig).toMatch(/parent: FileParentInput/);
    expect(sig).not.toMatch(/org/i);
    const confirm = src.slice(src.indexOf("export async function confirmUploadAction("), src.indexOf("Promise<ConfirmUploadResult>"));
    expect(confirm).not.toMatch(/org/i);
  });
});

describe("requestUploadAction: refusals touch no storage", () => {
  async function refused(world: ReturnType<typeof makeWorld>, ...args: Parameters<Awaited<ReturnType<typeof loadActions>>["requestUploadAction"]>) {
    const { requestUploadAction } = await loadActions(world);
    const r = await requestUploadAction(...args);
    expect(world.storage.calls).toEqual([]);
    expect(r.ok).toBe(false);
    return r as { ok: false; error: string };
  }

  it("a parent from another org reads as not found (RLS shows no row)", async () => {
    expect((await refused(makeWorld(), { kind: "lead", id: OTHER_LEAD }, "a.pdf", "application/pdf", 10)).error).toBe(FILE_MESSAGES.notFound);
    expect((await refused(makeWorld(), { kind: "matter", id: OTHER_MATTER }, "a.pdf", "application/pdf", 10)).error).toBe(FILE_MESSAGES.notFound);
  });

  it("a deleted parent, a malformed id and an unknown kind are not found", async () => {
    const gone = "99999999-9999-4999-8999-999999999999";
    expect((await refused(makeWorld(), { kind: "lead", id: gone }, "a.pdf", "x", 10)).error).toBe(FILE_MESSAGES.notFound);
    for (const id of ["lead-1", "", "../x", `${LEAD}/x`]) {
      const world = makeWorld();
      expect((await refused(world, { kind: "lead", id }, "a.pdf", "x", 10)).error).toBe(FILE_MESSAGES.notFound);
      expect(world.db.froms).toEqual([]); // not even a database read
    }
    for (const kind of ["contact", "", "LEAD", undefined, null]) {
      const world = makeWorld();
      expect((await refused(world, { kind, id: LEAD } as never, "a.pdf", "x", 10)).error).toBe(FILE_MESSAGES.notFound);
    }
    expect((await refused(makeWorld(), null as never, "a.pdf", "x", 10)).error).toBe(FILE_MESSAGES.notFound);
  });

  it.each(["virus.exe", "a.zip", "page.html", "logo.svg", "run.js", "noextension", "ends-with-dot.", "invoice.pdf.exe"])("refuses %s, even when the browser claims application/pdf", async (name) => {
    const r = await refused(makeWorld(), { kind: "lead", id: LEAD }, name, "application/pdf", 10);
    expect(r.error).toBe(FILE_MESSAGES.badType);
  });

  it.each(NON_STAFF_ROLES)("refuses %s with a plain sentence", async (role) => {
    const r = await refused(makeWorld({ role }), { kind: "lead", id: LEAD }, "a.pdf", "application/pdf", 10);
    expect(r.error).toBe(FILE_MESSAGES.cantUpload);
  });

  it("refuses when the role cannot be resolved (nothing returned, or the read fails)", async () => {
    expect((await refused(makeWorld({ role: null }), { kind: "lead", id: LEAD }, "a.pdf", "x", 10)).error).toBe(FILE_MESSAGES.roleUnknown);
    const r = await refused(makeWorld({ client: { roleError: true } }), { kind: "lead", id: LEAD }, "a.pdf", "x", 10);
    expect(r.error).toBe(FILE_MESSAGES.roleUnknown);
    expect(r.error).not.toContain(SECRET);
  });

  it("refuses with no session", async () => {
    const r = await refused(makeWorld({ client: { signedIn: false } }), { kind: "lead", id: LEAD }, "a.pdf", "x", 10);
    expect(r.error).toBe(FILE_MESSAGES.signedOut);
  });

  it("refuses a file over 25 MB with a sentence naming 25 MB, and accepts exactly 25 MB", async () => {
    const r = await refused(makeWorld(), { kind: "lead", id: LEAD }, "a.pdf", "application/pdf", 25 * MB + 1);
    expect(r.error).toContain("25 MB");
    const world = makeWorld();
    const { requestUploadAction } = await loadActions(world);
    expect((await requestUploadAction({ kind: "lead", id: LEAD }, "a.pdf", "application/pdf", 26_214_400)).ok).toBe(true);
  });

  it.each([0, -5, 1.5, Number.NaN])("refuses size %s", async (size) => {
    const r = await refused(makeWorld(), { kind: "lead", id: LEAD }, "a.pdf", "application/pdf", size);
    expect(r.error).toContain("25 MB");
  });
});

describe("requestUploadAction: the extension decides, whatever the browser says", () => {
  const cases = [
    ["note.msg", "application/vnd.ms-outlook"],
    ["mail.eml", "message/rfc822"],
    ["Photo.HEIC", "image/heic"],
    ["SCAN.PDF", "application/pdf"],
  ] as const;
  for (const [name, mapped] of cases) {
    for (const claimed of ["", "application/octet-stream", "text/html", "image/gif"]) {
      it(`${name} with browser type ${JSON.stringify(claimed)} is accepted as ${mapped}`, async () => {
        const world = makeWorld();
        const { requestUploadAction } = await loadActions(world);
        const r = await requestUploadAction({ kind: "lead", id: LEAD }, name, claimed, 100);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.mime).toBe(mapped);
      });
    }
  }

  it.each(Object.entries(EXTENSION_MIME))("maps .%s to %s", async (ext, mime) => {
    const world = makeWorld();
    const { requestUploadAction } = await loadActions(world);
    const r = await requestUploadAction({ kind: "matter", id: MATTER }, `file.${ext}`, "wrong/type", 100);
    expect(r).toMatchObject({ ok: true, mime });
    expect(world.storage.callsTo("createSignedUploadUrl")[0].args[0]).toMatch(new RegExp(`\\.${ext}$`));
  });
});

describe("requestUploadAction: a hostile file name never changes the path", () => {
  const names = [
    `../../${OTHER_ORG}/lead/x/y.pdf`,
    "a/b/c.pdf",
    "a\\b\\c.pdf",
    "evil\u0000\u001f\n.pdf",
    `${"x".repeat(400)}.pdf`,
    `${OTHER_ORG}/${OTHER_LEAD}.pdf`,
  ];
  for (const name of names) {
    it(`name ${JSON.stringify(name.slice(0, 40))}`, async () => {
      const world = makeWorld();
      const { requestUploadAction } = await loadActions(world);
      const r = await requestUploadAction({ kind: "lead", id: LEAD }, name, "application/pdf", 10);
      expect(r.ok).toBe(true);
      const requested = String(world.storage.callsTo("createSignedUploadUrl")[0].args[0]);
      expect(requested).toMatch(new RegExp(`^${ORG}/lead/${LEAD}/${UUID}\\.pdf$`));
      expect(requested).not.toContain(OTHER_ORG);
    });
  }
});

describe("requestUploadAction: storage errors", () => {
  it("says the storage is not set up when the bucket is missing, without throwing", async () => {
    const world = makeWorld();
    world.storage.errors.createSignedUploadUrl = { message: "Bucket not found", status: 404, statusCode: "404" };
    const { requestUploadAction } = await loadActions(world);
    const r = await requestUploadAction({ kind: "lead", id: LEAD }, "a.pdf", "application/pdf", 10);
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.notSetUp, notSetUp: true });
  });

  it("returns a generic sentence with no raw text for any other storage error, and logs the code only", async () => {
    const world = makeWorld();
    world.storage.errors.createSignedUploadUrl = { message: SECRET, statusCode: "500" };
    const { requestUploadAction } = await loadActions(world);
    const r = await requestUploadAction({ kind: "lead", id: LEAD }, "a.pdf", "application/pdf", 10);
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.generic });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain(SECRET);
  });

  it("does not leak a database error from reading the parent", async () => {
    const world = makeWorld();
    world.db.fail("crm_lead", "select", { code: "XX000", message: SECRET });
    const { requestUploadAction } = await loadActions(world);
    const r = await requestUploadAction({ kind: "lead", id: LEAD }, "a.pdf", "application/pdf", 10);
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.generic });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(world.storage.calls).toEqual([]);
  });

  it("never throws when the scoped client itself cannot be built", async () => {
    const world = makeWorld();
    const actions = await loadActions(world);
    const bad = { ...world.client, auth: { getUser: async () => { throw new Error(SECRET); } } };
    Object.assign(world, { client: bad });
    const r = await actions.requestUploadAction({ kind: "lead", id: LEAD }, "a.pdf", "application/pdf", 10);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});
