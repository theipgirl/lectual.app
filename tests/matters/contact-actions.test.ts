import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, type FakeDb } from "./helpers/fake-db";
import { READ_ONLY_ROLES, WRITE_ROLES, formData, standardSeed } from "./helpers/seed";

const h = vi.hoisted(() => ({ db: null as unknown as { client(): unknown } }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { searchContactsAction, linkContactAction, addContactAction, editContactAction, updateMatterNotesAction } = await import(
  "../../src/app/dashboard/matters/[id]/actions"
);

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb({ tables: standardSeed() });
  h.db = db;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const linkRow = { id: "l-1", org_id: "org-1", matter_id: "matter-1", contact_id: "contact-1", role: "client", created_at: "2026-02-01T00:00:00Z" };

describe("contact actions (role matrix)", () => {
  it.each(READ_ONLY_ROLES)("refuses %s for search, link, add and edit, and never asks the client to write", async (role) => {
    db.role = role;
    db.rows("crm_matter_contact").push({ ...linkRow });
    const results = [
      await searchContactsAction({}, formData({ matterId: "matter-1", q: "ana" })),
      await linkContactAction({}, formData({ matterId: "matter-1", contactId: "contact-2" })),
      await addContactAction({}, formData({ matterId: "matter-1", firstName: "Zed" })),
      await editContactAction({}, formData({ matterId: "matter-1", contactId: "contact-1", phone: "1" })),
    ];
    for (const r of results) expect(r.error).toMatch(/permission/i);
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("refuses a caller whose role cannot be resolved", async () => {
    db.role = null;
    expect((await linkContactAction({}, formData({ matterId: "matter-1", contactId: "contact-2" }))).error).toMatch(/permission/i);
    expect(db.writes).toEqual([]);
  });

  it.each(WRITE_ROLES)("lets %s search, link, add and edit, with one timeline row per write", async (role) => {
    db.role = role;
    const search = await searchContactsAction({}, formData({ matterId: "matter-1", q: "ana" }));
    expect(search.error).toBeUndefined();
    expect(search.hits?.map((x) => x.id)).toEqual(["contact-1"]);

    expect(await linkContactAction({}, formData({ matterId: "matter-1", contactId: "contact-1" }))).toEqual({ saved: true, message: "Linked." });
    expect((await addContactAction({}, formData({ matterId: "matter-1", firstName: "Zed", email: "zed@example.com" }))).message).toMatch(/Zed was added and linked/);
    expect(await editContactAction({}, formData({ matterId: "matter-1", contactId: "contact-1", phone: "555-0222" }))).toEqual({ saved: true });
    expect(db.activity().map((a) => (a.payload as { change: string }).change)).toEqual(["contact_linked", "contact_added", "contact_edited"]);
  });
});

describe("contact actions (foreign and unknown ids)", () => {
  it("answers 'couldn't be found' and writes nothing for another firm's matter or contact", async () => {
    db.rows("crm_matter_contact").push({ ...linkRow });
    const results = [
      await linkContactAction({}, formData({ matterId: "matter-x", contactId: "contact-1" })),
      await linkContactAction({}, formData({ matterId: "matter-1", contactId: "contact-x" })),
      await addContactAction({}, formData({ matterId: "matter-x", firstName: "Zed" })),
      await editContactAction({}, formData({ matterId: "matter-1", contactId: "contact-x", phone: "1" })),
      await editContactAction({}, formData({ matterId: "matter-x", contactId: "contact-1", phone: "1" })),
    ];
    for (const r of results) expect(r.error).toMatch(/couldn't be found/);
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("never takes an org id from the form", async () => {
    await addContactAction({}, formData({ matterId: "matter-1", firstName: "Hal", orgId: "org-2", org_id: "org-2" }));
    const created = db.rows("crm_contact").find((c) => c.first_name === "Hal")!;
    expect(created.org_id).toBe("org-1");
    expect(db.rows("crm_matter_contact")[0].org_id).toBe("org-1");
  });
});

describe("contact action messages", () => {
  it("says so when a contact was already linked, and writes no second row", async () => {
    await linkContactAction({}, formData({ matterId: "matter-1", contactId: "contact-1" }));
    const again = await linkContactAction({}, formData({ matterId: "matter-1", contactId: "contact-1" }));
    expect(again).toEqual({ saved: true, message: "Already linked to this matter." });
    expect(db.rows("crm_matter_contact")).toHaveLength(1);
    expect(db.activity()).toHaveLength(1);
  });

  it("says the existing contact was linked when an added contact's email already exists", async () => {
    const res = await addContactAction({}, formData({ matterId: "matter-1", firstName: "Ann", email: "ANA@example.com" }));
    expect(res.message).toMatch(/Ana Smith already has that email, so that contact was linked instead of adding a second one/);
    expect(db.rows("crm_contact").filter((c) => c.org_id === "org-1")).toHaveLength(2);
  });

  it("reports the saved-but-not-linked case in plain words", async () => {
    db.fail("crm_matter_contact", "insert");
    const res = await addContactAction({}, formData({ matterId: "matter-1", firstName: "Dee" }));
    expect(res.error).toMatch(/contact was saved, but couldn't be linked/i);
  });

  it("returns an error state for a failed search, never an empty hit list", async () => {
    db.fail("crm_contact", "select");
    const res = await searchContactsAction({}, formData({ matterId: "matter-1", q: "ana" }));
    expect(res.error).toMatch(/Couldn't search contacts/);
    expect(res.hits).toBeUndefined();
  });

  it("returns only the fields the panel needs for each hit", async () => {
    const res = await searchContactsAction({}, formData({ matterId: "matter-1", q: "ana" }));
    expect(Object.keys(res.hits![0]).sort()).toEqual(["companyName", "email", "id", "linked", "name", "phone"]);
  });

  it("tells the person to type more for a one-character search", async () => {
    expect(await searchContactsAction({}, formData({ matterId: "matter-1", q: "a" }))).toMatchObject({ tooShort: true, hits: [], searched: true });
  });
});

describe("staff notes save is logged (F11)", () => {
  const post = (notes: string) => formData({ matterId: "matter-1", notes });

  it("logs 'Notes updated' once when the text changed, with none of the text", async () => {
    expect(await updateMatterNotesAction({}, post("Client wants an expedited filing."))).toEqual({ saved: true });
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0].payload).toEqual({ change: "notes" });
    expect(db.activity()[0].matter_id).toBe("matter-1");
  });

  it("logs nothing when the text is unchanged, and nothing when cleared from empty", async () => {
    await updateMatterNotesAction({}, post("Same text"));
    db.activity().length = 0;
    await updateMatterNotesAction({}, post("Same text"));
    expect(db.activity()).toEqual([]);
    await updateMatterNotesAction({}, post(""));
    expect(db.activity()).toHaveLength(1); // clearing real text is a change
    db.activity().length = 0;
    await updateMatterNotesAction({}, post(""));
    expect(db.activity()).toEqual([]);
  });

  it.each(READ_ONLY_ROLES)("refuses %s without writing", async (role) => {
    db.role = role;
    expect((await updateMatterNotesAction({}, post("x"))).error).toMatch(/permission/i);
    expect(db.writes).toEqual([]);
  });

  it.each(WRITE_ROLES)("lets %s save and logs the change", async (role) => {
    db.role = role;
    expect(await updateMatterNotesAction({}, post("Note from " + role))).toEqual({ saved: true });
    expect(db.activity()).toHaveLength(1);
  });

  it("answers 'couldn't be found' for another firm's matter", async () => {
    const res = await updateMatterNotesAction({}, formData({ matterId: "matter-x", notes: "x" }));
    expect(res.error).toMatch(/couldn't be found/);
    expect(db.writes).toEqual([]);
  });
});
