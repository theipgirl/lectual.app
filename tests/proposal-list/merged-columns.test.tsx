import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import * as words from "@/lib/ui/words";
import { SEGMENT_LABEL } from "@/lib/proposals/segments";
import { buildProposalRowView, DEFAULT_PROPOSAL_TITLE, type ListRowInput } from "@/lib/proposals/list-rows";
import { ProposalsTable } from "@/components/proposal-list/ProposalsTable";

vi.mock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn() }));

/** The proposals list's five columns (Nov 10): merged Client response and Fees cells, the blocked reason said once, "Current", brand headlines. */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");
const NOW = Date.parse("2026-11-10T16:00:00Z");

function input(over: Partial<ListRowInput> = {}): ListRowInput {
  return {
    id: "p1",
    family_id: "ab12cd34-0000-4000-8000-000000000000",
    version: 1,
    client_name: "Irina Vilarino",
    title: DEFAULT_PROPOSAL_TITLE,
    status: "sent",
    source: "manual",
    expires_on: "2026-11-28",
    accepted_at: null,
    updated_at: "2026-11-05T13:00:00Z",
    legal_total_cents: 407_500,
    gov_total_cents: 70_000,
    blocking_issue: null,
    brands: ["Oneforme", "Pilates Co"],
    offered: [{ name: "Enhanced", legalAtSigningCents: 407_500, usptoAtFilingCents: 70_000 }],
    class_count: 2,
    signed_package: null,
    package_basis: null,
    ...over,
  };
}
const ctx = (over: Record<string, unknown> = {}) => ({ today: "2026-11-10", tz: "America/New_York", now: NOW, events: new Map(), names: new Map(), ...over });
const view = (over: Partial<ListRowInput> = {}, c: Record<string, unknown> = {}) => buildProposalRowView(input(over), ctx(c));
const table = (rows: ReturnType<typeof view>[]) => text(renderToStaticMarkup(<ProposalsTable rows={rows} footerLeft="" footerRight="" />));
const ACCEPTED = { status: "accepted" as const, accepted_at: "2026-11-04T15:00:00Z" };
const NOT_PAID = { state: "not_paid", undoneAt: null } as const;

describe("C: the default segment is called Current", () => {
  it("is 'Current', and the word is defined once in words.ts", () => {
    expect(words.PROPOSALS_EVERYTHING_SEGMENT).toBe("Current");
    expect(SEGMENT_LABEL.everything).toBe("Current");
    // No other export of words.ts is the bare word "Current".
    expect(Object.entries(words).filter(([k, v]) => v === "Current" && k !== "PROPOSALS_EVERYTHING_SEGMENT")).toEqual([]);
    expect(words.proposalsPaidAsideNote(2)).toBe("2 paid, listed under Paid");
  });
});

describe("the Client response cell merges Accepted, Opened and Paid", () => {
  it("accepted and unpaid: Accepted date, Opened line, then Not paid with Mark paid", () => {
    const v = view(ACCEPTED, { paid: new Map([["p1", NOT_PAID]]), canMarkPaid: true, opens: new Map([["p1", { count: 4, lastAt: "2026-11-08T10:12:00Z" }]]) });
    const cell = table([v]).split('class="wrap pq-c-response"')[1].split("</td>")[0];
    expect(cell).toContain("Accepted Nov 4");
    expect(cell).toMatch(/Opened Nov 8, 5:12 AM · 4 times/);
    expect(cell).toContain("Not paid");
    expect(cell.indexOf("Accepted Nov 4")).toBeLessThan(cell.indexOf("Opened"));
    expect(cell.indexOf("Opened")).toBeLessThan(cell.indexOf("Not paid"));
    expect(cell).toContain(">Mark paid</button>");
  });
  it("a live link not yet accepted: 'Not yet' and 'Not opened yet', no paid line", () => {
    const cell = table([view({}, { opens: new Map() })]).split('class="wrap pq-c-response"')[1].split("</td>")[0];
    expect(cell).toContain("Not yet");
    expect(cell).toContain("Not opened yet");
    expect(cell).not.toContain("pq-paid");
  });
  it("keeps the three-state paid wording: an unreadable paid state is never 'Not paid' and has no button", () => {
    const cell = table([view(ACCEPTED, { paid: "unavailable", canMarkPaid: true })]).split('class="wrap pq-c-response"')[1].split("</td>")[0];
    expect(cell).toContain("Paid status couldn't be read");
    expect(cell).not.toContain("Not paid");
    expect(cell).not.toContain("<button");
  });
  it("data-labels name the merged cells for the phone stack", () => {
    const out = table([view()]);
    expect(out).toContain('data-label="Client response"');
    expect(out).toContain('data-label="Fees"');
  });
});

describe("the Fees cell merges the two fees", () => {
  it("two lines, '$4,075.00 at signing' and '$700.00 at filing', in Geist tabular figures", () => {
    const out = table([view()]);
    expect(out).toContain('<span class="pq-fee-n">$4,075.00</span> <span class="pq-fee-l">at signing</span>');
    expect(out).toContain('<span class="pq-fee-n">$700.00</span> <span class="pq-fee-l">at filing</span>');
    const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");
    expect(css).toMatch(/\.pq-fee \{ font-family: var\(--sans\); font-variant-numeric: tabular-nums; font-size: 14px;/);
    expect(css).not.toMatch(/\.pq-fee[^}]*var\(--mono\)/);
  });
  it("a flat-fee row has no filing line at all", () => {
    const out = table([view({ matter_title: "Termination letter", gov_total_cents: 0 })]);
    expect(out).toContain("at signing");
    expect(out).not.toContain("at filing");
  });
});

describe("the blocked reason is said once, in Status", () => {
  it("Status carries it (clamped, with a title) and the Proposal cell's quiet line is the update time", () => {
    const v = view({ status: "draft", blocking_issue: "Add the pay link before creating the link.", expires_on: null });
    expect(v.activityLine).toBe("Updated 5d ago");
    const out = table([v]);
    expect(out.match(/Add the pay link before creating the link\./g)).toHaveLength(2); // the text and its title, both in the Status cell
    const status = out.split('class="wrap pq-c-status"')[1].split("</td>")[0];
    expect(status).toContain('class="pq-mono pq-sub pq-status-sub" title="Add the pay link before creating the link."');
    const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");
    expect(css).toMatch(/\.pq-status-sub \{[^}]*-webkit-line-clamp: 2/);
  });
  it("other rows keep their last-activity line in the Proposal cell", () => {
    expect(view(ACCEPTED, { paid: new Map() }).activityLine).toBe("Accepted by the client · 6d ago");
  });
});

describe("the Status pill never wraps", () => {
  it("is one line, with a column sized for ACCEPTED BY CLIENT", () => {
    const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");
    expect(css).toMatch(/td\.pq-c-status \.pq-pill \{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.pq-th-status \{ width: 176px; \}/);
  });
});

describe("F: a default-titled proposal is named by its brand names in the list only", () => {
  it("brand names are the headline, the type is in the sub-line, and nothing stored changes", () => {
    const v = view();
    expect(v.headline).toBe("ONEFORME & PILATES CO");
    expect(v.subline).toMatch(/^Trademark proposal · pr-ab12cd · /);
  });
  it("more than two brand names says how many more", () => {
    expect(view({ brands: ["a", "b", "c", "d"] }).headline).toBe("A & B +2");
  });
  it("a custom title, a flat-fee row and a row with no brand names are unchanged", () => {
    expect(view({ title: "Portfolio renewal" }).headline).toBe("Portfolio renewal — ONEFORME & PILATES CO");
    expect(view({ matter_title: "Termination letter" }).headline).toBe("Trademark Proposal — Termination letter");
    expect(view({ brands: [] }).headline).toBe("Trademark Proposal");
    expect(view({ brands: [] }).subline.startsWith("Trademark proposal")).toBe(false);
  });
});
