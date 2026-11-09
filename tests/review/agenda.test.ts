import { describe, expect, it } from "vitest";
import { agendaOrder, agendaPositions, agendaQueue, agendaSection, readStage, stageNumber } from "@/lib/review/agenda";
import { buildDeck } from "@/lib/review/deck";
import { reviewBuckets } from "@/lib/review/buckets";
import { row, TODAY } from "./fixtures";

const step = (dueDate: string | null, assigneeId: string | null = null) => ({ id: "t", title: "x", dueDate, assigneeId });
const RECENT = { date: "2026-10-30", type: "email_sent" as const };
/** A matter that is on a plain dated next step with recent contact: bucket `track`. */
const quietOk = { nextStep: step("2026-12-20"), lastContact: RECENT };
const flagged = { nextStep: step("2026-11-04") }; // due this week
const sec = (o: Parameters<typeof row>[0]) => agendaSection(row(o), TODAY);

describe("stage reading (the one keyword table)", () => {
  it.each([
    ["10. Preparing Opinion Letter", "pre-filing"],
    ["11. Opinion Letter Sent", "pre-filing"],
    ["12. Application Preparation", "pre-filing"],
    ["Signed LOE / Deposit Received", "pre-filing"],
    ["Trademark Search", "pre-filing"],
    ["18. Awaiting Trademark Registration", "post-filing"],
    ["19A. OA Issued", "post-filing"],
    ["19F. OA Response Sent", "post-filing"],
    ["20D. SOU Preparation", "post-filing"],
    ["20E. SOU Accepted", "post-filing"],
    ["21A. NOA Issued", "post-filing"],
    ["22. Publication for Opposition", "post-filing"],
    ["Section 8 Declaration", "post-filing"],
    ["Renewal due", "post-filing"],
    ["Extension filed", "post-filing"],
    ["14. Something new", "pre-filing"], // numbered under 18
    ["26. No Longer Moving Forward", "post-filing"], // numbered 18 or over
    ["Waiting room", "unknown"],
    [null, "unknown"],
  ])("%s -> %s", (label, want) => expect(readStage(label)).toBe(want));
  it("reads the number", () => {
    expect(stageNumber("19A. OA Issued")).toBe(19);
    expect(stageNumber("Opinion Letter")).toBeNull();
  });
});

describe("agendaSection", () => {
  it("every lead is section 1, whatever its bucket, stage or any matter type", () => {
    expect(sec({ kind: "lead", stageLabel: "Proposal Sent", ...flagged })).toBe("new-clients");
    expect(sec({ kind: "lead", stageLabel: "Anything", ...quietOk })).toBe("new-clients"); // on track: still 1, never parked
    expect(sec({ kind: "lead", stageLabel: "19A. OA Issued", matterType: "BL", nextStep: null })).toBe("new-clients");
    expect(sec({ kind: "lead", stageLabel: null, waiting: "uspto", nextStep: null })).toBe("new-clients");
  });
  it("a TM matter before filing is section 2", () => {
    expect(sec({ stageLabel: "10. Preparing Opinion Letter", matterType: "TM", ...flagged })).toBe("tm-in-progress");
    expect(sec({ stageLabel: "12. Application Preparation", ...flagged })).toBe("tm-in-progress"); // type absent reads as TM
  });
  it("unknown stage text for a TM matter is section 2, never dropped", () => {
    expect(sec({ stageLabel: "Waiting room", matterType: "TM", ...flagged })).toBe("tm-in-progress");
    expect(sec({ stageLabel: null, matterType: "TM", ...flagged })).toBe("tm-in-progress");
  });
  it("a TM matter at or past filing is section 3", () => {
    for (const stageLabel of ["19A. OA Issued", "22. Publication for Opposition", "21A. NOA Issued", "20D. SOU Preparation", "Extension", "Renewal", "18. Awaiting Trademark Registration"]) {
      expect(sec({ stageLabel, matterType: "TM", ...flagged })).toBe("uspto");
    }
  });
  it("CR and PATENT follow the trademark docket", () => {
    expect(sec({ stageLabel: "12. Application Preparation", matterType: "CR", ...flagged })).toBe("tm-in-progress");
    expect(sec({ stageLabel: "19A. OA Issued", matterType: "PATENT", ...flagged })).toBe("uspto");
  });
  it("any other matter type is section 4, whatever the stage", () => {
    for (const matterType of ["BL", "LIT", "EL", "SO"]) {
      expect(sec({ stageLabel: "19A. OA Issued", matterType, ...flagged })).toBe("contracts");
      expect(sec({ stageLabel: "10. Preparing Opinion Letter", matterType, ...flagged })).toBe("contracts");
    }
  });
  it("parked: an on-track matter is section 5 in any matter section", () => {
    expect(sec({ stageLabel: "12. Application Preparation", ...quietOk })).toBe("parked");
    expect(sec({ stageLabel: "19A. OA Issued", ...quietOk })).toBe("parked");
    expect(sec({ stageLabel: "Retainer", matterType: "BL", ...quietOk })).toBe("parked");
  });
  it("parked: a post-filing matter only waiting on the USPTO is section 5", () => {
    expect(sec({ stageLabel: "22. Publication for Opposition", waiting: "uspto", nextStep: null })).toBe("parked");
  });
  it("not parked while something is due, undated, quiet or has a docketed deadline", () => {
    expect(sec({ stageLabel: "19F. OA Response Sent", waiting: "uspto", nextStep: step("2026-10-20") })).toBe("uspto"); // overdue
    expect(sec({ stageLabel: "19A. OA Issued", nextStep: null })).toBe("uspto"); // needs a next step
    expect(sec({ stageLabel: "19A. OA Issued", nextStep: step("2026-12-20"), lastContact: { date: "2026-09-01", type: "email_sent" } })).toBe("uspto"); // quiet
    expect(sec({ stageLabel: "19A. OA Issued", waiting: "uspto", nextStep: null, deadline: { dueDate: "2026-11-20", title: "Response" } })).toBe("uspto");
    expect(sec({ stageLabel: "12. Application Preparation", ...quietOk, deadline: { dueDate: "2026-11-20", title: null } })).toBe("tm-in-progress");
  });
  it("a pre-filing matter waiting on the USPTO is not parked by that alone (only section 3 parks on it)", () => {
    expect(sec({ stageLabel: "12. Application Preparation", waiting: "uspto", nextStep: null })).toBe("tm-in-progress");
  });
});

describe("agendaOrder", () => {
  it("always returns the five sections in the meeting's order, empty ones included", () => {
    const g = agendaOrder([], TODAY);
    expect(g.map((x) => x.section)).toEqual(["new-clients", "tm-in-progress", "uspto", "contracts", "parked"]);
    expect(g.every((x) => x.rows.length === 0)).toBe(true);
  });
  it("sorts by urgency, then client A-Z, deterministically (input order does not matter)", () => {
    const rows = [
      row({ key: "q", client: "Quiet", nextStep: step("2026-12-20"), lastContact: { date: "2026-09-01", type: "email_sent" } }),
      row({ key: "n", client: "Needs", nextStep: null }),
      row({ key: "w2", client: "Zed Week", nextStep: step("2026-11-04") }),
      row({ key: "w1", client: "Abe Week", nextStep: step("2026-11-05") }),
      row({ key: "o", client: "Over", nextStep: step("2026-10-20") }),
    ];
    const keys = (r: typeof rows) => agendaOrder(r, TODAY)[1].rows.map((x) => x.key);
    expect(keys(rows)).toEqual(["o", "w1", "w2", "n", "q"]);
    expect(keys([...rows].reverse())).toEqual(["o", "w1", "w2", "n", "q"]);
  });
  it("USPTO section: soonest deadline first inside an urgency level, deadline-less rows after", () => {
    const base = { stageLabel: "19A. OA Issued", nextStep: step("2026-11-04") };
    const g = agendaOrder(
      [
        row({ key: "none", client: "Aaa", ...base }),
        row({ key: "late", client: "Bbb", ...base, deadline: { dueDate: "2026-12-30", title: "OA" } }),
        row({ key: "soon", client: "Ccc", ...base, deadline: { dueDate: "2026-11-12", title: "OA" } }),
        row({ key: "over", client: "Ddd", stageLabel: "19A. OA Issued", nextStep: step("2026-10-20"), deadline: { dueDate: "2027-01-30", title: "OA" } }),
      ],
      TODAY,
    );
    expect(g[2].rows.map((r) => r.key)).toEqual(["over", "soon", "late", "none"]);
  });
  it("new clients: proposals expiring or expired first inside an urgency level, earliest expiry first", () => {
    const lead = { kind: "lead" as const, nextStep: step("2026-11-04") };
    const tag = (expiresOn: string, expired = false) => ({ text: "x", expiresOn, expired });
    const g = agendaOrder(
      [
        row({ key: "plain", client: "Aaa", ...lead }),
        row({ key: "later", client: "Bbb", ...lead, proposalExpiry: tag("2026-11-09") }),
        row({ key: "gone", client: "Ccc", ...lead, proposalExpiry: tag("2026-10-26", true) }),
      ],
      TODAY,
    );
    expect(g[0].rows.map((r) => r.key)).toEqual(["gone", "later", "plain"]);
  });
  it("the rest (waiting on the USPTO, on track) sorts after the flagged urgency levels", () => {
    const g = agendaOrder(
      [
        row({ key: "parked", client: "Aaa", ...quietOk, kind: "lead" }),
        row({ key: "needs", client: "Zzz", kind: "lead", nextStep: null }),
      ],
      TODAY,
    );
    expect(g[0].rows.map((r) => r.key)).toEqual(["needs", "parked"]);
  });
  it("meeting queue walks sections 1 to 4 and leaves Parked out", () => {
    const rows = [
      row({ key: "park", client: "P", ...quietOk }),
      row({ key: "biz", client: "B", matterType: "BL", ...flagged }),
      row({ key: "oa", client: "O", stageLabel: "19A. OA Issued", ...flagged }),
      row({ key: "tm", client: "T", ...flagged }),
      row({ key: "lead", client: "L", kind: "lead", ...flagged }),
    ];
    const groups = agendaOrder(rows, TODAY);
    expect(agendaQueue(groups).map((r) => r.key)).toEqual(["lead", "tm", "oa", "biz"]);
    expect([...agendaPositions(groups).keys()]).toEqual(["lead", "tm", "oa", "biz", "park"]);
  });
});

describe("Cards deck follows the agenda order", () => {
  const members = [{ userId: "u-reb", name: "Rebecca", role: "owner" }];
  it("walks one person's rows section by section, urgency inside a section", () => {
    const mine = { assignedTo: "u-reb" };
    const rows = [
      row({ key: "biz", client: "B", matterType: "BL", ...mine, nextStep: step("2026-10-20", "u-reb") }),
      row({ key: "oa", client: "O", stageLabel: "19A. OA Issued", ...mine, nextStep: step("2026-10-21", "u-reb") }),
      row({ key: "tmWeek", client: "T2", ...mine, nextStep: step("2026-11-04", "u-reb") }),
      row({ key: "tmOver", client: "T1", ...mine, nextStep: step("2026-10-22", "u-reb") }),
      row({ key: "lead", client: "L", kind: "lead", ...mine, nextStep: step("2026-11-05", "u-reb") }),
    ];
    const deck = buildDeck(reviewBuckets(rows, TODAY), members, "u-reb", TODAY);
    // Board column order would have been biz, oa, tmOver, tmWeek, lead.
    expect(deck.map((c) => c.row.key)).toEqual(["lead", "tmOver", "tmWeek", "oa", "biz"]);
  });
});
