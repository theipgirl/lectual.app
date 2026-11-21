import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReviewRows, type ReviewInput } from "@/lib/review/build";
import { bucketOf } from "@/lib/review/buckets";
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
