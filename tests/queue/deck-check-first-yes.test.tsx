import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { needsCloserLook, type CloserLookFlags } from "@/lib/queue/deck";
import { qitem } from "./routing-fixtures";

vi.mock("@/app/dashboard/queue/deck/actions", () => ({
  approveCardAction: vi.fn(),
  markReadCardAction: vi.fn(),
  rejectCardAction: vi.fn(),
  handOffCardAction: vi.fn(),
  laterCardAction: vi.fn(),
  returnCardAction: vi.fn(),
  sendDraftNowAction: vi.fn(),
}));
vi.mock("@/app/dashboard/queue/actions", () => ({ reviewQueueAction: vi.fn() }));

const { ApprovalCard } = await import("@/components/deck/ApprovalCard");

const AUDIT = { signOff: "The Team", teamSignOff: "The Team", memberNames: [] };
const checkFirst = qitem({ id: "q1", summary: "CHECK FIRST: the fee quoted" });
const plain = qitem({ id: "q2" });
const PASS: CloserLookFlags = { linkedProposalPassed: true };

describe("a CHECK FIRST card with a passing linked proposal offers Yes", () => {
  it("passing gate + check-first -> no closer look", () => {
    expect(needsCloserLook(checkFirst, AUDIT, PASS)).toEqual([]);
  });
  it("failing gate + check-first -> Open to review", () => {
    expect(needsCloserLook(checkFirst, AUDIT, { linkedProposal: true })).toEqual(["check-first", "linked-proposal"]);
    expect(needsCloserLook(checkFirst, AUDIT, { linkedProposal: true, linkedProposalPassed: false })).toContain("check-first");
  });
  it("unknown gate -> Open to review", () => {
    expect(needsCloserLook(checkFirst, AUDIT, undefined)).toEqual(["check-first"]);
    expect(needsCloserLook(checkFirst, AUDIT, {})).toEqual(["check-first"]);
    expect(needsCloserLook(checkFirst, AUDIT, { linkedProposalPassed: undefined })).toEqual(["check-first"]);
  });
  it("a pass never contradicts a failure flag", () => {
    expect(needsCloserLook(checkFirst, AUDIT, { linkedProposalPassed: true, linkedProposal: true })).toContain("check-first");
  });
  it("passing gate + stale -> Open to review", () => {
    expect(needsCloserLook(checkFirst, AUDIT, { ...PASS, stale: true })).toEqual(["stale"]);
    expect(needsCloserLook(plain, AUDIT, { ...PASS, stale: true })).toEqual(["stale"]);
  });
  it("passing gate + draft issue -> Open to review", () => {
    const bad = qitem({ id: "q3", summary: "CHECK FIRST: the fee quoted", draft_body: "Hi [confirm the time]\n\nBest,\nThe Team" });
    expect(needsCloserLook(bad, AUDIT, PASS)).toEqual(["draft-issue"]);
  });
  it("no linked proposal + check-first -> Open to review (no pass flag)", () => {
    expect(needsCloserLook(checkFirst, AUDIT, { stale: false, linkedProposal: false })).toEqual(["check-first"]);
  });
});

describe("the Yes card still draws the CHECK FIRST line first", () => {
  it("shows CHECK FIRST and Yes together", () => {
    const h = renderToStaticMarkup(
      <ApprovalCard
        id="q1"
        source="Lectual"
        tag="Needs your yes"
        title="Post-consult"
        recipient="ana@example.com"
        opening="Hi Ana"
        firstStep="the fee quoted"
        checkFirst
        position={1}
        total={1}
        prevHref={null}
        nextHref={null}
        afterHref="/dashboard/queue/deck/"
        internal={false}
        canYes
        closerLook={false}
        handedByName={null}
        handNote={null}
        handedToMe={false}
        canMove
        movesUnavailable={null}
        people={[]}
        review={{ initialBody: "Hi Ana", canApprove: true, canEdit: true }}
      />,
    );
    expect(h).toContain("<strong>CHECK FIRST: </strong>the fee quoted");
    expect(h).toMatch(/>Yes</);
    expect(h).not.toContain("Open to review");
  });
});
