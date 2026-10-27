import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { buildProposalRowView, sortForSegment, MARK_PAID_NOTE, PAID_UNREADABLE_TEXT, type ListRowInput } from "@/lib/proposals/list-rows";
import { ProposalsTable } from "@/components/proposal-list/ProposalsTable";
import { item, renderListPage, rowOf } from "./list-page-harness";

vi.mock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn() }));

/** Sprint 29 E: Accepted and Paid on every row of the proposals list. */

const NOW = Date.parse("2026-10-27T16:00:00Z");
const TZ = "America/New_York";
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");

function input(over: Partial<ListRowInput> = {}): ListRowInput {
  return {
    id: "p1",
    family_id: "ab12cd34-0000-4000-8000-000000000000",
    version: 1,
    client_name: "Irina Vilarino",
    title: "Trademark package",
    status: "sent",
    source: "manual",
    expires_on: "2026-11-28",
    accepted_at: null,
    updated_at: "2026-10-26T13:00:00Z",
    legal_total_cents: 660_000,
    gov_total_cents: 175_000,
    blocking_issue: null,
    brands: ["Oneforme"],
    offered: [{ name: "Concierge", legalAtSigningCents: 660_000, usptoAtFilingCents: 175_000 }],
    class_count: 2,
    signed_package: null,
    package_basis: null,
    ...over,
  };
}
const ctx = (over: Record<string, unknown> = {}) => ({ today: "2026-10-27", tz: TZ, now: NOW, events: new Map(), names: new Map([["u-dawn", "Dawn"]]), ...over });
const ACCEPTED = { status: "accepted" as const, accepted_at: "2026-10-21T15:00:00Z" };
const NOT_PAID = { state: "not_paid", undoneAt: null } as const;
const PAID = { state: "paid", by: "u-dawn", at: "2026-10-24T16:00:00Z" } as const;

describe("the Accepted cell", () => {
  it("'Accepted Oct 21' for an accepted row, 'Not yet' for every other", () => {
    expect(buildProposalRowView(input(ACCEPTED), ctx({ paid: new Map([["p1", NOT_PAID]]) })).accepted).toBe("Accepted Oct 21");
    for (const status of ["draft", "approved", "sent", "withdrawn", "superseded"] as const) {
      expect(buildProposalRowView(input({ status }), ctx()).accepted, status).toBe("Not yet");
    }
  });

  it("an accepted row with no stamp still says Accepted, never a made-up date", () => {
    expect(buildProposalRowView(input({ status: "accepted", accepted_at: null }), ctx({ paid: new Map() })).accepted).toBe("Accepted");
  });
});

describe("the Paid cell", () => {
  const cell = (over: Partial<ListRowInput>, paid: unknown, canMarkPaid = true) => buildProposalRowView(input(over), ctx({ paid, canMarkPaid })).paidCell;

  it("is a dash for a row that is not accepted", () => {
    for (const status of ["draft", "sent", "withdrawn"] as const) expect(cell({ status }, new Map())).toEqual({ kind: "none", text: "—" });
    // Even when a paid map is handed in: only an accepted row has a paid state.
    expect(cell({ status: "sent" }, new Map([["p1", PAID]]))).toEqual({ kind: "none", text: "—" });
  });

  it("'Not paid' with Mark paid for a role that may", () => {
    expect(cell(ACCEPTED, new Map([["p1", NOT_PAID]]))).toEqual({ kind: "not_paid", text: "Not paid", canMark: true });
    expect(cell(ACCEPTED, new Map([["p1", NOT_PAID]]), false)).toEqual({ kind: "not_paid", text: "Not paid", canMark: false });
  });

  it("'Paid Oct 24' with Undo for a role that may; who marked it is the tooltip", () => {
    expect(cell(ACCEPTED, new Map([["p1", PAID]]))).toEqual({ kind: "paid", text: "Paid Oct 24", title: "Paid · marked by Dawn · Oct 24", canUndo: true });
    expect(cell(ACCEPTED, new Map([["p1", PAID]]), false)).toMatchObject({ kind: "paid", canUndo: false });
  });

  it("an unreadable step history is its own state, never 'Not paid', with no button", () => {
    expect(cell(ACCEPTED, "unavailable")).toEqual({ kind: "unreadable", text: "Paid status couldn't be read" });
    expect(PAID_UNREADABLE_TEXT).toBe("Paid status couldn't be read");
  });

  it("an accepted row with no entry in the map reads as not paid (the read worked and found nothing)", () => {
    expect(cell(ACCEPTED, new Map())).toMatchObject({ kind: "not_paid" });
  });
});

describe("the table markup", () => {
  const row = (over: Partial<ListRowInput>, paid: unknown, canMarkPaid = true) => buildProposalRowView(input(over), ctx({ paid, canMarkPaid }));
  const html = (rows: ReturnType<typeof row>[]) => text(renderToStaticMarkup(<ProposalsTable rows={rows} footerLeft="" footerRight="" />));
  const buttons = (h: string) => [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

  it("every row has an Accepted and a Paid cell, and the headers say so", () => {
    const out = html([row({ id: "a", status: "draft" }, new Map()), row({ id: "b", ...ACCEPTED }, new Map([["b", NOT_PAID]])), row({ id: "c", ...ACCEPTED }, new Map([["c", PAID]])), row({ id: "d", ...ACCEPTED }, "unavailable")]);
    expect([...out.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).slice(3, 5)).toEqual(["Accepted", "Paid"]);
    expect(out.match(/class="pq-c-accepted"/g)).toHaveLength(4);
    expect(out.match(/class="wrap pq-c-paid"/g)).toHaveLength(4);
    const [draft, unpaid, paid, unread] = out.split("<tr ").slice(1);
    expect(draft).toContain(">Not yet<");
    expect(draft).toContain('<span class="pq-paid-none">—</span>');
    expect(unpaid).toContain("Accepted Oct 21");
    expect(unpaid).toContain("Not paid");
    expect(buttons(unpaid)).toEqual(["Mark paid"]);
    expect(unpaid).toContain(MARK_PAID_NOTE);
    expect(MARK_PAID_NOTE).toBe("Mark paid after you've confirmed the payment in Lawmatics.");
    expect(paid).toContain("Paid Oct 24");
    expect(buttons(paid)).toEqual(["Undo"]);
    expect(paid).not.toContain(MARK_PAID_NOTE);
    expect(unread).toContain("Paid status couldn't be read");
    expect(unread).not.toContain("Not paid");
    expect(buttons(unread)).toEqual([]);
  });

  it("a role outside the paid roles sees the words and no button on any row", () => {
    const out = html([row({ id: "b", ...ACCEPTED }, new Map([["b", NOT_PAID]]), false), row({ id: "c", ...ACCEPTED }, new Map([["c", PAID]]), false)]);
    expect(buttons(out)).toEqual([]);
    expect(out).not.toContain(MARK_PAID_NOTE);
    expect(out).toContain("Not paid");
    expect(out).toContain("Paid Oct 24");
  });

  it("the buttons post the row's own id", () => {
    const out = html([row({ id: "b7", ...ACCEPTED }, new Map([["b7", NOT_PAID]]))]);
    expect(out).toContain('<input type="hidden" name="proposalId" value="b7"/>');
  });
});

describe("the Accepted segment lists accepted-and-not-paid first", () => {
  const cellOf = (kind: "not_paid" | "unreadable" | "paid" | "none", id: string) => ({ id, paidCell: { kind, text: "" } as never });
  const rows = [cellOf("paid", "paid1"), cellOf("not_paid", "np1"), cellOf("none", "none1"), cellOf("unreadable", "un1"), cellOf("not_paid", "np2"), cellOf("paid", "paid2")];

  it("sorts not paid, then unreadable, then paid, keeping the list's order inside each group", () => {
    expect(sortForSegment("accepted", rows).map((r) => r.id)).toEqual(["np1", "np2", "un1", "paid1", "paid2", "none1"]);
  });

  it("leaves every other segment in the list's order, and never mutates its input", () => {
    for (const segment of ["everything", "out", "drafts", "expired"]) expect(sortForSegment(segment, rows).map((r) => r.id)).toEqual(rows.map((r) => r.id));
    sortForSegment("accepted", rows);
    expect(rows[0].id).toBe("paid1");
  });
});

describe("the page: the Accepted segment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T16:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const PAID_STEP = { paid: { state: "paid", by: "u-dawn", at: "2026-10-24T16:00:00Z" }, newest: null };
  const rows = [
    item("p1", { status: "accepted", accepted_at: "2026-10-21T15:00:00Z" }),
    item("u1", { status: "accepted", accepted_at: "2026-10-22T15:00:00Z" }),
    item("p2", { status: "accepted", accepted_at: "2026-10-23T15:00:00Z" }),
    item("s1", { status: "sent", expires_on: "2026-10-30" }),
  ];

  it("shows the two accepted-not-paid proposals above the paid ones", async () => {
    const html = await renderListPage({ segment: "accepted" }, { rows, steps: { p1: PAID_STEP, p2: PAID_STEP } });
    const order = ["Client u1", "Client p1", "Client p2"].map((n) => html.indexOf(n));
    expect(order.every((i) => i > 0)).toBe(true);
    // u1 is the only one not paid, so it leads; the paid two keep their order.
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(rowOf(html, "Client u1")).toContain("Not paid");
    expect(html).not.toContain("Client s1");
  });

  it("the Everything segment keeps the list's order", async () => {
    const html = await renderListPage({}, { rows, steps: { p1: PAID_STEP, p2: PAID_STEP } });
    expect(html.indexOf("Client p1")).toBeLessThan(html.indexOf("Client u1"));
  });
});

describe("mobile, wording and no new paid logic", () => {
  const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");

  it("under 760px a row stacks and Accepted and Paid sit directly under the client's name", () => {
    const block = css.slice(css.indexOf("Under 760px a row is a stack"));
    expect(block).toContain("@media (max-width: 760px)");
    expect(block).toContain('"proposal proposal" "client client" "accepted paid"');
    expect(block).toMatch(/td\.pq-c-accepted\s*\{\s*grid-area: accepted/);
    expect(block).toMatch(/td\.pq-c-paid\s*\{\s*grid-area: paid/);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("the stopgap is said in the code and in AGENTS.md", () => {
    for (const file of ["src/components/proposal-list/PaidCell.tsx", "src/lib/proposals/list-rows.ts", "src/components/proposal-list/ProposalsTable.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/stopgap/i);
    }
    expect(readFileSync("src/components/proposal-list/PaidCell.tsx", "utf8")).toContain("LawPay");
    expect(readFileSync("AGENTS.md", "utf8")).toMatch(/Mark paid[^\n]*stopgap[^\n]*LawPay/i);
  });

  it("the list adds no paid logic: it only imports from paid-view and the existing actions", () => {
    for (const file of ["src/components/proposal-list/PaidCell.tsx", "src/components/proposal-list/ProposalsTable.tsx", "src/lib/proposals/list-rows.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/paid_marked|paid_undone|paidStateFromEvents|stepStates\(/);
    }
    const cellSrc = readFileSync("src/components/proposal-list/PaidCell.tsx", "utf8");
    expect(cellSrc).toContain('from "@/app/dashboard/proposals/[id]/paid-actions"');
    expect(cellSrc).toContain("markPaidAction");
    expect(cellSrc).toContain("undoPaidAction");
  });
});
