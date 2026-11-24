import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { linkGateFlags, needsCloserLook } from "@/lib/queue/deck";
import { DeckClean } from "@/components/deck/DeckStates";
import { DECK_CHIP_DONE, DECK_EDITING_DONE, DECK_EDITING_YES, REJECT_NOTE_IS_DONE_MARKER, DONE_NOTE } from "@/lib/ui/words";
import { statusPill } from "@/components/queue/format";
import { qitem } from "./routing-fixtures";

const run = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/queue/review-core", () => ({ runQueueReview: (...a: unknown[]) => run(...a), requireFirmReviewer: vi.fn(), ReviewerRefusal: class extends Error {} }));
vi.mock("@/lib/queue/api", () => ({ resolveQueueItem: vi.fn() }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn() }));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn() }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn() }));
vi.mock("@/lib/queue/card-moves", () => ({ cardIdOf: vi.fn(), cardNoteOf: vi.fn(), sendCardBack: vi.fn() }));

const { reviewQueueAction } = await import("@/app/dashboard/queue/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("CHECK FIRST waiver needs the link ON", () => {
  const checkFirst = qitem({ id: "q1", summary: "CHECK FIRST: the fee quoted" });
  const audit = { signOff: "The Team", teamSignOff: "The Team", memberNames: [] };
  it("sent passes; approved (Saved, no live link), none, and refused do not", () => {
    expect(linkGateFlags({ ok: true, proposal: { status: "sent" } })).toEqual({ failed: false, passedWithProposal: true });
    expect(linkGateFlags({ ok: true, proposal: { status: "approved" } })).toEqual({ failed: false, passedWithProposal: false });
    expect(linkGateFlags({ ok: true, proposal: null })).toEqual({ failed: false, passedWithProposal: false });
    expect(linkGateFlags({ ok: false })).toEqual({ failed: true, passedWithProposal: false });
  });
  it("a saved-but-not-live proposal keeps Open to review", () => {
    const g = linkGateFlags({ ok: true, proposal: { status: "approved" } });
    expect(needsCloserLook(checkFirst, audit, { linkedProposal: g.failed, linkedProposalPassed: g.passedWithProposal })).toEqual(["check-first"]);
    const live = linkGateFlags({ ok: true, proposal: { status: "sent" } });
    expect(needsCloserLook(checkFirst, audit, { linkedProposal: live.failed, linkedProposalPassed: live.passedWithProposal })).toEqual([]);
  });
  it("deck-view uses the helper", () => {
    expect(readFileSync("src/app/dashboard/queue/deck/deck-view.tsx", "utf8")).toContain("gateLinkedProposal(item.id).then(\n          linkGateFlags");
  });
});

describe("the full approval page refuses the Done marker as a reject note", () => {
  it("refuses it (also padded or with a receipt line) without running the review", async () => {
    for (const note of [DONE_NOTE, `  ${DONE_NOTE}  `, `${DONE_NOTE}\nReceipt: sha256 0123456789ab`]) {
      run.mockClear();
      expect(await reviewQueueAction({}, form({ id: "q1", intent: "reject", note }))).toEqual({ error: REJECT_NOTE_IS_DONE_MARKER });
      expect(run).not.toHaveBeenCalled();
    }
  });
  it("an ordinary reject note still goes to the core", async () => {
    run.mockResolvedValue({ kind: "error", error: "x" });
    await reviewQueueAction({}, form({ id: "q1", intent: "reject", note: "wrong fee" }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("DeckClean counts Done", () => {
  it("shows N done beside approved and rejected", () => {
    const html = renderToStaticMarkup(<DeckClean headline="All decided. Next deal at 2:00 PM." approved={3} rejected={1} done={2} waiting={0} />);
    expect(html).toContain("3 approved · 1 rejected · 2 done · 0 waiting");
  });
  it("omits the done count when there is none", () => {
    expect(renderToStaticMarkup(<DeckClean headline="All decided." approved={1} rejected={0} done={0} waiting={0} />)).toContain("1 approved · 0 rejected · 0 waiting");
  });
});

describe("nits", () => {
  it("the Done pill reuses the words export; the Done tooltip has its own sentence", () => {
    expect(statusPill(qitem({ status: "rejected", resolution_note: DONE_NOTE })).label).toBe(DECK_CHIP_DONE);
    expect(DECK_EDITING_DONE).not.toBe(DECK_EDITING_YES);
    expect(readFileSync("src/lib/queue/done.ts", "utf8")).not.toContain("OUTCOME_LABEL");
  });
});
