import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReviewRows, type ReviewInput } from "@/lib/review/build";
import { reviewBuckets } from "@/lib/review/buckets";
import { boardLanes } from "@/lib/review/lanes";
import { ReviewBoard } from "@/components/review/ReviewViews";
import { row, TODAY } from "./fixtures";

/**
 * Review fix: the lead's mail feeds a matter's Sent line and last contact date, NOT whose turn it is. A paid matter with an
 * overdue step whose lead's last mail was ours (the proposal) stays in Our turn, keeps its Overdue chip and shows the Sent line.
 */
const NOW = new Date("2026-11-02T15:00:00Z");
const matter = {
  id: "m1", matter_number: "TM-1", title: "Acme mark", mark_text: "ACME", owner_name: "Acme Inc", status: "open", lead_id: "l1", assigned_to: "u1",
  stage_entered_at: "2026-10-20T00:00:00Z", created_at: "2026-10-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null,
  stage_id: "st1", stage: { code: "3", label: "Signed LOE / Deposit Received", is_open: true, waiting_on: "firm", order_index: 3 },
};
const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  matters: [matter] as never, leads: [], leadStages: [], deadlines: [], lastStageChange: new Map(),
  tasks: [{ id: "t1", title: "Prepare the application", due_at: "2026-10-28T00:00:00Z", assignee_id: "u1", matter_id: "m1", lead_id: null }],
  activity: [{ lead_id: "l1", matter_id: null, type: "email_sent", created_at: "2026-10-25T15:00:00Z" }],
  pendingMatterIds: new Set(), pendingLeadIds: new Set(), sources: { activity: "ok", deadlines: "ok" }, timeZone: "America/New_York", now: NOW, ...over,
});
const params = { view: "board", who: "all", kind: "both", q: "", i: 1, person: null, open: null, since: "default" } as never;
const members = [{ userId: "u1", name: "Rayn Cole", role: "attorney" }];

describe("a matter's lead mail: Sent line and last contact, not direction", () => {
  it("the paid matter with an overdue step stays in Our turn with its Overdue chip, and shows the lead's Sent line", () => {
    const [r] = buildReviewRows(input());
    expect(r.lastOutbound).toBe("2026-10-25");
    expect(r.lastContact).toEqual({ date: "2026-10-25", type: "email_sent" });
    expect(r.lastDirection).toBeNull();
    expect(r.waiting).not.toBe("client");
    const lanes = boardLanes(reviewBuckets([r], TODAY), members);
    expect(lanes[0].our.map((x) => x.key)).toEqual(["m-m1"]);
    expect(lanes[0].client).toEqual([]);
    const html = renderToStaticMarkup(<ReviewBoard lanes={lanes} today={TODAY} members={members} canWrite params={params} />);
    expect(html).toContain("Overdue since Oct 28");
    expect(html).toMatch(/data-sent="yes"[^>]*>[^<]*Oct 25/);
  });

  it("the matter's OWN mail still sets its direction", () => {
    const [r] = buildReviewRows(input({ activity: [{ lead_id: null, matter_id: "m1", type: "email_sent", created_at: "2026-10-25T15:00:00Z" }] }));
    expect(r.lastDirection).toBe("we");
    expect(r.waiting).toBe("client");
  });

  it("a Waiting on client card keeps its due chip when the step is overdue or due this week; otherwise it draws none", () => {
    const draw = (dueDate: string) => {
      const r = row({ key: "m-9", waiting: "client", lastDirection: "we", nextStep: { id: "t9", title: "Call back", dueDate, assigneeId: null } });
      return renderToStaticMarkup(<ReviewBoard lanes={[{ userId: null, name: "Unassigned", our: [], client: [r], count: 1 }] as never} today={TODAY} members={[]} canWrite params={params} />);
    };
    expect(draw("2026-10-30")).toContain("Overdue since Oct 30");
    expect(draw("2026-11-04")).toContain("Due Nov 4");
    expect(draw("2026-11-30")).not.toContain("Due Nov 30");
  });
});
