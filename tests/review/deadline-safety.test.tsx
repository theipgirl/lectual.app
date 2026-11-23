import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReviewRows, type ReviewInput } from "@/lib/review/build";
import { bucketOf, reviewBuckets, reviewSubline } from "@/lib/review/buckets";
import { boardLanes, kpis } from "@/lib/review/lanes";
import { waitingCell } from "@/lib/review/sheet";
import { rowTags } from "@/lib/review/tags";
import { deadlinesOut } from "@/lib/review/strips";
import { DeadlinesStrip } from "@/components/review/ReviewViews";
import { parseReviewParams } from "@/lib/review/params";

process.env.__NEXT_TRAILING_SLASH = "true";
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");

const NOW = new Date("2026-11-02T15:00:00Z");
const TODAY = "2026-11-02";
const matter = (over: Record<string, unknown> = {}) => ({
  id: "m1", matter_number: "TM-1", title: "Acme mark", mark_text: "ACME", owner_name: "Acme Inc", status: "open", type: "TM", serial_number: "97000001", filing_date: null,
  lead_id: null, assigned_to: "u1", stage_entered_at: "2026-10-20T00:00:00Z", created_at: "2026-01-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null,
  stage: { code: "10", label: "Application Filed", is_open: true, waiting_on: "firm", order_index: 5 }, ...over,
});
const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  matters: [matter()] as never, leads: [], leadStages: [], tasks: [], activity: [], deadlines: [], lastStageChange: new Map(),
  pendingMatterIds: new Set(), pendingLeadIds: new Set(), sources: { activity: "ok", deadlines: "ok" }, timeZone: "America/New_York", now: NOW, ...over,
});

describe("AT1 (Weekly review): a filed TM matter with no open deadline carries the 'No open deadline' tag", () => {
  it("tagged when no open deadline; never a different bucket", () => {
    const [flagged] = buildReviewRows(base());
    const [withDeadline] = buildReviewRows(base({ deadlines: [{ id: "d1", matter_id: "m1", due_date: "2026-12-01", title: "OA", kind: "office_action_response", attorney_confirmed: true }] }));
    expect(flagged.noOpenDeadline).toBe(true);
    expect(rowTags(flagged, TODAY).map((t) => t.text)).toContain("No open deadline");
    expect(withDeadline.noOpenDeadline).toBe(false);
    expect(rowTags(withDeadline, TODAY).map((t) => t.text)).not.toContain("No open deadline");
    // The tag changes no bucket: the same row with and without the flag lands in the same section.
    expect(bucketOf(flagged, TODAY)).toBe(bucketOf({ ...flagged, noOpenDeadline: false }, TODAY));
  });

  it("not tagged when the matter is not filed (no serial number or filing date) or not a TM", () => {
    expect(buildReviewRows(base({ matters: [matter({ serial_number: null })] as never }))[0].noOpenDeadline).toBe(false);
    expect(buildReviewRows(base({ matters: [matter({ type: "CR" })] as never }))[0].noOpenDeadline).toBe(false);
  });

  it("AT2: when the deadlines read failed, nothing is tagged and no strip rows exist", () => {
    const [row] = buildReviewRows(base({ sources: { activity: "ok", deadlines: "unavailable" } }));
    expect(row.noOpenDeadline).toBe(false);
    expect(row.openDeadlines).toBeUndefined();
  });
});

describe("registered marks (Taylor, Nov 23): the review's flag rule, and buckets unchanged", () => {
  const regStage = { code: "24", label: "Trademark Registered", is_open: true, waiting_on: "uspto", order_index: 24, phase: "maintenance" };
  const dl = (kind: string) => ({ id: `d-${kind}`, matter_id: "m1", due_date: "2031-06-01", title: null, kind, attorney_confirmed: true });

  it("a registered TM row with only an office action open is tagged; with an open Section 8 it isn't; the bucket never moves", () => {
    // A firm whose maintenance stage is open on the docket (so the matter is a review row): the registered rule applies.
    const [oaOnly] = buildReviewRows(base({ matters: [matter({ stage: regStage })] as never, deadlines: [dl("office_action_response")] }));
    const [withS8] = buildReviewRows(base({ matters: [matter({ stage: regStage })] as never, deadlines: [dl("section_8_declaration")] }));
    const [none] = buildReviewRows(base({ matters: [matter({ stage: regStage })] as never }));
    expect(oaOnly.noOpenDeadline).toBe(true);
    expect(none.noOpenDeadline).toBe(true);
    expect(withS8.noOpenDeadline).toBe(false);
    expect(rowTags(oaOnly, TODAY).map((t) => t.text)).toContain("No open deadline");
    for (const r of [oaOnly, none]) expect(bucketOf(r, TODAY)).toBe(bucketOf({ ...r, noOpenDeadline: false }, TODAY));
  });

  it("a failed deadlines read tags nothing", () => {
    const [row] = buildReviewRows(base({ matters: [matter({ stage: regStage })] as never, sources: { activity: "ok", deadlines: "unavailable" } }));
    expect(row.noOpenDeadline).toBe(false);
  });

});

describe("registered marks become review rows when no Section 8 / 9 is open (Taylor, Nov 23 follow-up; changed on purpose)", () => {
  // RPB's registered stage: closed on the docket, phase maintenance, waiting on the USPTO on the docket.
  const closedReg = { code: "24", label: "Trademark Registered", is_open: false, waiting_on: "uspto", order_index: 24, phase: "maintenance" };
  const dl = (kind: string) => ({ id: `d-${kind}`, matter_id: "m1", due_date: "2031-06-01", title: null, kind, attorney_confirmed: true });
  const reg = (over: Record<string, unknown> = {}) => matter({ stage: closedReg, ...over });
  const task = (due: string | null) => ({ id: "t1", matter_id: "m1", lead_id: null, title: "Docket the Section 8", due_at: due ? `${due}T15:00:00Z` : null, assignee_id: "u1" });

  it("admitted with no deadline: one row, tagged, never waiting on the USPTO (no USPTO tag, ordinary waiting)", () => {
    const rows = buildReviewRows(base({ matters: [reg()] as never }));
    expect(rows).toHaveLength(1);
    expect(rows[0].registeredNoDeadline).toBe(true);
    expect(rows[0].noOpenDeadline).toBe(true);
    expect(rows[0].waiting).not.toBe("uspto");
    const tags = rowTags(rows[0], TODAY).map((t) => t.text);
    expect(tags).toContain("No open deadline");
    expect(tags.some((t) => /USPTO/.test(t))).toBe(false);
    // The Sheet's Waiting column shows the ordinary value, never "USPTO": with no mail and no approval that is the plain dash, the
    // same as an open filed matter whose stage isn't with the USPTO; an approval reads Approval.
    expect(rows[0].waiting).toBeNull();
    expect(waitingCell(rows[0], (d) => d)).not.toBe("USPTO");
    const [withApproval] = buildReviewRows(base({ matters: [reg()] as never, pendingMatterIds: new Set(["m1"]) }));
    expect(withApproval.waiting).toBe("approval");
  });

  it("normal bucket rules (changed on purpose: no longer forced to On track)", () => {
    const at = (t: ReturnType<typeof task> | null) => {
      const [r] = buildReviewRows(base({ matters: [reg()] as never, ...(t ? { tasks: [t] as never } : {}) }));
      return r;
    };
    // no next step -> Needs a next step (not the USPTO list, which the stage would have given it)
    expect(bucketOf(at(null), TODAY)).toBe("needs");
    // an overdue step -> Overdue, in a lane, counted by the KPI
    const overdue = at(task("2026-10-01"));
    expect(bucketOf(overdue, TODAY)).toBe("overdue");
    const b = reviewBuckets([overdue], TODAY);
    expect(kpis(b).overdue).toBe(1);
    expect(boardLanes(b, []).flatMap((l) => [...l.our, ...l.client]).map((r) => r.id)).toContain("m1");
    // due this week -> Due this week
    expect(bucketOf(at(task("2026-11-04")), TODAY)).toBe("week");
    // a dated step later, recent contact -> On track; never "uspto"
    const later = { ...at(task("2026-12-20")), contactKnown: true, lastContact: { date: "2026-11-01", type: "email_sent" as never } };
    expect(bucketOf(later, TODAY)).toBe("track");
    // the same, but quiet for 14+ days -> Quiet
    expect(bucketOf({ ...later, lastContact: { date: "2026-10-01", type: "email_sent" as never } }, TODAY)).toBe("quiet");
    for (const r of [at(null), overdue, later]) expect(kpis(reviewBuckets([r], TODAY)).uspto).toBe(0);
  });

  it("admitted with only an office action open", () => {
    expect(buildReviewRows(base({ matters: [reg()] as never, deadlines: [dl("office_action_response")] }))).toHaveLength(1);
  });

  it("not admitted with an open Section 8 or an open Section 9 renewal", () => {
    expect(buildReviewRows(base({ matters: [reg()] as never, deadlines: [dl("section_8_declaration")] }))).toHaveLength(0);
    expect(buildReviewRows(base({ matters: [reg()] as never, deadlines: [dl("section_9_renewal")] }))).toHaveLength(0);
  });

  it("not admitted when the deadlines read failed (never a guess)", () => {
    expect(buildReviewRows(base({ matters: [reg()] as never, sources: { activity: "ok", deadlines: "unavailable" } }))).toHaveLength(0);
  });

  it("not admitted for a non-TM matter, a closed non-maintenance stage, or a closed / on-hold matter", () => {
    for (const over of [{ type: "CR" }, { type: "BL" }, { stage: { ...closedReg, phase: "inactive" } }, { stage: { ...closedReg, phase: null } }, { status: "closed" }, { status: "on_hold" }])
      expect(buildReviewRows(base({ matters: [reg(over)] as never })), JSON.stringify(over)).toHaveLength(0);
  });

  it("never twice: an open maintenance stage stays an ordinary row (its stage's USPTO waiting kept), not a second admitted one", () => {
    const rows = buildReviewRows(base({ matters: [reg({ stage: { ...closedReg, is_open: true } })] as never }));
    expect(rows).toHaveLength(1);
    expect(rows[0].registeredNoDeadline).toBeUndefined();
    expect(rows[0].waiting).toBe("uspto");
  });

  it("the sub-line counts them apart: 'N open · M registered', M only when > 0", () => {
    const rows = buildReviewRows(base({ matters: [reg(), matter({ id: "m2" })] as never }));
    const b = reviewBuckets(rows, TODAY);
    expect(b.total).toBe(2);
    expect(reviewSubline(b)).toMatch(/^1 open · 1 registered · /);
    expect(reviewSubline(reviewBuckets(buildReviewRows(base()), TODAY))).toMatch(/^1 open · /);
    expect(reviewSubline(reviewBuckets(buildReviewRows(base()), TODAY))).not.toContain("registered");
  });
});

describe("Weekly review Deadlines strip", () => {
  const rows = buildReviewRows(
    base({
      matters: [matter(), matter({ id: "m2", owner_name: "Beta LLC", serial_number: null })] as never,
      deadlines: [
        { id: "d2", matter_id: "m1", due_date: "2026-12-01", title: "Statement of use", kind: "statement_of_use", attorney_confirmed: true },
        { id: "d1", matter_id: "m2", due_date: "2026-11-10", title: null, kind: "office_action_response", attorney_confirmed: false },
        { id: "d0", matter_id: "m1", due_date: "2026-10-30", title: "Old one", kind: "other", attorney_confirmed: false },
      ],
    }),
  );

  it("lists every open deadline in the filtered rows, soonest first, confirmed or not", () => {
    const out = deadlinesOut(rows, TODAY);
    expect(out.map((d) => d.id)).toEqual(["d0", "d1", "d2"]);
    expect(out.map((d) => d.confirmed)).toEqual([false, false, true]);
    expect(out[0].overdue).toBe(true);
    expect(out[1].title).toBe("Office Action response");
    // Filtering the rows filters the strip.
    expect(deadlinesOut(rows.filter((r) => r.id === "m2"), TODAY).map((d) => d.id)).toEqual(["d1"]);
  });

  it("each item links to ?open= (the record card) and says Unconfirmed / Confirmed", () => {
    const params = parseReviewParams({});
    const html = text(renderToStaticMarkup(<DeadlinesStrip items={deadlinesOut(rows, TODAY)} failed={false} params={params} />));
    expect(html).toContain("open=matter%3Am2");
    expect(html).toMatch(/data-deadline="d1" data-confirmed="no"/);
    expect(html).toMatch(/data-deadline="d2" data-confirmed="yes"/);
    expect(html).toContain("Unconfirmed");
    expect(html).toContain("Confirmed");
    expect(html.indexOf('data-deadline="d0"')).toBeLessThan(html.indexOf('data-deadline="d2"'));
  });

  it("a failed read says so, never 'No open deadlines'", () => {
    const html = text(renderToStaticMarkup(<DeadlinesStrip items={[]} failed params={parseReviewParams({})} />));
    expect(html).toContain("Deadlines couldn't load.");
    expect(html).not.toContain("No open deadlines");
  });

  it("an ok read with none says so", () => {
    const html = text(renderToStaticMarkup(<DeadlinesStrip items={[]} failed={false} params={parseReviewParams({})} />));
    expect(html).toContain("No open deadlines in this view.");
  });
});
