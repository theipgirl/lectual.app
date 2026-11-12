import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const scoped = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => scoped.db }));

import { MailingAddressCard } from "@/components/loe/MailingAddressCard";
import { addressLinesOf, loadSignedAddress, readSignedAddress } from "@/lib/loe/signed-address";
import { SIGNATURE_READ_ROLES } from "@/lib/loe/signature-roles";
import { ROLES } from "@/lib/auth/roles";

const LEAD = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const ADDRESS = { street: "100 Example Street", street2: "Suite 4", city: "Miami", region: "FL", postal: "33101", country: "United States" };

type Call = { table: string; select?: string; or?: string; in?: [string, string[]]; order?: unknown };
function fakeDb(answers: { proposals?: unknown; signatures?: unknown; throws?: boolean }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      if (answers.throws) throw new Error("boom");
      const call: Call = { table };
      calls.push(call);
      const q: Record<string, unknown> = {
        select(c: string) {
          call.select = c;
          return q;
        },
        or(f: string) {
          call.or = f;
          return q;
        },
        in(c: string, v: string[]) {
          call.in = [c, v];
          return q;
        },
        order(...a: unknown[]) {
          call.order = a;
          return q;
        },
        limit: async () => (table === "client_proposal" ? (answers.proposals ?? { data: [], error: null }) : (answers.signatures ?? { data: [], error: null })),
      };
      return q;
    },
  };
  return { db, calls };
}

describe("addressLinesOf", () => {
  it("lays the parts out one line each, and reads an empty or malformed column as nothing", () => {
    expect(addressLinesOf(ADDRESS)).toEqual(["100 Example Street", "Suite 4", "Miami, FL 33101", "United States"]);
    expect(addressLinesOf({ street: "1 A St" })).toEqual(["1 A St"]);
    for (const bad of [null, undefined, {}, [], "x", 5]) expect(addressLinesOf(bad)).toBeNull();
  });
});

describe("readSignedAddress", () => {
  it("shown: the newest signature of the record's proposals, with named columns only and a lead/matter-scoped filter", async () => {
    const { db, calls } = fakeDb({ proposals: { data: [{ id: "p1" }, { id: "p2" }], error: null }, signatures: { data: [{ id: "s1", proposal_id: "p2", address: ADDRESS, signed_at: "2026-11-12T19:14:00.000Z" }], error: null } });
    const r = await readSignedAddress(db, { matterId: MATTER, leadId: LEAD });
    expect(r).toEqual({ status: "ok", address: { lines: ["100 Example Street", "Suite 4", "Miami, FL 33101", "United States"], signedAt: "2026-11-12T19:14:00.000Z" } });
    expect(calls[0]).toMatchObject({ table: "client_proposal", select: "id", or: `matter_id.eq.${MATTER},lead_id.eq.${LEAD}` });
    expect(calls[1]).toMatchObject({ table: "client_proposal_signature", select: "id, proposal_id, address, signed_at", in: ["proposal_id", ["p1", "p2"]], order: ["signed_at", { ascending: false }] });
    for (const c of calls) for (const secret of ["agreement_text", "ip", "user_agent", "*"]) expect((c.select ?? "").split(/[ ,]+/)).not.toContain(secret);
  });

  it("a lead page asks only about the lead", async () => {
    const { db, calls } = fakeDb({});
    await readSignedAddress(db, { leadId: LEAD });
    expect(calls[0].or).toBe(`lead_id.eq.${LEAD}`);
  });

  it("nothing: no proposal, no signature, or a signature with no usable address", async () => {
    expect(await readSignedAddress(fakeDb({}).db, { leadId: LEAD })).toEqual({ status: "none" });
    expect(await readSignedAddress(fakeDb({ proposals: { data: [{ id: "p1" }], error: null } }).db, { leadId: LEAD })).toEqual({ status: "none" });
    expect(await readSignedAddress(fakeDb({ proposals: { data: [{ id: "p1" }], error: null }, signatures: { data: [{ id: "s", proposal_id: "p1", address: {}, signed_at: "2026-11-12T19:14:00.000Z" }], error: null } }).db, { leadId: LEAD })).toEqual({ status: "none" });
  });

  it("couldn't be loaded: either read failing, or throwing, is unavailable, never none", async () => {
    expect(await readSignedAddress(fakeDb({ proposals: { data: null, error: { code: "x" } } }).db, { leadId: LEAD })).toEqual({ status: "unavailable" });
    expect(await readSignedAddress(fakeDb({ proposals: { data: [{ id: "p1" }], error: null }, signatures: { data: null, error: { code: "x" } } }).db, { leadId: LEAD })).toEqual({ status: "unavailable" });
    expect(await readSignedAddress(fakeDb({ throws: true }).db, { leadId: LEAD })).toEqual({ status: "unavailable" });
  });

  it("an id that is not a uuid never reaches the filter", async () => {
    const { db, calls } = fakeDb({});
    expect(await readSignedAddress(db, { leadId: "x,lead_id.neq.1", matterId: null })).toEqual({ status: "none" });
    expect(calls).toHaveLength(0);
  });
});

describe("loadSignedAddress: only the roles that may read a signature are asked", () => {
  it("every role outside SIGNATURE_READ_ROLES gets null and the database is not touched; the staff roles are asked", async () => {
    const { db, calls } = fakeDb({ proposals: { data: [{ id: "p1" }], error: null }, signatures: { data: [{ id: "s", proposal_id: "p1", address: ADDRESS, signed_at: "2026-11-12T19:14:00.000Z" }], error: null } });
    scoped.db = db;
    for (const role of ROLES) {
      calls.length = 0;
      const r = await loadSignedAddress(role, { leadId: LEAD });
      if (SIGNATURE_READ_ROLES.includes(role)) {
        expect(r?.status, role).toBe("ok");
        expect(calls.length).toBeGreaterThan(0);
      } else {
        expect(r, role).toBeNull();
        expect(calls, role).toHaveLength(0);
      }
    }
    expect(await loadSignedAddress(null, { leadId: LEAD })).toBeNull();
    expect(await loadSignedAddress(undefined, { leadId: LEAD })).toBeNull();
  });
});

describe("MailingAddressCard", () => {
  it("shown: the heading and the address lines as text", () => {
    const html = renderToStaticMarkup(<MailingAddressCard read={{ status: "ok", address: { lines: ["1 <b>A</b> St", "Miami, FL 33101"], signedAt: "2026-11-12T19:14:00.000Z" } }} />);
    expect(html).toContain("Mailing address (from the signed engagement letter)");
    expect(html).toContain("1 &lt;b&gt;A&lt;/b&gt; St\nMiami, FL 33101");
    expect(html).not.toContain("<b>A</b>");
  });
  it("nothing: no signed letter (or a role not asked) renders nothing at all", () => {
    expect(renderToStaticMarkup(<MailingAddressCard read={{ status: "none" }} />)).toBe("");
    expect(renderToStaticMarkup(<MailingAddressCard read={null} />)).toBe("");
  });
  it("couldn't be loaded: one quiet line, never 'no address'", () => {
    const html = renderToStaticMarkup(<MailingAddressCard read={{ status: "unavailable" }} />);
    expect(html).toContain("couldn&#x27;t be loaded");
    expect(html).not.toMatch(/no (mailing )?address/i);
    expect(html).not.toContain("role=\"alert\"");
  });
});

describe("placement", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("the lead page and the matter page load it through the role-gated loader and draw the card in the aside", () => {
    const lead = read("src/app/dashboard/leads/[id]/page.tsx");
    const matter = read("src/app/dashboard/matters/[id]/page.tsx");
    expect(lead).toContain("loadSignedAddress(session.role, { leadId: lead.id })");
    expect(lead.indexOf("<MailingAddressCard")).toBeGreaterThan(lead.indexOf("<aside"));
    expect(matter).toContain("loadSignedAddress(session.role, { matterId: matter.id, leadId: matter.lead_id })");
    expect(matter.indexOf("<MailingAddressCard")).toBeGreaterThan(matter.indexOf("<aside"));
    expect(`${lead}${matter}`).not.toMatch(/getAdminClient|service-role/);
  });
});
