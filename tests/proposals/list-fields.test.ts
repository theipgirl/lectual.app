import { describe, it, expect, vi, beforeEach } from "vitest";
import { sevetri } from "./fixture";
import { buildAcceptedSnapshot } from "@/lib/proposals/public";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";

/**
 * What the Quotes & proposals list needs from the store (Sprint 6): `listProposals` carries the
 * brands, the offered packages, the class count, the signed package, the staff-only package basis
 * and created_at (and still not the document), and `listLatestProposalEvents` returns the newest
 * event per proposal, in chunks, and throws when a read fails.
 */

const base = {
  family_id: "f",
  version: 1,
  client_name: "Ana",
  title: "Trademark Proposal",
  expires_on: "2026-11-10",
  source: "manual",
  lead_id: null,
  matter_id: null,
  approved_at: null,
  sent_at: null,
  accepted_at: null,
  accepted_snapshot: null,
  created_at: "2026-10-18T12:00:00Z",
  updated_at: "2026-10-19T12:00:00Z",
  content: sevetri(),
  client_email: "ana@example.com",
  pay_url: "https://pay.example/x",
};

async function list(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  for (const m of ["eq", "order", "limit"]) q[m] = () => q;
  q.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f);
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ from: () => q })) }));
  const { listProposals } = await import("../../src/lib/proposals/store");
  return listProposals();
}

describe("listProposals carries what the table words", () => {
  beforeEach(() => vi.resetModules());

  it("brands in content order, the offered package with the two fees apart, the class count and created_at", async () => {
    const [it] = await list([{ ...base, id: "a", status: "sent" }]);
    expect(it.brands).toEqual(["Prosperall", "Tech4PublicGood"]);
    expect(it.offered).toHaveLength(1);
    expect(it.offered[0].name).toBe("Concierge");
    expect(it.offered[0].legalAtSigningCents).toBe(it.legal_total_cents);
    expect(it.offered[0].usptoAtFilingCents).toBe(it.gov_total_cents);
    expect(it.class_count).toBe(4);
    expect(it.created_at).toBe("2026-10-18T12:00:00Z");
    expect(it.signed_package).toBeNull();
    expect(it.package_basis).toBeNull();
  });

  it("a blank package name offers nothing", async () => {
    const content = sevetri();
    content.pricing.package = "";
    const [it] = await list([{ ...base, id: "a", status: "draft", content }]);
    expect(it.offered).toEqual([]);
  });

  it("an accepted row counts the classes the client chose and names the package signed", async () => {
    const content = sevetri();
    const selection = defaultSelection(content);
    selection["p-c2"] = false;
    const snapshot = buildAcceptedSnapshot({ version: 1, content, selection, quote: quoteProposal(content, selection), acceptedAt: "2026-10-18T15:00:00Z" });
    const [it] = await list([{ ...base, id: "a", status: "accepted", accepted_snapshot: snapshot, accepted_at: "2026-10-18T15:00:00Z" }]);
    expect(it.signed_package).toBe("Concierge");
    expect(it.class_count).toBe(3);
    expect(it.legal_total_cents).toBe(snapshot.quote.legal_total_cents);
  });

  it("carries the package basis only when a field was changed, and never the document", async () => {
    const edited = { ...sevetri(), package_basis: { name: "Enhanced", edited: ["price"] } };
    const untouched = { ...sevetri(), package_basis: { name: "Enhanced", edited: [] } };
    const [a, b] = await list([
      { ...base, id: "a", status: "draft", content: edited },
      { ...base, id: "b", status: "draft", family_id: "g", content: untouched },
    ]);
    expect(a.package_basis).toEqual({ name: "Enhanced", edited: ["price"] });
    expect(b.package_basis).toBeNull();
    expect(a).not.toHaveProperty("content");
  });

  it("junk content never throws", async () => {
    const [it] = await list([{ ...base, id: "a", status: "draft", content: { names: "x", pricing: null } }]);
    expect(it.brands).toEqual([]);
    expect(it.offered).toEqual([]);
    expect(it.class_count).toBe(0);
  });
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("listLatestProposalEvents", () => {
  beforeEach(() => vi.resetModules());

  function events(reads: Array<{ data?: unknown; error?: { code?: string; message?: string } | null }>) {
    const seen: Array<{ ids: string[]; types: string[]; cols: string }> = [];
    let n = 0;
    const from = () => {
      const call = { ids: [] as string[], types: [] as string[], cols: "" };
      const q: Record<string, unknown> = {};
      q.select = (c: string) => ((call.cols = c), q);
      q.in = (col: string, v: string[]) => {
        if (col === "proposal_id") call.ids = v;
        if (col === "type") call.types = v;
        return q;
      };
      q.order = () => q;
      q.limit = () => q;
      q.then = (f: (v: unknown) => unknown) => {
        seen.push(call);
        const r = reads[Math.min(n++, reads.length - 1)];
        return Promise.resolve({ data: r.data ?? [], error: r.error ?? null }).then(f);
      };
      return q;
    };
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ from })) }));
    return seen;
  }

  it("returns the newest event of each proposal, and omits a proposal with none", async () => {
    events([
      {
        data: [
          { proposal_id: ID(1), type: "edited", actor: "staff", actor_user_id: "u1", created_at: "2026-10-20T13:00:00Z" },
          { proposal_id: ID(1), type: "created", actor: "staff", actor_user_id: "u1", created_at: "2026-10-19T13:00:00Z" },
          { proposal_id: ID(2), type: "sent", actor: "staff", actor_user_id: "u2", created_at: "2026-10-18T13:00:00Z" },
        ],
      },
    ]);
    const { listLatestProposalEvents } = await import("../../src/lib/proposals/store");
    const map = await listLatestProposalEvents([ID(1), ID(2), ID(3)]);
    expect(map.get(ID(1))?.type).toBe("edited");
    expect(map.get(ID(2))?.type).toBe("sent");
    expect(map.has(ID(3))).toBe(false);
  });

  it("names its columns, filters out 'viewed', and reads ids in chunks of 50", async () => {
    const seen = events([{ data: [] }]);
    const { listLatestProposalEvents } = await import("../../src/lib/proposals/store");
    await listLatestProposalEvents(Array.from({ length: 120 }, (_, i) => ID(i + 1)));
    expect(seen).toHaveLength(3);
    expect(seen.map((c) => c.ids.length)).toEqual([50, 50, 20]);
    for (const c of seen) {
      expect(c.cols).toBe("proposal_id, type, actor, actor_user_id, created_at");
      expect(c.types).not.toContain("viewed");
      expect(c.types).toContain("edited");
    }
  });

  it("makes no read for no ids, and ignores a malformed id", async () => {
    const seen = events([{ data: [] }]);
    const { listLatestProposalEvents } = await import("../../src/lib/proposals/store");
    expect((await listLatestProposalEvents([])).size).toBe(0);
    expect((await listLatestProposalEvents(["not-a-uuid", "x'; drop"])).size).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it("throws when a read fails, so the page can show a derived line rather than guess 'no activity'", async () => {
    events([{ data: [], error: { code: "XX000", message: "boom" } }]);
    const { listLatestProposalEvents } = await import("../../src/lib/proposals/store");
    await expect(listLatestProposalEvents([ID(1)])).rejects.toBeTruthy();
  });
});
