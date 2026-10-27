import { describe, expect, it } from "vitest";
import { describeActivity } from "../../src/components/leads/describe";
import { evidenceTooltip, reasonText } from "../../src/lib/stage-keeper/format";
import { chipFor, consumedSignalKeys, currentAgentMoves, parseAgentMove, parseSuggestion, type ActivityRow } from "../../src/lib/stage-keeper/moves";
import { SIGNAL_LABEL, SIGNAL_IDS } from "../../src/lib/stage-keeper/signals";
import { agentEvidenceFor, emailSignalFor } from "../../src/lib/reconcile/email";
import { proposeStage } from "../../src/lib/reconcile/propose";
import { firmSendersFrom, isFirmSender, effectiveDirection } from "../../src/lib/mailbox/firm-sender";
import { classifyMail } from "../../src/lib/reconcile/milestones";
import { FIRM, S } from "./fixtures";

const NOW = new Date("2026-10-27T15:00:00Z");

const moveRow = (evidence: unknown, signal: string, to = S.post): ActivityRow => ({
  id: "move-1",
  lead_id: "lead-1",
  type: "stage_changed",
  actor_type: "ai",
  created_at: "2026-10-27T14:00:00Z",
  payload: { actor: "agent:stage-keeper", from_stage: "Consultation Scheduled", to_stage: "Post Consultation Email Sent", from_stage_id: S.consult, to_stage_id: to, signal, signal_key: "k", evidence },
});

const meetingEvidence = { kind: "meeting", provider: "zoom", title: "Strategy session", starts_at: "2026-10-23T16:00:00Z" };
const proposalEvidence = { kind: "proposal", version: 2, status: "sent", at: "2026-10-25T16:00:00Z" };
const queueEvidence = { kind: "queue", type: "CLIENT_EMAIL", at: "2026-10-26T16:00:00Z" };

describe("the new kinds read back without raw ids or an unknown kind", () => {
  it("every signal id has a label", () => {
    for (const id of SIGNAL_IDS) expect(SIGNAL_LABEL[id]).toBeTruthy();
    expect(SIGNAL_LABEL["consult-held"]).toBe("Consult held");
  });

  it("moves.ts parses all three and the chip names the evidence's own date", () => {
    const meeting = parseAgentMove(moveRow(meetingEvidence, "consult-held"))!;
    expect(meeting.evidence).toEqual(meetingEvidence);
    expect(chipFor(meeting, NOW, "America/New_York").text).toBe("Moved by agent · Consult held Oct 23");
    expect(chipFor(meeting, NOW, "America/New_York").tooltip).toBe('Evidence: Zoom meeting "Strategy session" on Oct 23.');

    const proposal = parseAgentMove(moveRow(proposalEvidence, "post-consult-sent"))!;
    expect(chipFor(proposal, NOW, "America/New_York").text).toBe("Moved by agent · Post-consult sent Oct 25");
    expect(chipFor(proposal, NOW, "America/New_York").tooltip).toBe("Evidence: proposal version 2 link live Oct 25.");

    const queue = parseAgentMove(moveRow(queueEvidence, "post-consult-sent"))!;
    expect(chipFor(queue, NOW, "America/New_York").tooltip).toBe("Evidence: post-consult email approved Oct 26.");
  });

  it("the reason sentences are plain and name no id", () => {
    expect(reasonText(meetingEvidence as never, "America/New_York")).toBe("a Zoom consult was held on Oct 23");
    expect(reasonText({ ...meetingEvidence, provider: "fathom" } as never)).toBe("a Fathom consult was held on Oct 23");
    expect(reasonText(proposalEvidence as never)).toBe("the proposal link was turned on on Oct 25");
    expect(reasonText({ ...proposalEvidence, status: "accepted" } as never)).toBe("the proposal link was accepted by the client on Oct 25");
    expect(reasonText(queueEvidence as never)).toBe("the post-consult email was approved on Oct 26");
    expect(evidenceTooltip({ kind: "queue", type: "CLIENT_EMAIL", at: null })).toBe("Evidence: post-consult email approved.");
  });

  it("the lead timeline line says why, in words", () => {
    for (const [evidence, signal, expected] of [
      [meetingEvidence, "consult-held", "because a Zoom consult was held on Oct 23"],
      [proposalEvidence, "post-consult-sent", "because the proposal link was turned on on Oct 25"],
      [queueEvidence, "post-consult-sent", "because the post-consult email was approved on Oct 26"],
    ] as const) {
      const row = moveRow(evidence, signal);
      const described = describeActivity({ ...row, actor_id: null } as never, { timeZone: "America/New_York" } as never);
      expect(described.title).toContain(expected);
      expect(described.title).not.toMatch(/unknown|undefined|\[object|move-1|lead-1/i);
    }
  });

  it("a suggestion card carries the new evidence", () => {
    const row: ActivityRow = {
      id: "s-1",
      lead_id: "lead-1",
      type: "ai_insight",
      created_at: "2026-10-27T14:00:00Z",
      payload: { source: "stage-keeper", kind: "stage_suggestion", to_stage_id: S.post, signal: "consult-held", why: "autonomy", evidence: meetingEvidence },
    };
    expect(parseSuggestion(row)?.evidence).toEqual(meetingEvidence);
  });

  it("an unknown evidence kind still parses to null, never to a partial object", () => {
    expect(parseAgentMove(moveRow({ kind: "something-new", x: 1 }, "consult-held"))!.evidence).toBeNull();
    expect(parseAgentMove(moveRow({ kind: "meeting" }, "consult-held"))!.evidence).toBeNull();
  });

  it("also_signal_keys are consumed with the move", () => {
    const row = moveRow(proposalEvidence, "post-consult-sent");
    (row.payload as Record<string, unknown>).also_signal_keys = ["lead-1:meeting:m1", 7, ""];
    expect([...consumedSignalKeys([row])].sort()).toEqual(["k", "lead-1:meeting:m1"]);
  });
});

describe("the reconcile Email / calendar source and proposeStage cite them as dated evidence", () => {
  it("a held meeting and a live proposal become dated agent evidence the proposal can use", () => {
    const rows = [moveRow(meetingEvidence, "consult-held", S.consult), { ...moveRow(proposalEvidence, "post-consult-sent"), id: "move-2", created_at: "2026-10-27T14:30:00Z" }];
    // Only the latest stage change counts as the lead's current agent move; evidence is read per row set.
    const meetingOnly = agentEvidenceFor([rows[0]]);
    expect(meetingOnly).toEqual([{ stageId: S.consult, wording: "Stage Keeper: Consult held", date: meetingEvidence.starts_at }]);
    const proposalOnly = agentEvidenceFor([rows[1]]);
    expect(proposalOnly).toEqual([{ stageId: S.post, wording: "Stage Keeper: Post-consult sent", date: proposalEvidence.at }]);

    const email = emailSignalFor([], FIRM, proposalOnly);
    expect(email).toMatchObject({ kind: "stage", stageId: S.post, date: proposalEvidence.at });
    const proposal = proposeStage(
      { currentStageId: S.newPnc },
      { sheet: { kind: "none" }, lawmatics: { kind: "none" }, email },
      FIRM,
    );
    expect(proposal.stage?.id).toBe(S.post);
    expect(proposal.evidenceDate).toBe(proposalEvidence.at);
    expect(proposal.reasons.join(" ")).toContain("Stage Keeper");
    expect(proposal.reasons.join(" ")).toContain("Oct 25");
  });
});

describe("the firm-sender rule", () => {
  const firm = firmSendersFrom(["info@firm.test", "Rebecca <rebecca@firm.test>", "owner@gmail.com", null, "not an address"]);

  it("a sender on a firm domain or exactly a firm address is the firm", () => {
    expect(isFirmSender("trademark@firm.test", firm)).toBe(true);
    expect(isFirmSender("TRADEMARK@FIRM.TEST", firm)).toBe(true);
    expect(isFirmSender("owner@gmail.com", firm)).toBe(true);
    expect(isFirmSender("client@gmail.com", firm)).toBe(false);
    expect(isFirmSender("client@firm.test.evil.com", firm)).toBe(false);
    expect(isFirmSender(null, firm)).toBe(false);
    expect(isFirmSender("garbage", firm)).toBe(false);
  });

  it("only inbound mail changes direction", () => {
    expect(effectiveDirection("inbound", "trademark@firm.test", firm)).toBe("outbound");
    expect(effectiveDirection("inbound", "client@other.test", firm)).toBe("inbound");
    expect(effectiveDirection("outbound", "client@other.test", firm)).toBe("outbound");
  });

  it("feeds the milestone classifier by subject: a cc'd post-consult proposal email is a firm-sent milestone, a client's reply is just contact", () => {
    const sent = classifyMail({ subject: "Your Trademark Proposal", direction: "sent", storedType: "post-consult" });
    expect(sent).toContain("proposal_sent");
    const received = classifyMail({ subject: "Your Trademark Proposal", direction: "received", storedType: "post-consult" });
    expect(received).toEqual(["contacted"]);
  });
});
