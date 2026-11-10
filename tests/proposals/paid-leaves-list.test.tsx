import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildProposalRowView, type ListRowInput } from "@/lib/proposals/list-rows";
import { paidStateFromEvents, stepPayload, type StepEventInput } from "@/lib/proposals/paid";
import { PROPOSAL_SEGMENTS, inSegment } from "@/lib/proposals/segments";
import { PROPOSALS_ALL_PAID, PROPOSALS_PAID_UNREADABLE } from "@/lib/ui/words";
import { item, renderListPage, rowOf, segments } from "./list-page-harness";

vi.mock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn() }));

/** A PAID proposal leaves the default list (never deleted) and is listed under Paid. Paid = the Paid column's own state. */

const TZ = "America/New_York";
const NOW = Date.parse("2026-10-27T16:00:00Z");

describe("the segment rule (pure)", () => {
  it("a paid row is under Paid and under no other segment", () => {
    for (const s of PROPOSAL_SEGMENTS) expect(inSegment(s, "accepted", true), s).toBe(s === "paid");
  });
  it("a row that is not paid (or whose paid state could not be read) is never under Paid and keeps its other segments", () => {
    expect(inSegment("paid", "accepted", false)).toBe(false);
    expect(inSegment("everything", "accepted", false)).toBe(true);
    expect(inSegment("accepted", "accepted", false)).toBe(true);
    expect(inSegment("everything", "sent")).toBe(true);
  });
});

describe("paid is derived from the events, so Undo and a reset bring the row back", () => {
  const marked: StepEventInput = { type: "edited", actor: "staff", actor_user_id: "u1", created_at: "2026-10-24T16:00:00Z", payload: stepPayload("paid_marked", "marked") };
  const undone: StepEventInput = { type: "edited", actor: "staff", actor_user_id: "u1", created_at: "2026-10-25T16:00:00Z", payload: stepPayload("paid_undone", "undone") };
  const reset: StepEventInput = { type: "reset", actor: "staff", actor_user_id: "u1", created_at: "2026-10-26T16:00:00Z", payload: {} };
  const accepted: ListRowInput = {
    id: "p1", family_id: "ab12cd34-0000-4000-8000-000000000000", version: 1, client_name: "Client p1", title: "Trademark Proposal", status: "accepted", source: "manual",
    expires_on: "2026-11-28", accepted_at: "2026-10-21T15:00:00Z", updated_at: "2026-10-26T13:00:00Z", legal_total_cents: 495_000, gov_total_cents: 70_000, blocking_issue: null,
    brands: [], offered: [], class_count: 2, signed_package: null, package_basis: null,
  };
  const inDefault = (events: StepEventInput[]) => {
    const view = buildProposalRowView(accepted, { today: "2026-10-27", tz: TZ, now: NOW, events: new Map(), names: new Map(), paid: new Map([["p1", paidStateFromEvents(events)]]), canMarkPaid: true });
    return { view, paid: view.paidCell.kind === "paid", default: inSegment("everything", view.key, view.paidCell.kind === "paid"), listed: PROPOSAL_SEGMENTS.filter((s) => inSegment(s, view.key, view.paidCell.kind === "paid")) };
  };

  it("marked paid: only Paid", () => {
    expect(inDefault([marked]).listed).toEqual(["paid"]);
  });
  it("Undo (paid_undone is the newest): back in the default list and Accepted, out of Paid", () => {
    const r = inDefault([marked, undone]);
    expect(r.paid).toBe(false);
    expect(r.listed).toEqual(["everything", "accepted"]);
  });
  it("marked again after the undo: Paid again", () => {
    expect(inDefault([marked, undone, { ...marked, created_at: "2026-10-26T10:00:00Z" }]).listed).toEqual(["paid"]);
  });
  it("a reset after the paid mark starts a fresh round: not paid, back in the default list", () => {
    expect(inDefault([marked, reset]).listed).toEqual(["everything", "accepted"]);
  });
});

describe("the page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T16:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const PAID_STEP = { paid: { state: "paid", by: null, at: "2026-10-24T16:00:00Z" }, newest: null };
  const rows = [
    item("p1", { status: "accepted", accepted_at: "2026-10-21T15:00:00Z" }),
    item("u1", { status: "accepted", accepted_at: "2026-10-22T15:00:00Z" }),
    item("s1", { status: "sent", expires_on: "2026-10-30" }),
    item("x1", { status: "withdrawn" }),
  ];
  const steps = { p1: PAID_STEP };

  it("hides the paid proposal from the default list; the counts and the footer agree with what is shown", async () => {
    const html = await renderListPage({}, { rows, steps });
    expect(html).not.toContain("Client p1<");
    for (const c of ["u1", "s1", "x1"]) expect(html).toContain(`Client ${c}<`);
    expect(segments(html)).toEqual(["Current:3", "Out with a client:1", "Drafts and blocked:0", "Accepted:1", "Paid:1", "Expired:0"]);
    expect(html.match(/<tr data-status=/g)).toHaveLength(3);
    expect(html).toContain("3 proposals · 1 paid, listed under Paid");
  });

  it("the Paid segment lists it (with Undo), and its count is the number of rows shown", async () => {
    const html = await renderListPage({ segment: "paid" }, { rows, steps });
    expect(html).toContain("Client p1<");
    expect(rowOf(html, "Client p1<")).toContain("Paid Oct 24");
    expect(html.match(/<tr data-status=/g)).toHaveLength(1);
    expect(segments(html)).toContain("Paid:1");
    expect(html).toContain("1 of 4 proposals");
  });

  it("Accepted is accepted-and-not-paid", async () => {
    const html = await renderListPage({ segment: "accepted" }, { rows, steps });
    expect(html).toContain("Client u1<");
    expect(html).not.toContain("Client p1<");
    expect(html.match(/<tr data-status=/g)).toHaveLength(1);
    expect(html).toContain("1 of 4 proposals");
  });

  it("Out and Expired and Drafts are unaffected by paid ones", async () => {
    const out = await renderListPage({ segment: "out" }, { rows, steps });
    expect(out).toContain("Client s1<");
    expect(out.match(/<tr data-status=/g)).toHaveLength(1);
  });

  it("an Undo (the paid state back to not paid) puts the row back in the default list and Accepted", async () => {
    const html = await renderListPage({}, { rows, steps: { p1: { paid: { state: "not_paid", undoneAt: "2026-10-25T16:00:00Z" }, newest: null } } });
    expect(html).toContain("Client p1<");
    expect(rowOf(html, "Client p1<")).toContain("Not paid");
    expect(segments(html)).toEqual(["Current:4", "Out with a client:1", "Drafts and blocked:0", "Accepted:2", "Paid:0", "Expired:0"]);
    expect(html).toContain("All 4 proposals");
  });

  it("a paid state that could not be read is NOT paid: every accepted row stays in the default list and Accepted, and Paid has no count", async () => {
    const html = await renderListPage({}, { rows, steps: "fail" });
    for (const c of ["p1", "u1", "s1", "x1"]) expect(html).toContain(`Client ${c}<`);
    expect(rowOf(html, "Client p1<")).toContain("Paid status couldn&#x27;t be read");
    expect(segments(html)).toEqual(["Current:4", "Out with a client:1", "Drafts and blocked:0", "Accepted:2", "Paid:—", "Expired:0"]);
    vi.resetModules();
    const acc = await renderListPage({ segment: "accepted" }, { rows, steps: "fail" });
    expect(acc).toContain("Client p1<");
    expect(acc).toContain("Client u1<");
  });

  it("the Paid segment while the paid read failed says it can't list them, never 'No paid proposals' and never an empty table", async () => {
    const html = await renderListPage({ segment: "paid" }, { rows, steps: "fail" });
    expect(html).toContain('data-paid="unreadable"');
    expect(html.replaceAll("&#x27;", "'")).toContain(PROPOSALS_PAID_UNREADABLE);
    expect(html).not.toContain("No paid proposals yet.");
    expect(html).not.toContain("<tr data-status=");
  });

  it("the Paid segment with nothing paid says so", async () => {
    const html = await renderListPage({ segment: "paid" }, { rows });
    expect(html).toContain("No paid proposals yet.");
  });

  it("when every proposal is paid the default list says so and points at Paid", async () => {
    const html = await renderListPage({}, { rows: [rows[0]], steps });
    expect(html.replaceAll("&#x27;", "'")).toContain(PROPOSALS_ALL_PAID);
    expect(html).toMatch(/href="\/dashboard\/proposals\/?\?segment=paid"/);
    expect(html).not.toContain("No proposals yet");
  });

  it("no paid logic is added to the page or the segment helper: they read the row's own paid cell", () => {
    for (const f of ["src/app/dashboard/proposals/page.tsx", "src/lib/proposals/segments.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/paid_marked|paid_undone|paidStateFromEvents|stepStates\(/);
    }
  });
});
