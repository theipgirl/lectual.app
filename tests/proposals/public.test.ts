import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import {
  PUBLIC_ORG_COLUMNS,
  PUBLIC_PROPOSAL_COLUMNS,
  VIEW_EVENT_WINDOW_MS,
  acceptPublicProposal,
  buildAcceptedSnapshot,
  coarseUserAgent,
  isProposalExpired,
  pickLiveRow,
  publicContent,
  readPublicProposal,
  recordProposalViewed,
  type PublicProposalsDb,
} from "@/lib/proposals/public";
import { DEFAULT_CLIENT_ENTRY_PROMPT, DESCRIBE_BEFORE_ACCEPT } from "@/lib/proposals/client-classes";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { sevetri } from "./fixture";
import { danielle } from "./danielle-fixture";

// Sprint 19: the acceptance follow-ups (firm notice + Lawmatics note) are scheduled with next/server's after().
// Outside a request `after` is a no-op here; tests that care capture the callback and run it themselves.
const mocks = vi.hoisted(() => ({
  after: vi.fn<(fn: () => unknown) => void>(),
  runAcceptanceFollowups: vi.fn<(db: unknown, input: { proposalId: string; orgId: string }) => Promise<void>>(async () => {}),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

beforeEach(() => {
  mocks.after.mockReset();
  mocks.runAcceptanceFollowups.mockReset();
  mocks.runAcceptanceFollowups.mockResolvedValue(undefined);
});

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

function world(over: { proposal?: Row; extra?: Row[]; org?: Row } = {}) {
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
    crm_org: [{ id: "org-1", name: "RPB Law Firm", slug: "rpb-law", modules: ["agents", "proposals"], ...over.org }],
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

  it.each([
    ["the proposals module is off", ["agents"]],
    ["the module list is empty", []],
    ["the module list is unreadable", null],
  ])("fails closed when %s", async (_n, modules) => {
    const { db } = world({ org: { modules } });
    const r = await readPublicProposal(TOKEN, NOW, db);
    expect(r).toMatchObject({ status: "closed", reason: "module_off" });
    // Nothing of the proposal travels with a closed answer.
    expect(JSON.stringify(r)).not.toContain("Sevetri");
  });

  it("module-off closes a sent, an accepted and a withdrawn family alike", async () => {
    for (const status of ["sent", "accepted", "withdrawn"]) {
      const { db } = world({ proposal: { status }, org: { modules: [] } });
      expect(await readPublicProposal(TOKEN, NOW, db)).toMatchObject({ status: "closed", reason: "module_off" });
    }
  });

  it("module-off does not confuse a draft-only family: still not_found", async () => {
    const { db } = world({ proposal: { status: "draft" }, org: { modules: [] } });
    expect(await readPublicProposal(TOKEN, NOW, db)).toEqual({ status: "not_found" });
  });

  it("reads modules from the org row it already reads, and never exposes them", async () => {
    const { db, calls } = world();
    const r = await readPublicProposal(TOKEN, NOW, db);
    const orgRead = calls.find((c) => c.table === "crm_org")!;
    expect(orgRead.columns).toBe(PUBLIC_ORG_COLUMNS.join(", "));
    expect(orgRead.filters).toEqual([["id", "org-1"]]);
    expect(JSON.stringify(r)).not.toContain("agents");
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
    expect(r.view.acceptedQuote?.legal_total_cents).toBe(1_782_000);
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
    expect(r.quote.legal_total_cents).toBe(891_000);
    expect(r.quote.gov_total_cents).toBe(140_000);
    expect(r.payUrl).toBe("https://app.lawmatics.com/forms/share/abc");
    expect(r.acceptedAt).toBe(NOW.toISOString());

    const row = tables.client_proposal[0];
    expect(row.status).toBe("accepted");
    expect(row.accepted_selection).toMatchObject({ "p-word": true, "t-word": false });
    expect(row.accepted_snapshot).toMatchObject({ schema: 1, version: 2, accepted_at: NOW.toISOString() });
    expect((row.accepted_snapshot as { quote: { legal_total_cents: number } }).quote.legal_total_cents).toBe(891_000);
    // Sprint 19: the firm notice is a real follow-up now (tests/proposals/accept-followups.test.ts), so the
    // old "log the id" stub is gone; nothing about the proposal is logged at info level.
    expect(info).not.toHaveBeenCalled();
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

  it("refuses, and writes nothing, when the firm's proposals module is off", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, calls, tables } = world({ org: { modules: ["agents"] } });
    const r = await acceptPublicProposal(TOKEN, selection(["p-word", "p-c1"]), NOW, db);
    expect(r).toMatchObject({ ok: false, reason: "closed" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
    expect(tables.client_proposal[0].status).toBe("sent");
  });

  it("two clicks accept once: the second finds it already resolved", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world();
    const picks = selection(["p-word", "p-c1"]);
    const first = await acceptPublicProposal(TOKEN, picks, NOW, db);
    const second = await acceptPublicProposal(TOKEN, selection(["p-word", "p-logo", "p-c1", "p-c2"]), NOW, db);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "already_resolved" });
    expect((tables.client_proposal[0].accepted_snapshot as { quote: { legal_total_cents: number } }).quote.legal_total_cents).toBe(495_000);
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

  it("refuses an empty selection; a mark without a class is repaired to its first class (Sprint 28)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, calls, tables } = world();
    expect(await acceptPublicProposal(TOKEN, {}, NOW, db)).toMatchObject({ ok: false, reason: "nothing_selected" });
    expect(await acceptPublicProposal(TOKEN, "garbage", NOW, db)).toMatchObject({ ok: false, reason: "nothing_selected" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
    // Before Sprint 28 this was refused; now it can never be recorded as a mark with no class.
    expect(await acceptPublicProposal(TOKEN, selection(["p-word"]), NOW, db)).toMatchObject({ ok: true });
    const stored = tables.client_proposal[0].accepted_selection as Record<string, boolean>;
    expect(stored["p-word"]).toBe(true);
    expect(stored["p-c1"]).toBe(true);
    expect(stored["p-c2"]).toBe(false);
  });

  it("a fixed offer (one name, one mark, one class) accepts fully selected whatever was posted", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const content = sevetri();
    content.names = [content.names[0]];
    content.names[0].marks = [{ ...content.names[0].marks[0], preselected: false }];
    content.names[0].classes = [{ ...content.names[0].classes[0], preselected: false }];
    for (const posted of [{}, "garbage", { "p-word": false, "p-c1": false, "evil-id": true }]) {
      const { db, tables } = world({ proposal: { content } });
      const r = await acceptPublicProposal(TOKEN, posted, NOW, db);
      if (!r.ok) throw new Error(r.reason);
      // Flat package (Sprint 28): one class of the 3-class Concierge is the full $4,950 (PR #4 pinned the old $3,300).
      expect(r.quote.legal_total_cents).toBe(495_000);
      expect(tables.client_proposal[0].accepted_selection).toEqual({ "p-word": true, "p-c1": true });
    }
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

describe("publicContent never publishes the staff-only package basis (Sprint 6)", () => {
  it("drops content.package_basis from the view the client receives", () => {
    const content = { ...sevetri(), package_basis: { name: "Enhanced", edited: ["price"] } };
    const out = publicContent(content) as unknown as Record<string, unknown>;
    expect("package_basis" in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain("Enhanced");
    expect(JSON.stringify(out)).not.toContain("edited");
    // and the rest of the document is intact
    expect(out.pricing).toEqual(sevetri().pricing);
  });
});

describe("acceptPublicProposal: the firm notice and the Lawmatics note are follow-ups (Sprint 19)", () => {
  const pick = (ids: string[]) => Object.fromEntries(ids.map((i) => [i, true]));
  const IDS = ["p-word", "p-c1"];

  it("schedules them with after() and does not wait for them", async () => {
    const { db } = world();
    const r = await acceptPublicProposal(TOKEN, pick(IDS), NOW, db);
    expect(r.ok).toBe(true);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    // The response is built; nothing has run yet. It runs when the framework calls the callback.
    expect(mocks.runAcceptanceFollowups).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.runAcceptanceFollowups).toHaveBeenCalledTimes(1);
    // It is handed the connection this module already holds, and the proposal's own id and org (read from the row).
    expect(mocks.runAcceptanceFollowups.mock.calls[0][0]).toBe(db);
    expect(mocks.runAcceptanceFollowups.mock.calls[0][1]).toEqual({ proposalId: "prop-2", orgId: "org-1" });
  });

  it("returns the same result however the follow-ups end", async () => {
    const baseline = world();
    const expected = await acceptPublicProposal(TOKEN, pick(IDS), NOW, baseline.db);
    expect(expected.ok).toBe(true);

    // A follow-up that rejects, run later by after(): the acceptance already returned, and the callback does not throw.
    const later = world();
    const r1 = await acceptPublicProposal(TOKEN, pick(IDS), NOW, later.db);
    mocks.runAcceptanceFollowups.mockRejectedValueOnce(new Error("note exploded"));
    await expect(Promise.resolve(mocks.after.mock.calls.at(-1)![0]())).resolves.toBeUndefined();
    expect(r1).toEqual(expected);

    // No request scope (a script, a test): after() throws, the follow-ups are awaited instead, and a rejection still changes nothing.
    mocks.after.mockImplementation(() => {
      throw new Error("after() outside a request scope");
    });
    mocks.runAcceptanceFollowups.mockRejectedValue(new Error("note exploded"));
    const direct = world();
    const r2 = await acceptPublicProposal(TOKEN, pick(IDS), NOW, direct.db);
    expect(r2).toEqual(expected);
    expect(mocks.runAcceptanceFollowups).toHaveBeenCalled();
  });

  it("a refused acceptance schedules nothing", async () => {
    const { db } = world({ proposal: { status: "accepted" } });
    const r = await acceptPublicProposal(TOKEN, pick(IDS), NOW, db);
    expect(r.ok).toBe(false);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runAcceptanceFollowups).not.toHaveBeenCalled();
  });

  it("logs nothing about the client at all", async () => {
    const spies = (["info", "log", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { db } = world();
    await acceptPublicProposal(TOKEN, pick(IDS), NOW, db);
    await mocks.after.mock.calls[0][0]();
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
  });
});

/* ───────────── Spec 3: classes the client describes or adds; the server re-prices ───────────── */

function essentialContent() {
  const c = sevetri();
  c.pricing = { ...c.pricing, package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20 };
  c.names = [c.names[0]];
  c.names[0].classes = [c.names[0].classes[0]];
  c.names[0].client_add = { max: 2 };
  return c;
}

/** The real case: a design mark, Essential, three open classes (no room to add). */
function openContent() {
  const c = essentialContent();
  c.names[0].marks = [{ ...c.names[0].marks[1], preselected: true }];
  c.names[0].classes = ["o1", "o2", "o3"].map((id) => ({ id, label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, client_entry: true as const }));
  delete c.names[0].client_add;
  return c;
}

const add = (...rows: Array<[string, boolean]>) => ({ added: { p: rows.map(([text, on]) => ({ text, on })) } });

describe("acceptPublicProposal: classes the client describes or adds", () => {
  const ticks = (ids: string[]) => Object.fromEntries(ids.map((i) => [i, true]));
  const accepted = (tables: Record<string, Row[]>) => tables.client_proposal[0] as { accepted_selection: Record<string, boolean>; accepted_snapshot: { quote: ReturnType<typeof quoteProposal>; content: ReturnType<typeof sevetri>; selection: Record<string, boolean> } };

  it("stores the EFFECTIVE content: open classes carry the client's words, priced like any class", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world({ proposal: { content: openContent() } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-logo", "o1", "o2", "o3"]), NOW, db, {
      entries: { o1: "  Scented   candles ", o2: "Bath <b>soaps</b>", o3: "Room\ndiffusers" },
    });
    expect(r.ok).toBe(true);
    const row = accepted(tables);
    expect(row.accepted_snapshot.content.names[0].classes.map((c) => c.label)).toEqual(["Scented candles", "Bath bsoaps/b", "Room diffusers"]);
    expect(row.accepted_snapshot.content.names[0].classes[0]).toMatchObject({ id: "o1", client_entry: true, prompt: DEFAULT_CLIENT_ENTRY_PROMPT });
    expect(row.accepted_snapshot.quote.names[0].classes.map((c) => c.label)).toEqual(["Scented candles", "Bath bsoaps/b", "Room diffusers"]);
    // Essential: 1,950 + 2 x 825; USPTO 3 x 350.
    expect(row.accepted_snapshot.quote.legal_total_cents).toBe(360_000);
    expect(row.accepted_snapshot.quote.gov_total_cents).toBe(105_000);
    expect(row.accepted_selection).toEqual({ "p-logo": true, o1: true, o2: true, o3: true });
    expect(row.accepted_snapshot.selection).toEqual(row.accepted_selection);
  });

  it("refuses a ticked open class with no words, with the fixed sentence, and writes nothing", async () => {
    const { db, calls, tables } = world({ proposal: { content: openContent() } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-logo", "o1", "o2"]), NOW, db, { entries: { o1: "Candles", o2: "   <> " } });
    expect(r).toEqual({ ok: false, reason: "missing_description", message: DESCRIBE_BEFORE_ACCEPT });
    expect(calls.some((c) => c.op === "update")).toBe(false);
    expect(tables.client_proposal[0].accepted_snapshot).toBeNull();
  });

  it("an unticked open class needs no words", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world({ proposal: { content: openContent() } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-logo", "o1"]), NOW, db, { entries: { o1: "Candles" } });
    expect(r.ok).toBe(true);
    expect(accepted(tables).accepted_snapshot.quote.legal_total_cents).toBe(195_000);
  });

  it("one added class on a single mark: legal $2,775 and USPTO $700, with a server id, in the selection and the snapshot", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world({ proposal: { content: essentialContent() } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-word", "p-c1"]), NOW, db, add(["Online store services", true]));
    expect(r.ok).toBe(true);
    const row = accepted(tables);
    expect(row.accepted_snapshot.quote.legal_total_cents).toBe(277_500);
    expect(row.accepted_snapshot.quote.gov_total_cents).toBe(70_000);
    expect(row.accepted_snapshot.quote.gov_class_count).toBe(2);
    expect(row.accepted_snapshot.quote.names[0].classes.map((c) => c.label)).toEqual([expect.any(String), "Online store services"]);
    expect(row.accepted_selection["ca-p-1"]).toBe(true);
    expect(row.accepted_snapshot.content.names[0].classes[1]).toMatchObject({ id: "ca-p-1", client_added: true, label: "Online store services" });
    if (r.ok) expect(r.quote.legal_total_cents).toBe(277_500);
  });

  it("with word and design ticked the second mark's discount applies to the extra-class fee, exactly as the engine does", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world({ proposal: { content: essentialContent() } });
    await acceptPublicProposal(TOKEN, ticks(["p-word", "p-logo", "p-c1"]), NOW, db, add(["Online store services", true]));
    const real = essentialContent();
    real.names[0].classes.push({ id: "x", label: "Online store services", preselected: true });
    const engine = quoteProposal(real, ticks(["p-word", "p-logo", "p-c1", "x"]));
    const row = accepted(tables);
    expect(row.accepted_snapshot.quote.legal_total_cents).toBe(engine.legal_total_cents);
    expect(row.accepted_snapshot.quote.gov_total_cents).toBe(engine.gov_total_cents);
    expect(engine.legal_total_cents).toBe(277_500 + 222_000);
    expect(engine.gov_total_cents).toBe(140_000);
  });

  it("drops adds beyond the max, an unticked empty add, and keeps an unticked described one unticked and unpriced", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world({ proposal: { content: essentialContent() } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-word", "p-c1"]), NOW, db, add(["", false], ["Kept, not ticked", false], ["Third", true], ["Fourth", true]));
    expect(r.ok).toBe(true);
    const row = accepted(tables);
    // max 2: the first two rows are read; the empty unticked one is dropped, the described one stays off.
    expect(row.accepted_snapshot.content.names[0].classes.map((c) => c.label)).toEqual([expect.any(String), "Kept, not ticked"]);
    expect(row.accepted_selection["ca-p-1"]).toBe(false);
    expect(row.accepted_snapshot.quote.legal_total_cents).toBe(195_000);
  });

  it("refuses a ticked added class with no words", async () => {
    const { db, calls } = world({ proposal: { content: essentialContent() } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-word", "p-c1"]), NOW, db, add(["  ", true]));
    expect(r).toMatchObject({ ok: false, reason: "missing_description" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("drops adds for a brand name whose max is 0, unknown ids, and entries for classes that are not open", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const content = sevetri();
    content.names[0].client_add = { max: 0 };
    const { db, tables } = world({ proposal: { content } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-word", "p-c1"]), NOW, db, {
      entries: { "p-c1": "Renamed by the client", zzz: "x" },
      added: { p: [{ text: "Not allowed", on: true }], zzz: [{ text: "x", on: true }] },
    });
    expect(r.ok).toBe(true);
    const row = accepted(tables);
    expect(row.accepted_snapshot.content.names[0].classes.map((c) => c.label)).toEqual(sevetri().names[0].classes.map((c) => c.label));
    expect(Object.keys(row.accepted_selection).some((k) => k.startsWith("ca-"))).toBe(false);
  });

  it("still takes the Sprint 28 post shape { nameId: string[] } (default 5, no client_add needed)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const content = essentialContent();
    delete content.names[0].client_add;
    const { db, tables } = world({ proposal: { content } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-word", "p-c1"]), NOW, db, { p: ["Online store services"] });
    expect(r.ok).toBe(true);
    expect(accepted(tables).accepted_snapshot.content.names[0].classes[1]).toMatchObject({ id: "ca-p-1", client_added: true, label: "Online store services" });
    expect(accepted(tables).accepted_snapshot.quote.legal_total_cents).toBe(277_500);
  });

  it("a fixed offer with no client_add takes no added class", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const content = essentialContent();
    delete content.names[0].client_add;
    content.names[0].marks = [content.names[0].marks[0]];
    const { db, tables } = world({ proposal: { content } });
    const r = await acceptPublicProposal(TOKEN, ticks(["p-word", "p-c1"]), NOW, db, { p: ["Online store services"] });
    expect(r.ok).toBe(true);
    expect(accepted(tables).accepted_snapshot.content.names[0].classes).toHaveLength(1);
    expect(accepted(tables).accepted_snapshot.quote.legal_total_cents).toBe(195_000);
  });

  it("ignores forged price, total, per-class and class-count fields", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world({ proposal: { content: essentialContent() } });
    const forged = { ...ticks(["p-word", "p-c1"]), legal_total_cents: 1, total: 1, per_class_cents: 1, class_count: 99, price: 1 };
    const r = await acceptPublicProposal(TOKEN, forged, NOW, db, { ...add(["Online store services", true]), per_class_cents: 1, legal_total_cents: 1 });
    expect(r.ok).toBe(true);
    expect(accepted(tables).accepted_snapshot.quote.legal_total_cents).toBe(277_500);
    expect("legal_total_cents" in accepted(tables).accepted_selection).toBe(false);
  });

  it("repairs a forged mark with every class unticked to its first class, and refuses one with no class at all", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world();
    await acceptPublicProposal(TOKEN, { "p-word": true, "p-c1": false, "p-c2": false }, NOW, db);
    const sel = accepted(tables).accepted_selection;
    expect(sel["p-c1"]).toBe(true);
    for (const nm of accepted(tables).accepted_snapshot.content.names) {
      const markOn = nm.marks.some((m) => sel[m.id]);
      if (markOn) expect(nm.classes.some((c) => sel[c.id])).toBe(true);
    }
    const noClass = sevetri();
    noClass.names[0].classes = [];
    const w = world({ proposal: { content: noClass } });
    expect(await acceptPublicProposal(TOKEN, ticks(["p-word", "t-logo", "t-c1"]), NOW, w.db)).toMatchObject({ ok: false, reason: "nothing_selected" });
    expect(w.tables.client_proposal[0].status).toBe("sent");
  });

  it("refuses client classes on a version that is not sent", async () => {
    for (const status of ["accepted", "superseded", "draft"]) {
      const { db, calls } = world({ proposal: { content: essentialContent(), status } });
      const r = await acceptPublicProposal(TOKEN, ticks(["p-word", "p-c1"]), NOW, db, add(["x", true]));
      expect(r.ok).toBe(false);
      expect(calls.some((c) => c.op === "update")).toBe(false);
    }
  });

  it("pricing with reduce_under_included is only what is stored on the proposal, never the browser's", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world();
    await acceptPublicProposal(TOKEN, { ...ticks(["p-word", "p-c1"]), reduce_under_included: true }, NOW, db, { pricing: { reduce_under_included: true } });
    expect(accepted(tables).accepted_snapshot.quote.legal_total_cents).toBe(495_000);
  });

  it("publicContent keeps client_add, client_entry and prompt", () => {
    const c = openContent() as unknown as Record<string, unknown>;
    (c.names as Array<Record<string, unknown>>)[0].client_add = { max: 2, extra: "x" };
    const out = publicContent(c);
    expect(out.names[0].client_add).toEqual({ max: 2 });
    expect(out.names[0].classes[0]).toEqual({ id: "o1", label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, client_entry: true });
  });
});

/* ─────────────────────────── Spec 6: a package per brand name ──────────── */


describe("acceptPublicProposal with a package per brand name (Spec 6)", () => {
  const ticks = { "fold-word": true, "fold-c1": true, "fold-c2": true, "fold-c3": true, "ci-word": true, "ci-c1": true, "ci-c2": true };

  it("prices the chosen packages on the server and stores the picks and the package per name", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world({ proposal: { content: danielle() } });
    const r = await acceptPublicProposal(TOKEN, { ...ticks, packages: { fold: "Concierge", ci: "Essential" } }, NOW, db);
    if (!r.ok) throw new Error(r.reason);
    expect(r.quote.legal_total_cents).toBe(495_000 + 249_750);
    expect(r.quote.gov_total_cents).toBe(175_000);
    const row = tables.client_proposal[0];
    expect((row.accepted_selection as { packages: unknown }).packages).toEqual({ fold: "Concierge", ci: "Essential" });
    const names = (row.accepted_snapshot as { quote: { names: Array<{ package?: string }> } }).quote.names;
    expect(names.map((n) => n.package)).toEqual(["Concierge", "Essential"]);
  });

  it("ignores any money in the request and falls back to the default for a forged package name", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, tables } = world({ proposal: { content: danielle() } });
    const forged = {
      ...ticks,
      legal_total_cents: 1,
      base_cents: 1,
      packages: { fold: "Free", ci: { package: "Essential", base_cents: 1 } },
      prices: { fold: 100 },
    };
    const r = await acceptPublicProposal(TOKEN, forged, NOW, db, { added: { fold: [{ text: "Candles", on: true, price: 1 }] } });
    if (!r.ok) throw new Error(r.reason);
    // Both defaults (Enhanced): The Fold with 4 classes $4,900, The Confidence Interval 10% off $2,925.
    expect(r.quote.names.map((n) => [n.package, n.legal_cents])).toEqual([["Enhanced", 490_000], ["Enhanced", 292_500]]);
    expect(r.quote.legal_total_cents).toBe(782_500);
    const stored = tables.client_proposal[0].accepted_selection as Record<string, unknown>;
    expect(stored.packages).toEqual({ fold: "Enhanced", ci: "Enhanced" });
    for (const key of ["legal_total_cents", "base_cents", "prices"]) expect(key in stored).toBe(false);
  });
});
