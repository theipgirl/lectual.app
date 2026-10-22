import { describe, expect, it } from "vitest";
import {
  MILESTONE_LABEL,
  MILESTONE_STAGE_NAMES,
  ORDERED_MILESTONES,
  SIDE_MILESTONES,
  SNIPPET_MAX,
  classifyMail,
  classifyNote,
  milestoneRank,
  opensMatter,
  parseMilestoneMapping,
  snippetOf,
  stageForMilestone,
  topMilestone,
  type Milestone,
} from "../../src/lib/reconcile/milestones";
import type { StageOpt } from "../../src/lib/reconcile/types";
import { STAGES } from "./helpers";

/** Invented notes in the SHAPE of the team's sheet log and Lawmatics notes. No real client text. */
const sorted = (m: Milestone[]) => [...m].sort();

describe("the milestone order", () => {
  it("is exactly contacted < consult_scheduled < consult_held < questionnaire_sent < opinion_letter_sent < proposal_sent < follow_up_sent < accepted < loe_sent < paid / hired", () => {
    expect([...ORDERED_MILESTONES]).toEqual([
      "contacted",
      "consult_scheduled",
      "consult_held",
      "questionnaire_sent",
      "opinion_letter_sent",
      "proposal_sent",
      "follow_up_sent",
      "accepted",
      "loe_sent",
      "paid",
    ]);
    const ranks = ORDERED_MILESTONES.map((m) => milestoneRank(m));
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(milestoneRank("hired")).toBe(milestoneRank("paid"));
  });

  it("no_show, declined and nurture sit outside the order", () => {
    expect([...SIDE_MILESTONES]).toEqual(["no_show", "declined", "nurture"]);
    for (const m of SIDE_MILESTONES) expect(milestoneRank(m)).toBeNull();
  });

  it("accepted, paid and hired are the ones that mean a client", () => {
    expect(["accepted", "paid", "hired"].every((m) => opensMatter(m as Milestone))).toBe(true);
    expect(["loe_sent", "proposal_sent", "contacted", "declined"].some((m) => opensMatter(m as Milestone))).toBe(false);
  });

  it("topMilestone is the highest ordered one and ignores the side milestones", () => {
    expect(topMilestone(["contacted", "proposal_sent", "consult_held"])).toBe("proposal_sent");
    expect(topMilestone(["no_show", "declined"])).toBeNull();
    expect(topMilestone([])).toBeNull();
    expect(topMilestone(["paid", "hired"])).toBe("paid");
  });

  it("every milestone has a label", () => {
    for (const m of [...ORDERED_MILESTONES, "hired", ...SIDE_MILESTONES] as Milestone[]) expect(MILESTONE_LABEL[m]).toMatch(/\w/);
  });
});

describe("classifyNote: table of real-shaped examples", () => {
  const cases: Array<[string, Milestone[]]> = [
    // RPB's sheet styles
    ["10/14 consult done – sent proposal", ["consult_held", "proposal_sent"]],
    ["10.14.26 consult done - proposal sent", ["consult_held", "proposal_sent"]],
    ["LVM", ["contacted"]],
    ["lvm 10/3", ["contacted"]],
    ["left a voicemail for PNC", ["contacted"]],
    ["f/u sent", ["follow_up_sent"]],
    ["F/U sent 10.18.26", ["follow_up_sent"]],
    ["RL sent follow up email", ["follow_up_sent"]],
    ["followed up with PNC by phone", ["follow_up_sent"]],
    ["OL sent", ["opinion_letter_sent"]],
    ["opinion letter sent to client 9.2.26", ["opinion_letter_sent"]],
    ["paid via Lawmatics", ["paid"]],
    ["deposit received 10.1.26", ["paid"]],
    ["payment received", ["paid"]],
    ["PNC scheduled consult for 10.15.26", ["consult_scheduled"]],
    ["strategy session booked for Friday", ["consult_scheduled"]],
    ["discovery call set up", ["consult_scheduled"]],
    ["consultation held 9.3.26", ["consult_held"]],
    ["had the consult today", ["consult_held"]],
    ["met with PNC, strategy session complete", ["consult_held"]],
    ["RL sent post consult email 8.20.26", ["consult_held"]],
    ["sent questionnaire", ["questionnaire_sent"]],
    ["intake form sent to PNC", ["questionnaire_sent"]],
    ["TAM sent LOE and invoice 9.8.26", ["loe_sent"]],
    ["engagement letter sent", ["loe_sent"]],
    ["sent invoice", ["loe_sent"]],
    ["sent proposal", ["proposal_sent"]],
    ["proposal emailed 10/16", ["proposal_sent"]],
    ["pricing sent to client", ["proposal_sent"]],
    ["PNC accepted the proposal", ["accepted"]],
    ["client signed LOE", ["accepted"]],
    ["wants to proceed", ["accepted"]],
    ["hired 10.20.26", ["hired"]],
    ["onboarded", ["hired"]],
    ["PNC declined", ["declined"]],
    ["not interested", ["declined"]],
    ["went with another firm", ["declined"]],
    ["marked lost", ["declined"]],
    ["nurture - circle back in the spring", ["nurture"]],
    ["not ready yet", ["nurture"]],
    ["no show for the consult", ["no_show"]],
    ["PNC did not attend", ["no_show"]],
    ["missed the call", ["no_show"]],
    // both ends of one note
    ["consult done, sent proposal, f/u sent", ["consult_held", "proposal_sent", "follow_up_sent"]],
  ];

  it.each(cases)("%s", (text, expected) => {
    const got = classifyNote(text);
    // Every expected milestone is found; the shorthand "contacted" may ride along on a note that also says "emailed"/"called".
    for (const m of expected) expect(got, text).toContain(m);
  });

  it("is a table of at least 40 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it("the single-fact notes classify to exactly that one fact", () => {
    for (const [text, expected] of cases.filter(([, e]) => e.length === 1)) {
      const got = classifyNote(text).filter((m) => m !== "contacted" || expected[0] === "contacted");
      expect(sorted(got), text).toEqual(sorted(expected));
    }
  });

  it("the highest ordered milestone wins on a mixed note", () => {
    expect(topMilestone(classifyNote("10/14 consult done – sent proposal"))).toBe("proposal_sent");
    expect(topMilestone(classifyNote("consult done, sent proposal, f/u sent"))).toBe("follow_up_sent");
  });
});

describe("classifyNote: negation guards and unknown text", () => {
  it.each([
    "did not attend",
    "PNC didn't attend the consult",
    "no show",
    "no-show 10/14",
    "consult not held",
    "consult did not happen",
    "never showed",
  ])('"%s" is not consult_held', (text) => {
    expect(classifyNote(text)).not.toContain("consult_held");
  });

  it("no show is its own fact", () => {
    expect(classifyNote("no show")).toContain("no_show");
    expect(classifyNote("did not attend")).toContain("no_show");
  });

  it('"rescheduled" is not consult_held (a consult was moved, not had)', () => {
    const got = classifyNote("PNC rescheduled");
    expect(got).not.toContain("consult_held");
    expect(got).toEqual(["consult_scheduled"]);
  });

  it("a cancelled consult is neither scheduled nor held", () => {
    const got = classifyNote("consult cancelled");
    expect(got).not.toContain("consult_held");
    expect(got).not.toContain("consult_scheduled");
  });

  it.each([
    "proposal not sent yet",
    "need to send proposal",
    "will send proposal tomorrow",
    "proposal to be sent",
    "have not sent the proposal",
    "waiting to send the LOE",
  ])('"%s" is not a send', (text) => {
    const got = classifyNote(text);
    expect(got).not.toContain("proposal_sent");
    expect(got).not.toContain("loe_sent");
  });

  it.each(["not paid", "unpaid", "payment pending", "has not accepted yet", "not hired"])('"%s" is not a client', (text) => {
    const got = classifyNote(text);
    expect(got.some((m) => opensMatter(m))).toBe(false);
  });

  it.each(["", "   ", "see attached", "internal: check the database", "RL opened the file", "waiting on paperwork", "9.4.26"])('unknown text "%s" returns no milestone', (text) => {
    expect(classifyNote(text)).toEqual([]);
  });

  it("null and undefined are no milestone", () => {
    expect(classifyNote(null)).toEqual([]);
    expect(classifyNote(undefined)).toEqual([]);
  });

  it("dates are not words: a bare date never classifies", () => {
    expect(classifyNote("10/14")).toEqual([]);
    expect(classifyNote("10.12.26")).toEqual([]);
  });
});

describe("classifyMail: direction matters", () => {
  it('a received "proposal" email is not proposal_sent', () => {
    expect(classifyMail({ subject: "Question about your proposal", direction: "received" })).toEqual(["contacted"]);
  });

  it("a sent proposal email is", () => {
    expect(classifyMail({ subject: "Your Trademark Proposal", direction: "sent" })).toEqual(["proposal_sent"]);
    expect(classifyMail({ subject: "Re: Your Trademark Proposal", direction: "sent" })).toEqual(["proposal_sent"]);
  });

  it.each([
    ["Following up on your proposal", "follow_up_sent"],
    ["Checking in", "follow_up_sent"],
    ["Your opinion letter", "opinion_letter_sent"],
    ["Questionnaire for your brand", "questionnaire_sent"],
    ["Engagement letter and invoice", "loe_sent"],
    ["Thank you for meeting with us", "consult_held"],
    ["Payment received, thank you", "paid"],
  ])('a sent "%s" is %s', (subject, milestone) => {
    expect(classifyMail({ subject, direction: "sent" })).toContain(milestone);
  });

  it("uses the sync's own stored type when the subject says nothing", () => {
    expect(classifyMail({ subject: "Hello", direction: "sent", storedType: "post-consult" })).toEqual(["consult_held"]);
    expect(classifyMail({ subject: "Hello", direction: "sent", storedType: "loe-invoice" })).toEqual(["loe_sent"]);
    expect(classifyMail({ subject: "Hello", direction: "sent", storedType: "follow-up" })).toEqual(["follow_up_sent"]);
  });

  it("a calendar reply is not an acceptance of anything", () => {
    expect(classifyMail({ subject: "Accepted: Strategy session", direction: "received" })).toEqual([]);
    expect(classifyMail({ subject: "Declined: Strategy session", direction: "sent" })).toEqual([]);
  });

  it("a thread about a dispute says nothing at all", () => {
    expect(classifyMail({ subject: "Settlement proposal from opposing counsel", direction: "sent" })).toEqual([]);
  });

  it("other sent mail is only contact", () => {
    expect(classifyMail({ subject: "Hello there", direction: "sent" })).toEqual(["contacted"]);
  });
});

describe("milestone -> the firm's stage name", () => {
  const byName = (name: string) => STAGES.find((s) => s.name === name)!;

  it("uses ONE defaults table and resolveStage", () => {
    expect(stageForMilestone("contacted", STAGES)).toBe(byName("Potential New Client"));
    expect(stageForMilestone("consult_scheduled", STAGES)).toBe(byName("Consultation Scheduled"));
    expect(stageForMilestone("proposal_sent", STAGES)).toBe(byName("Post Consultation Email Sent"));
    expect(stageForMilestone("loe_sent", STAGES)).toBe(byName("LOE & Invoice Sent"));
    expect(Object.keys(MILESTONE_STAGE_NAMES).sort()).toEqual(
      ["consult_held", "consult_scheduled", "contacted", "declined", "follow_up_sent", "loe_sent", "nurture", "opinion_letter_sent", "proposal_sent", "questionnaire_sent"].sort(),
    );
  });

  it("a milestone the firm has no stage for gives no proposal, never the first stage", () => {
    expect(stageForMilestone("consult_held", STAGES)).toBeNull();
    expect(stageForMilestone("opinion_letter_sent", STAGES)).toBeNull();
    expect(stageForMilestone("questionnaire_sent", STAGES)).toBeNull();
    expect(stageForMilestone("follow_up_sent", STAGES)).toBeNull();
  });

  it("the matter-opening milestones and no_show name no stage at all", () => {
    for (const m of ["accepted", "paid", "hired", "no_show"] as const) expect(stageForMilestone(m, STAGES)).toBeNull();
  });

  it("a firm with its own stage names gets them (Proposal Sent, Follow-Up Sent)", () => {
    const own: StageOpt[] = [...STAGES, { id: "own-proposal", name: "Proposal Sent", category: "open", orderIndex: 4.5 }, { id: "own-fu", name: "Follow-Up Sent", category: "open", orderIndex: 4.6 }];
    expect(stageForMilestone("proposal_sent", own)?.id).toBe("own-proposal");
    expect(stageForMilestone("follow_up_sent", own)?.id).toBe("own-fu");
  });

  it("the firm brain's stage_mapping entry wins, and one naming a stage the firm lacks gives nothing (no fall-back)", () => {
    const mapping = parseMilestoneMapping([
      { key: "proposal_sent", data: { stage: "Undecided / Questions" } },
      { key: "loe-invoice-sent", body: "Pending LOE + Payment" },
      { key: "consult-scheduled", data: { stage: "A stage that is not here" } },
    ]);
    expect(stageForMilestone("proposal_sent", STAGES, mapping)).toBe(byName("Undecided / Questions"));
    expect(stageForMilestone("loe_sent", STAGES, mapping)).toBe(byName("LOE & Invoice Sent"));
    expect(stageForMilestone("consult_scheduled", STAGES, mapping)).toBeNull();
  });

  it("parseMilestoneMapping reads milestone keys and the Stage Keeper's signal ids, and ignores everything else", () => {
    expect(
      parseMilestoneMapping([
        { key: "Proposal-Sent", body: "Proposal Sent" },
        { key: "questionnaire-sent", data: { stage: "Questionnaire" } },
        { key: "lawmatics-map", body: "x" },
        { key: 7 },
        { key: "paid", body: "Won" },
        { key: "nurture", body: "" },
      ]),
    ).toEqual({ proposal_sent: "Proposal Sent", questionnaire_sent: "Questionnaire" });
  });
});

describe("snippets", () => {
  it("are at most 140 characters, whitespace collapsed", () => {
    const long = "word ".repeat(80);
    const out = snippetOf(long);
    expect(out.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(snippetOf("a   b\n\nc")).toBe("a b c");
  });
});
