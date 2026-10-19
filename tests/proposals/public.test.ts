import { describe, it, expect, vi, afterEach } from "vitest";

import {
  PUBLIC_PROPOSAL_COLUMNS,
  VIEW_EVENT_WINDOW_MS,
  acceptPublicProposal,
  buildAcceptedSnapshot,
  coarseUserAgent,
  isProposalExpired,
  pickLiveRow,
  readPublicProposal,
  recordProposalViewed,
  type PublicProposalsDb,
} from "@/lib/proposals/public";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { sevetri } from "./fixture";

/* ─────────────────────────── pure helpers ─────────────────────────────── */

describe("isProposalExpired: the firm's calendar, through the end of expires_on", () => {
  const NY = "America/New_York";

  it("is open all through the last day in the firm's zone", () => {
    // 2026-10-27T02:30Z is 10:30 PM on Oct 26 in New York (EDT).
    expect(isProposalExpired("2026-10-26", new Date("2026-10-27T02:30:00Z"), NY)).toBe(false);
    expect(isProposalExpired("2026-10-26", new Date("2026-10-26T12:00:00Z"), NY)).toBe(false);
  });

  it("closes at midnight in the firm's zone, not the server's", () => {
    // 2026-10-27T04:00:00Z is 12:00 AM on Oct 27 in New York.
    expect(isProposalExpired("2026-10-26", new Date("2026-10-27T03:59:59Z"), NY)).toBe(false);
    expect(isProposalExpired("2026-10-26", new Date("2026-10-27T04:00:00Z"), NY)).toBe(true);
  });

  it("uses the zone it is given", () => {
    const at = new Date("2026-10-27T02:30:00Z");
    expect(isProposalExpired("2026-10-26", at, "America/Los_Angeles")).toBe(false);
    expect(isProposalExpired("2026-10-26", at, "Asia/Tokyo")).toBe(true);
  });

  it("falls back to the default zone for a bad one, and never throws", () => {
    expect(() => isProposalExpired("2026-10-26", new Date(), "Not/AZone")).not.toThrow();
  });

  it("no expiry, or an unreadable one, never expires", () => {
    const later = new Date("2030-01-01T00:00:00Z");
    expect(isProposalExpired(null, later, NY)).toBe(false);
    expect(isProposalExpired(undefined, later, NY)).toBe(false);
    expect(isProposalExpired("", later, NY)).toBe(false);
    expect(isProposalExpired("soon", later, NY)).toBe(false);
  });
});

describe("pickLiveRow", () => {
  it("picks the sent or accepted version of the family", () => {
    const rows = [{ status: "draft", version: 3 }, { status: "sent", version: 2 }, { status: "superseded", version: 1 }];
    expect(pickLiveRow(rows)).toEqual({ kind: "live", row: rows[1] });
    const accepted = [{ status: "accepted", version: 1 }];
    expect(pickLiveRow(accepted)).toEqual({ kind: "live", row: accepted[0] });
  });

  it("a family with only drafts and approved versions is nothing, like an unknown token", () => {
    expect(pickLiveRow([{ status: "draft" }, { status: "approved" }])).toEqual({ kind: "none" });
    expect(pickLiveRow([])).toEqual({ kind: "none" });
  });

  it("a withdrawn offer is withdrawn, unless something else is live", () => {
    expect(pickLiveRow([{ status: "draft" }, { status: "withdrawn" }])).toEqual({ kind: "withdrawn" });
    const rows = [{ status: "withdrawn" }, { status: "sent" }];
    expect(pickLiveRow(rows).kind).toBe("live");
  });
});

describe("buildAcceptedSnapshot and the column allowlist", () => {
  it("freezes content, selection, the recomputed quote and the instant", () => {
    const content = sevetri();
    const selection = defaultSelection(content);
    const quote = quoteProposal(content, selection);
    expect(buildAcceptedSnapshot({ version: 2, content, selection, quote, acceptedAt: "2026-10-20T15:00:00.000Z" })).toEqual({
      schema: 1,
      version: 2,
      content,
      selection,
      quote,
      accepted_at: "2026-10-20T15:00:00.000Z",
    });
  });

  it("the public read never selects the client's email, the lead, the matter, staff ids or the token", () => {
    for (const private_ of ["client_email", "lead_id", "matter_id", "created_by", "updated_by", "approved_by", "public_token", "source"]) {
      expect(PUBLIC_PROPOSAL_COLUMNS).not.toContain(private_);
    }
  });
});

describe("coarseUserAgent", () => {
  it("stores a constant, never the header", () => {
    expect(coarseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) <script>alert(1)</script>")).toBe("mobile");
    expect(coarseUserAgent("Googlebot/2.1")).toBe("bot");
    expect(coarseUserAgent(null)).toBe("unknown");
    expect(coarseUserAgent("Mozilla/5.0 Chrome/120 Safari/537")).toBe("chrome");
  });
});

/* ─────────────────────────── a fake service-role client ────────────────── */

type Row = Record<string, unknown>;
type Call = { table: string; op: "select" | "update" | "insert"; filters: Array<[string, unknown]>; payload?: unknown; columns?: string };

/**
 * Just enough of PostgREST's builder to drive the public path: tables of rows,
 * `.eq` filters ANDed together, `update` that only touches matching rows (the
 * conditional-update fence), `insert`, `order`, `limit`.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const db: PublicProposalsDb = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      let orderBy: { column: string; ascending: boolean } | null = null;
      let max = Infinity;
      let selectAfterUpdate = false;
      const run = () => {
        calls.push(call);
        const rows = tables[table] ?? (tables[table] = []);
        const matching = rows.filter((r) => call.filters.every(([c, v]) => r[c] === v));
        if (call.op === "insert") {
          rows.push({ ...(call.payload as Row), created_at: new Date().toISOString() });
          return { data: null, error: null };
        }
        if (call.op === "update") {
          for (const r of matching) Object.assign(r, call.payload);
          return { data: selectAfterUpdate ? matching.map((r) => ({ ...r })) : null, error: null };
        }
        let out = matching.map((r) => ({ ...r }));
        if (orderBy) {
          const { column, ascending } = orderBy;
          out = out.sort((a, b) => ((a[column] as number | string) > (b[column] as number | string) ? 1 : -1) * (ascending ? 1 : -1));
        }
        return { data: out.slice(0, max), error: null };
      };
      const q: Record<string, unknown> = {
        select(columns: string) {
          if (call.op === "update") selectAfterUpdate = true;
          else call.columns = columns;
          return q;
        },
        update(patch: Row) {
          call.op = "update";
          call.payload = patch;
          return q;
        },
        insert(payload: unknown) {
          call.op = "insert";
          call.payload = payload;
          return q;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return q;
        },
        order(column: string, o?: { ascending?: boolean }) {
          orderBy = { column, ascending: o?.ascending ?? true };
          return q;
        },
        limit(n: number) {
          max = n;
          return q;
        },
        maybeSingle() {
          const r = run();
          const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
          return Promise.resolve({ data, error: r.error });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return q as never;
    },
  };
  return { db, calls, tables };
}

const TOKEN = "T".repeat(43);
const NOW = new Date("2026-10-20T15:00:00.000Z");

function world(over: { proposal?: Row; extra?: Row[] } = {}) {
  const proposal: Row = {
    id: "prop-2",
    org_id: "org-1",
    family_id: "prop-1",
    version: 2,
    public_token: TOKEN,
    title: "Trademark Proposal",
    client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com",
    status: "sent",
    content: sevetri(),
    expires_on: "2026-10-26",
    pay_url: "https://app.lawmatics.com/forms/share/abc",
    sent_at: "2026-10-19T00:00:00Z",
    accepted_at: null,
    accepted_selection: null,
    accepted_snapshot: null,
    ...over.proposal,
  };
  return fakeDb({
    client_proposal: [proposal, ...(over.extra ?? [])],
    crm_org: [{ id: "org-1", name: "RPB Law Firm", slug: "rpb-law" }],
    crm_org_profile: [{ org_id: "org-1", time_zone: "America/New_York" }],
    client_proposal_event: [],
  });
}

afterEach(() => vi.restoreAllMocks());

/* ─────────────────────────── readPublicProposal ───────────────────────── */

describe("readPublicProposal", () => {
  it("refuses a malformed token without touching the database", async () => {
    const { db, calls } = world();
    for (const bad of ["", "short", "a b".repeat(20), `${"a".repeat(40)},id.eq.1`]) {
      expect(await readPublicProposal(bad, NOW, db)).toEqual({ status: "not_found" });
    }
    expect(calls).toHaveLength(0);
  });

  it("looks the proposal up by the token and nothing else", async () => {
    const { db, calls } = world();
    await readPublicProposal(TOKEN, NOW, db);
    const read = calls.find((c) => c.table === "client_proposal")!;
    expect(read.filters).toEqual([["public_token", TOKEN]]);
    expect(read.columns).toBe(PUBLIC_PROPOSAL_COLUMNS.join(", "));
  });

  it("returns the sent version with the firm, and nothing private in the view", async () => {
    const { db } = world();
    const r = await readPublicProposal(TOKEN, NOW, db);
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.view).toMatchObject({
      status: "sent",
      version: 2,
      clientName: "Sevetri Wilson",
      expiresOn: "2026-10-26",
      acceptedAt: null,
      payUrl: null,
      firm: { name: "RPB Law Firm", slug: "rpb-law", timeZone: "America/New_York" },
    });
    const wire = JSON.stringify(r.view);
    expect(wire).not.toContain(TOKEN);
    expect(wire).not.toContain("sevetri@example.com");
    expect(wire).not.toContain("lawmatics.com");
    expect(wire).not.toContain("org-1");
    expect(r.handle).toEqual({ proposalId: "prop-2", orgId: "org-1", familyId: "prop-1", version: 2, storedStatus: "sent" });
  });

  it("drops content keys ProposalContent does not define (the old spec's `private` block)", async () => {
    const content = sevetri() as unknown as Record<string, unknown>;
    content.private = { matter_id: "matter-9", client_email: "sevetri@example.com" };
    (content.client as Record<string, unknown>).email = "sevetri@example.com";
    const names = content.names as Array<Record<string, unknown>>;
    names[0].internal_note = "price-sensitive";
    (names[0].marks as Array<Record<string, unknown>>)[0].serial = "98765432";
    const { db } = world({ proposal: { content } });
    const r = await readPublicProposal(TOKEN, NOW, db);
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    const wire = JSON.stringify(r.view);
    for (const leak of ["matter-9", "sevetri@example.com", "price-sensitive", "98765432", "private"]) expect(wire).not.toContain(leak);
    // Everything the page renders survives, and prices the same.
    expect(r.view.content).toEqual(sevetri());
  });

  it("shows the live version when a newer draft exists, and an older version is superseded", async () => {
    const { db } = world({
      extra: [
        { id: "prop-3", org_id: "org-1", family_id: "prop-1", version: 3, public_token: TOKEN, status: "draft", content: sevetri() },
        { id: "prop-1", org_id: "org-1", family_id: "prop-1", version: 1, public_token: TOKEN, status: "superseded", content: sevetri() },
      ],
    });
    const r = await readPublicProposal(TOKEN, NOW, db);
    expect(r.status === "ok" && r.view.version).toBe(2);
  });

  it("a draft-only family answers exactly like an unknown token", async () => {
    const { db } = world({ proposal: { status: "draft" } });
    expect(await readPublicProposal(TOKEN, NOW, db)).toEqual({ status: "not_found" });
    expect(await readPublicProposal("U".repeat(43), NOW, db)).toEqual({ status: "not_found" });
    const approved = world({ proposal: { status: "approved" } });
    expect(await readPublicProposal(TOKEN, NOW, approved.db)).toEqual({ status: "not_found" });
  });

  it("is closed once expires_on has passed on the firm's calendar", async () => {
    const { db } = world();
    const edge = new Date("2026-10-27T03:59:00Z"); // still Oct 26 in New York
    expect((await readPublicProposal(TOKEN, edge, db)).status).toBe("ok");
    const r = await readPublicProposal(TOKEN, new Date("2026-10-27T04:00:00Z"), db);
    expect(r).toMatchObject({ status: "closed", reason: "expired", firm: { name: "RPB Law Firm" } });
  });

  it("a withdrawn offer is closed", async () => {
    const { db } = world({ proposal: { status: "withdrawn" } });
    expect(await readPublicProposal(TOKEN, NOW, db)).toMatchObject({ status: "closed", reason: "withdrawn" });
  });

  it("an accepted proposal is a receipt and never reads as expired", async () => {
    const content = sevetri();
    const selection = defaultSelection(content);
    const quote = quoteProposal(content, selection);
    const { db } = world({
      proposal: {
        status: "accepted",
        accepted_at: "2026-10-21T00:00:00Z",
        accepted_selection: selection,
        accepted_snapshot: buildAcceptedSnapshot({ version: 2, content, selection, quote, acceptedAt: "2026-10-21T00:00:00Z" }),
      },
    });
    const r = await readPublicProposal(TOKEN, new Date("2027-01-01T00:00:00Z"), db);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.view.status).toBe("accepted");
    expect(r.view.acceptedQuote?.legal_total_cents).toBe(1_485_000);
    expect(r.view.acceptedSelection).toEqual(selection);
    expect(r.view.payUrl).toBe("https://app.lawmatics.com/forms/share/abc");
    expect(r.handle.storedStatus).toBe("accepted");
  });

  it("is unavailable, never not_found, when the database fails or the firm is missing", async () => {
    const failing: PublicProposalsDb = {
      from: () => {
        throw new Error("network down");
      },
    };
    expect(await readPublicProposal(TOKEN, NOW, failing)).toEqual({ status: "unavailable" });
    const { db, tables } = world();
    tables.crm_org = [];
    expect(await readPublicProposal(TOKEN, NOW, db)).toEqual({ status: "unavailable" });
  });

  it("falls back to the default zone when the profile has a bad one", async () => {
    const { db, tables } = world();
    tables.crm_org_profile = [{ org_id: "org-1", time_zone: "Mars/Olympus" }];
    const r = await readPublicProposal(TOKEN, NOW, db);
    expect(r.status === "ok" && r.view.firm.timeZone).toBe("America/New_York");
  });
});

/* ─────────────────────────── acceptPublicProposal ─────────────────────── */

describe("acceptPublicProposal", () => {
  const selection = (ids: string[]) => Object.fromEntries(ids.map((i) => [i, true]));

  it("recomputes the price from the stored content and freezes it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world();
    const r = await acceptPublicProposal(TOKEN, selection(["p-word", "p-logo", "p-c1", "p-c2"]), NOW, db);
    if (!r.ok) throw new Error(r.reason);
    expect(r.quote.legal_total_cents).toBe(742_500);
    expect(r.quote.gov_total_cents).toBe(140_000);
    expect(r.payUrl).toBe("https://app.lawmatics.com/forms/share/abc");
    expect(r.acceptedAt).toBe(NOW.toISOString());

    const row = tables.client_proposal[0];
    expect(row.status).toBe("accepted");
    expect(row.accepted_selection).toMatchObject({ "p-word": true, "t-word": false });
    expect(row.accepted_snapshot).toMatchObject({ schema: 1, version: 2, accepted_at: NOW.toISOString() });
    expect((row.accepted_snapshot as { quote: { legal_total_cents: number } }).quote.legal_total_cents).toBe(742_500);
    // The notice carries the id and nothing else.
    expect(info).toHaveBeenCalledWith(JSON.stringify({ event: "proposal_accepted", proposal_id: "prop-2" }));
  });

  it("the write is fenced on id, org and status 'sent', and sets nothing else", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, calls } = world();
    await acceptPublicProposal(TOKEN, selection(["p-word", "p-c1"]), NOW, db);
    const write = calls.find((c) => c.op === "update")!;
    expect(write.filters).toEqual([["id", "prop-2"], ["org_id", "org-1"], ["status", "sent"]]);
    expect(Object.keys(write.payload as Row).sort()).toEqual(["accepted_selection", "accepted_snapshot", "status"]);
  });

  it("does not write 'accepted' events itself (the database trigger does)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world();
    await acceptPublicProposal(TOKEN, selection(["p-word", "p-c1"]), NOW, db);
    expect(tables.client_proposal_event).toEqual([]);
  });

  it("two clicks accept once: the second finds it already resolved", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world();
    const picks = selection(["p-word", "p-c1"]);
    const first = await acceptPublicProposal(TOKEN, picks, NOW, db);
    const second = await acceptPublicProposal(TOKEN, selection(["p-word", "p-logo", "p-c1", "p-c2"]), NOW, db);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "already_resolved" });
    expect((tables.client_proposal[0].accepted_snapshot as { quote: { legal_total_cents: number } }).quote.legal_total_cents).toBe(330_000);
  });

  it("loses cleanly when the row leaves 'sent' between the read and the write", async () => {
    const { db, tables } = world();
    const real = db.from.bind(db);
    let first = true;
    const racing: PublicProposalsDb = {
      from(table: string) {
        const q = real(table);
        if (table === "client_proposal" && first) {
          first = false;
          return q; // the read
        }
        if (table === "client_proposal") tables.client_proposal[0].status = "withdrawn"; // staff withdrew it
        return q;
      },
    };
    const r = await acceptPublicProposal(TOKEN, selection(["p-word", "p-c1"]), NOW, racing);
    expect(r).toMatchObject({ ok: false, reason: "already_resolved" });
    expect(tables.client_proposal[0].status).toBe("withdrawn");
    expect(tables.client_proposal[0].accepted_snapshot).toBeNull();
  });

  it("refuses an empty selection, and a mark without a class", async () => {
    const { db, calls } = world();
    expect(await acceptPublicProposal(TOKEN, {}, NOW, db)).toMatchObject({ ok: false, reason: "nothing_selected" });
    expect(await acceptPublicProposal(TOKEN, selection(["p-word"]), NOW, db)).toMatchObject({ ok: false, reason: "nothing_selected" });
    expect(await acceptPublicProposal(TOKEN, "garbage", NOW, db)).toMatchObject({ ok: false, reason: "nothing_selected" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("ignores ids the proposal does not offer and non-boolean ticks", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world();
    const r = await acceptPublicProposal(TOKEN, { "p-word": true, "p-c1": true, "p-logo": "yes", "evil-id": true, price: 1 }, NOW, db);
    expect(r.ok).toBe(true);
    const stored = tables.client_proposal[0].accepted_selection as Record<string, boolean>;
    expect(stored["p-logo"]).toBe(false);
    expect("evil-id" in stored).toBe(false);
    expect("price" in stored).toBe(false);
  });

  it("refuses when closed, unknown, drafts, or already accepted", async () => {
    const expired = world();
    expect(await acceptPublicProposal(TOKEN, selection(["p-word", "p-c1"]), new Date("2026-11-01T00:00:00Z"), expired.db)).toMatchObject({ reason: "closed" });
    expect(await acceptPublicProposal("Z".repeat(43), selection(["p-word", "p-c1"]), NOW, world().db)).toMatchObject({ reason: "not_found" });
    const draft = world({ proposal: { status: "draft" } });
    expect(await acceptPublicProposal(TOKEN, selection(["p-word", "p-c1"]), NOW, draft.db)).toMatchObject({ reason: "not_found" });
    const done = world({ proposal: { status: "accepted", accepted_snapshot: { quote: {} } } });
    expect(await acceptPublicProposal(TOKEN, selection(["p-word", "p-c1"]), NOW, done.db)).toMatchObject({ reason: "already_resolved" });
  });

  it("reports unavailable, not accepted, when the write errors", async () => {
    const { db } = world();
    const real = db.from.bind(db);
    const broken: PublicProposalsDb = {
      from(table: string) {
        const q = real(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
        const wrapped = new Proxy(q, {
          get(target, prop) {
            if (prop === "update") return () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: null, error: { code: "XX000" } }) }) }) }) });
            return target[prop as string];
          },
        });
        return wrapped as never;
      },
    };
    const r = await acceptPublicProposal(TOKEN, selection(["p-word", "p-c1"]), NOW, broken);
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

/* ─────────────────────────── recordProposalViewed ─────────────────────── */

describe("recordProposalViewed", () => {
  const handle = { proposalId: "prop-2", orgId: "org-1", familyId: "prop-1", version: 2, storedStatus: "sent" as const };

  it("writes one coarse 'viewed' event stamped with the row's own org", async () => {
    const { db, tables } = world();
    await recordProposalViewed(handle, "Mozilla/5.0 (iPhone) weird<script>", NOW, db);
    expect(tables.client_proposal_event).toHaveLength(1);
    expect(tables.client_proposal_event[0]).toMatchObject({
      org_id: "org-1",
      proposal_id: "prop-2",
      family_id: "prop-1",
      type: "viewed",
      actor: "client",
      payload: { ua: "mobile", version: 2 },
    });
  });

  it("dedupes refreshes inside the window, and records again after it", async () => {
    const { db, tables } = world();
    tables.client_proposal_event.push({
      org_id: "org-1",
      proposal_id: "prop-2",
      type: "viewed",
      created_at: new Date(NOW.getTime() - VIEW_EVENT_WINDOW_MS + 1000).toISOString(),
    });
    await recordProposalViewed(handle, "Chrome", NOW, db);
    expect(tables.client_proposal_event).toHaveLength(1);
    await recordProposalViewed(handle, "Chrome", new Date(NOW.getTime() + VIEW_EVENT_WINDOW_MS), db);
    expect(tables.client_proposal_event).toHaveLength(2);
  });

  it("never throws", async () => {
    const failing: PublicProposalsDb = {
      from: () => {
        throw new Error("boom");
      },
    };
    await expect(recordProposalViewed(handle, "x", NOW, failing)).resolves.toBeUndefined();
  });
});
