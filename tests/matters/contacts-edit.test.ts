import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, writesTo, type FakeDb, type Row } from "./helpers/fake-db";
import { ORG, standardSeed } from "./helpers/seed";
import {
  CONTACT_SEARCH_LIMIT,
  isPlausibleEmail,
  likeEscape,
  postgrestQuote,
  searchTokens,
  validateContactFields,
} from "@/lib/matters/contact-input";

const h = vi.hoisted(() => ({ db: null as unknown as { client(): unknown }, client: null as null | (() => unknown) }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => (h.client ? h.client() : h.db.client())) }));

const {
  addContactToMatter,
  ensureMatterContactLink,
  linkContactToMatter,
  linkMatterContact,
  loadMatterContacts,
  primaryClientContact,
  searchContacts,
  updateContact,
} = await import("@/lib/matters/contacts");

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb({ tables: standardSeed() });
  h.db = db;
  h.client = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const link = (id: string, contact: string, extra: Row = {}): Row => ({ id, org_id: ORG, matter_id: "matter-1", contact_id: contact, role: "client", created_at: "2026-02-01T00:00:00Z", ...extra });

describe("contact input rules (pure)", () => {
  it("normalises, returns only changed fields, and keeps a name", () => {
    const current = { first_name: "Ana", last_name: "Smith", business_name: null, email: "ana@example.com", phone: null, company_name: null };
    expect(validateContactFields({ firstName: " Ana ", phone: " 555 " }, current)).toEqual({ ok: true, changes: { phone: "555" }, fields: ["phone"] });
    expect(validateContactFields({ email: "" }, current)).toEqual({ ok: true, changes: { email: null }, fields: ["email"] });
  });

  it("refuses a bad email and a contact left with no name", () => {
    const current = { first_name: "Ana", last_name: "Smith", business_name: null, email: null, phone: null, company_name: null };
    for (const email of ["nope", "a@b", "a b@c.com", "@c.com"]) {
      expect(validateContactFields({ email }, current).ok).toBe(false);
    }
    expect(validateContactFields({ firstName: "", lastName: "" }, current)).toEqual({ ok: false, error: "A contact needs a first name, a last name or a business name." });
    // A business name keeps a contact valid.
    expect(validateContactFields({ firstName: "", lastName: "", businessName: "Acme LLC" }, current).ok).toBe(true);
    expect(validateContactFields({}, null).ok).toBe(false);
  });

  it("checks lengths and recognises plausible addresses", () => {
    expect(validateContactFields({ firstName: "x".repeat(101) }, null)).toMatchObject({ ok: false });
    expect(isPlausibleEmail("first.last+tag@sub.example.co")).toBe(true);
    expect(isPlausibleEmail("x@y")).toBe(false);
  });

  it("escapes LIKE wildcards, quotes PostgREST values and splits words", () => {
    expect(likeEscape("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(postgrestQuote('a,b(c)"d\\')).toBe('"a,b(c)\\"d\\\\"');
    expect(searchTokens("  ana   smith ")).toEqual(["ana", "smith"]);
    expect(searchTokens("a b c d e f")).toHaveLength(4);
  });
});

describe("searchContacts", () => {
  it("returns only this firm's contacts, case-insensitively, by name, business name or email", async () => {
    db.rows("crm_contact").push({ id: "contact-biz", org_id: ORG, first_name: null, last_name: null, business_name: "Zephyr Holdings", email: "ops@zephyr.example", created_at: "2026-01-05T00:00:00Z" });
    const byFirst = await searchContacts("matter-1", "ANA");
    expect(byFirst).toMatchObject({ status: "ok", tooShort: false });
    // contact-x ("Ana Other") belongs to another firm and is invisible.
    expect(byFirst.status === "ok" && byFirst.contacts.map((c) => c.id)).toEqual(["contact-1"]);

    const byBiz = await searchContacts("matter-1", "zephyr");
    expect(byBiz.status === "ok" && byBiz.contacts.map((c) => c.id)).toEqual(["contact-biz"]);
    const byEmail = await searchContacts("matter-1", "BO@example");
    expect(byEmail.status === "ok" && byEmail.contacts.map((c) => c.id)).toEqual(["contact-2"]);
  });

  it("matches every word of the query against any name column", async () => {
    const res = await searchContacts("matter-1", "ana smith");
    expect(res.status === "ok" && res.contacts.map((c) => c.id)).toEqual(["contact-1"]);
    const none = await searchContacts("matter-1", "ana lee");
    expect(none.status === "ok" && none.contacts).toEqual([]);
  });

  it("returns at most 10, and nothing at all for fewer than 2 characters", async () => {
    for (let i = 0; i < 14; i++) db.rows("crm_contact").push({ id: `c-bulk-${i}`, org_id: ORG, first_name: "Mia", last_name: `Bulk${String(i).padStart(2, "0")}`, email: null, created_at: "2026-03-01T00:00:00Z" });
    const res = await searchContacts("matter-1", "mia");
    expect(res.status === "ok" && res.contacts).toHaveLength(CONTACT_SEARCH_LIMIT);

    db.orExpressions.length = 0;
    const short = await searchContacts("matter-1", "a ");
    expect(short).toEqual({ status: "ok", contacts: [], tooShort: true });
    expect(db.orExpressions).toEqual([]);
  });

  it("flags the contacts already linked to this matter", async () => {
    db.rows("crm_matter_contact").push(link("l-1", "contact-1"));
    db.rows("crm_contact").push({ id: "contact-3", org_id: ORG, first_name: "Anabel", last_name: "Reyes", email: null, created_at: "2026-01-06T00:00:00Z" });
    const res = await searchContacts("matter-1", "ana");
    expect(res.status === "ok" && Object.fromEntries(res.contacts.map((c) => [c.id, c.linked]))).toEqual({ "contact-1": true, "contact-3": false });
  });

  it("treats %, _, commas and parentheses as plain text", async () => {
    db.rows("crm_contact").push(
      { id: "c-pct", org_id: ORG, first_name: "Pat", last_name: "100%_Sure", email: null, created_at: "2026-01-07T00:00:00Z" },
      { id: "c-par", org_id: ORG, first_name: "Quinn", last_name: "Lee, (Jr)", email: null, created_at: "2026-01-08T00:00:00Z" },
    );
    const ids = async (q: string) => {
      const res = await searchContacts("matter-1", q);
      return res.status === "ok" ? res.contacts.map((c) => c.id) : "error";
    };
    expect(await ids("0%")).toEqual(["c-pct"]);
    expect(await ids("%_")).toEqual(["c-pct"]);
    expect(await ids("%%")).toEqual([]); // "%" is not "anything"
    expect(await ids("a_")).toEqual([]); // "_" is not "any one character" (it would match "Ana")
    expect(await ids("Lee, (Jr")).toEqual(["c-par"]); // each word is searched; a comma or paren never ends the filter
    expect(await ids("(jr)")).toEqual(["c-par"]);
    expect(await ids('"')).toEqual([]);
    expect(await ids("\\")).toEqual([]);
  });

  it("returns an error state, never an empty list, when the search fails", async () => {
    db.fail("crm_contact", "select");
    expect(await searchContacts("matter-1", "ana")).toEqual({ status: "error" });
    db = createFakeDb({ tables: standardSeed() });
    h.db = db;
    db.fail("crm_matter_contact", "select");
    expect(await searchContacts("matter-1", "ana")).toEqual({ status: "error" });
  });

  it("is refused for a read-only role", async () => {
    db.role = "viewer";
    await expect(searchContacts("matter-1", "ana")).rejects.toThrow(/Forbidden/);
  });
});

describe("linking a contact", () => {
  it("creates exactly one link and one 'Contact linked' row, org_id taken from the matter", async () => {
    const res = await linkContactToMatter("matter-1", "contact-1");
    expect(res.created).toBe(true);
    expect(db.rows("crm_matter_contact")).toHaveLength(1);
    expect(db.rows("crm_matter_contact")[0]).toMatchObject({ org_id: ORG, matter_id: "matter-1", contact_id: "contact-1", role: "client" });
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0].payload).toEqual({ change: "contact_linked", contact_id: "contact-1", role: "client" });
    expect(db.activity()[0].matter_id).toBe("matter-1");
  });

  it("linking the same contact again returns the existing link and writes no second row or log", async () => {
    const first = await linkContactToMatter("matter-1", "contact-1");
    const writesBefore = db.writes.length;
    const second = await linkContactToMatter("matter-1", "contact-1");
    expect(second.created).toBe(false);
    expect(second.link.id).toBe(first.link.id);
    expect(db.rows("crm_matter_contact")).toHaveLength(1);
    expect(db.activity()).toHaveLength(1);
    expect(db.writes).toHaveLength(writesBefore);
  });

  it("reports another firm's contact or matter as not found and writes nothing", async () => {
    await expect(linkContactToMatter("matter-1", "contact-x")).rejects.toThrow(/contact couldn't be found/);
    await expect(linkContactToMatter("matter-x", "contact-1")).rejects.toThrow(/matter couldn't be found/);
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("keeps the existing linkMatterContact contract (returns the link row), now idempotent", async () => {
    const a = await linkMatterContact("matter-1", "contact-2");
    const b = await linkMatterContact("matter-1", "contact-2");
    expect(b.id).toBe(a.id);
    expect(db.rows("crm_matter_contact")).toHaveLength(1);
    expect(db.activity()).toEqual([]); // the low-level helper never logged
  });

  it("returns the winner's link when it loses a race to the unique key", async () => {
    db.rows("crm_matter_contact").push(link("l-race", "contact-1"));
    const real = db.client();
    let firstLinkRead = true;
    h.client = () => ({
      ...real,
      from: (table: string) => {
        if (table === "crm_matter_contact" && firstLinkRead) {
          firstLinkRead = false;
          // The first look at the link table finds nothing (the other request hasn't committed yet) ...
          const empty = { select: () => empty, eq: () => empty, maybeSingle: async () => ({ data: null, error: null }) };
          return empty;
        }
        return real.from(table);
      },
    });
    // ... then the insert hits the unique key (23505) and the existing link is returned.
    const res = await ensureMatterContactLink("matter-1", "contact-1");
    expect(res.created).toBe(false);
    expect(res.link.id).toBe("l-race");
    expect(db.rows("crm_matter_contact")).toHaveLength(1);
  });

  it("does not change the matter's stage, status or owner", async () => {
    await linkContactToMatter("matter-1", "contact-1");
    expect(writesTo(db, "crm_matter")).toEqual([]);
  });
});

describe("addContactToMatter", () => {
  it("creates the contact and the link with this firm's org id and logs 'Contact added'", async () => {
    const res = await addContactToMatter("matter-1", { firstName: "Cy", lastName: "Park", email: "cy@example.com", phone: "555-0111" });
    expect(res).toMatchObject({ contactCreated: true, linkCreated: true });
    const created = db.rows("crm_contact").find((c) => c.email === "cy@example.com")!;
    expect(created.org_id).toBe(ORG);
    expect(created.phone).toBe("555-0111");
    expect(db.rows("crm_matter_contact")[0]).toMatchObject({ org_id: ORG, contact_id: created.id, role: "client" });
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0].payload).toEqual({ change: "contact_added", contact_id: created.id, role: "client" });
    expect(JSON.stringify(db.activity()[0].payload)).not.toContain("cy@example.com");
  });

  it("links the existing contact when the email matches (case-insensitive) and creates no second contact", async () => {
    const before = db.rows("crm_contact").length;
    const res = await addContactToMatter("matter-1", { firstName: "Another", lastName: "Ana", email: "ANA@Example.COM" });
    expect(res).toMatchObject({ contactCreated: false, linkCreated: true });
    expect(res.contact.id).toBe("contact-1");
    expect(db.rows("crm_contact")).toHaveLength(before);
    expect(db.rows("crm_matter_contact")).toHaveLength(1);
    expect(db.activity()[0].payload).toMatchObject({ change: "contact_linked", contact_id: "contact-1" });
  });

  it("does not match another firm's contact by email", async () => {
    const res = await addContactToMatter("matter-1", { firstName: "Ana", lastName: "Other", email: "ana@other.example" });
    expect(res.contactCreated).toBe(true);
    expect(res.contact.id).not.toBe("contact-x");
  });

  it("says the contact was saved but not linked when the link fails after the contact was created", async () => {
    db.fail("crm_matter_contact", "insert");
    await expect(addContactToMatter("matter-1", { firstName: "Dee", email: "dee@example.com" })).rejects.toThrow(/contact was saved, but couldn't be linked/i);
    expect(db.rows("crm_contact").some((c) => c.email === "dee@example.com")).toBe(true);
    expect(db.rows("crm_matter_contact")).toHaveLength(0);
    expect(db.activity()).toEqual([]);
  });

  it("refuses a bad email or no name without writing", async () => {
    await expect(addContactToMatter("matter-1", { firstName: "Eve", email: "not-an-email" })).rejects.toThrow(/valid email/);
    await expect(addContactToMatter("matter-1", { email: "eve@example.com" })).rejects.toThrow(/first name, a last name or a business name/);
    expect(db.writes).toEqual([]);
  });

  it("creates nothing for another firm's matter", async () => {
    await expect(addContactToMatter("matter-x", { firstName: "Fay" })).rejects.toThrow(/matter couldn't be found/);
    expect(db.writes).toEqual([]);
  });

  it("does not create a duplicate when the same add is repeated", async () => {
    await addContactToMatter("matter-1", { firstName: "Gus", email: "gus@example.com" });
    const again = await addContactToMatter("matter-1", { firstName: "Gus", email: "gus@example.com" });
    expect(again).toMatchObject({ contactCreated: false, linkCreated: false });
    expect(db.rows("crm_contact").filter((c) => c.email === "gus@example.com")).toHaveLength(1);
    expect(db.rows("crm_matter_contact")).toHaveLength(1);
    expect(db.activity()).toHaveLength(1);
  });
});

describe("updateContact", () => {
  beforeEach(() => {
    db.rows("crm_matter_contact").push(link("l-1", "contact-1"));
  });

  it("updates only the changed fields and logs 'Contact edited' with names, not values", async () => {
    const res = await updateContact("matter-1", "contact-1", { firstName: "Ana", lastName: "Smith", email: "ana.new@example.com", phone: "555-0999" });
    expect(res.fields).toEqual(["email", "phone"]);
    const [update] = writesTo(db, "crm_contact");
    expect(Object.keys(update.payload as object).sort()).toEqual(["email", "phone", "updated_at"]);
    expect(db.rows("crm_contact").find((c) => c.id === "contact-1")).toMatchObject({ email: "ana.new@example.com", phone: "555-0999", company_name: "Acme Inc" });
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0].payload).toEqual({ change: "contact_edited", contact_id: "contact-1", fields: ["email", "phone"] });
    expect(JSON.stringify(db.activity()[0].payload)).not.toMatch(/ana\.new|555-0999/);
  });

  it("writes nothing when nothing changed", async () => {
    const res = await updateContact("matter-1", "contact-1", { firstName: "Ana", email: "ana@example.com" });
    expect(res.fields).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("refuses a bad email and clearing every name field", async () => {
    await expect(updateContact("matter-1", "contact-1", { email: "oops" })).rejects.toThrow(/valid email/);
    await expect(updateContact("matter-1", "contact-1", { firstName: "", lastName: "" })).rejects.toThrow(/first name, a last name or a business name/);
    expect(db.writes).toEqual([]);
  });

  it("treats a contact that isn't linked to this matter, or belongs to another firm, as not found", async () => {
    await expect(updateContact("matter-1", "contact-2", { phone: "1" })).rejects.toThrow(/couldn't be found/);
    await expect(updateContact("matter-1", "contact-x", { phone: "1" })).rejects.toThrow(/couldn't be found/);
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });
});

describe("primaryClientContact and loadMatterContacts", () => {
  it("orders the client links explicitly (oldest first) and returns the oldest", async () => {
    db.rows("crm_matter_contact").push(
      link("l-new", "contact-2", { created_at: "2026-03-01T00:00:00Z" }),
      link("l-old", "contact-1", { created_at: "2026-01-15T00:00:00Z" }),
    );
    const primary = await primaryClientContact("matter-1");
    expect(primary?.id).toBe("contact-1");
    expect(db.orderCalls).toContainEqual(["crm_matter_contact", "created_at"]);
  });

  it("loadMatterContacts: linked, in link order, with the role", async () => {
    db.rows("crm_matter_contact").push(link("l-2", "contact-2", { created_at: "2026-03-01T00:00:00Z", role: "co-client" }), link("l-1", "contact-1"));
    const read = await loadMatterContacts("matter-1");
    expect(read.status).toBe("linked");
    if (read.status === "linked") {
      expect(read.contacts.map((c) => [c.id, c.role])).toEqual([["contact-1", "client"], ["contact-2", "co-client"]]);
      expect(read.contacts[0]).toMatchObject({ first_name: "Ana", email: "ana@example.com", phone: "555-0100", company_name: "Acme Inc" });
    }
  });

  it("loadMatterContacts: none when the read worked and nothing is linked", async () => {
    expect(await loadMatterContacts("matter-1")).toEqual({ status: "none" });
  });

  it("loadMatterContacts: unavailable (never none) when either read fails or a linked contact can't be read", async () => {
    db.fail("crm_matter_contact", "select");
    expect(await loadMatterContacts("matter-1")).toEqual({ status: "unavailable" });

    db = createFakeDb({ tables: standardSeed() });
    h.db = db;
    db.rows("crm_matter_contact").push(link("l-1", "contact-1"));
    db.fail("crm_contact", "select");
    expect(await loadMatterContacts("matter-1")).toEqual({ status: "unavailable" });

    db = createFakeDb({ tables: standardSeed() });
    h.db = db;
    db.rows("crm_matter_contact").push(link("l-x", "contact-x")); // points at another firm's contact: invisible
    expect(await loadMatterContacts("matter-1")).toEqual({ status: "unavailable" });
  });
});
