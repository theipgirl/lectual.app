import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueueItem } from "@/lib/queue/api";
import { isDoneItem, isDoneNote, outcomeOf } from "@/lib/queue/done";
import { decidedRows, makeListFormat } from "@/lib/queue/deck-lists";
import { outcomeText, statusPill } from "@/components/queue/format";
import { deckDecidedAt, DONE_NOTE, WELCOME_CARD_2_BODY } from "@/lib/ui/words";
import { qitem } from "./routing-fixtures";

vi.mock("@/app/dashboard/queue/deck/actions", () => ({
  approveCardAction: vi.fn(),
  doneCardAction: vi.fn(),
  markReadCardAction: vi.fn(),
  rejectCardAction: vi.fn(),
  handOffCardAction: vi.fn(),
  laterCardAction: vi.fn(),
  returnCardAction: vi.fn(),
  sendDraftNowAction: vi.fn(),
}));
vi.mock("@/app/dashboard/queue/actions", () => ({ reviewQueueAction: vi.fn() }));
const { ApprovalCard } = await import("@/components/deck/ApprovalCard");
const { HoldToast } = await import("@/components/deck/HoldToast");

const NOW = new Date("2026-11-10T14:30:00Z");
const fmt = makeListFormat(NOW, "America/New_York");
const done = (over: Partial<QueueItem> = {}): QueueItem =>
  qitem({ id: "d1", status: "rejected", resolved_by: "rebecca@example.com", resolved_at: "2026-11-10T12:15:00Z", resolution_note: DONE_NOTE, ...over });

describe("the Done marker is read in one place", () => {
  it("only the exact marker is Done (a receipt line is ignored)", () => {
    expect(isDoneNote(DONE_NOTE)).toBe(true);
    expect(isDoneNote(`${DONE_NOTE}\nReceipt: sha256 0123456789ab`)).toBe(true);
    expect(isDoneNote("Done: handled without approving, but wrong")).toBe(false);
    expect(isDoneNote("wrong fee")).toBe(false);
    expect(isDoneNote(null)).toBe(false);
  });
  it("a rejected item with the marker is done; an approved one with it is not", () => {
    expect(outcomeOf(done())).toBe("done");
    expect(outcomeOf(done({ resolution_note: "wrong fee" }))).toBe("rejected");
    expect(outcomeOf(done({ status: "approved" }))).toBe("approved");
    expect(outcomeOf(done({ status: "pending" }))).toBeNull();
    expect(isDoneItem(done({ status: "approved" }))).toBe(false);
  });
});

describe("every surface says Done, never Rejected", () => {
  it("deck Decided rows (list, board and side use the same words)", () => {
    const [row] = decidedRows([done()], "rebecca@example.com", fmt);
    expect(row.pill).toBe("Done");
    expect(row.sub).toMatch(/^Done 7:15 AM/);
    expect(row.sub).not.toMatch(/Reject/);
    expect(row.tone).toBe("ok");
    const [plain] = decidedRows([done({ resolution_note: "wrong fee" })], "rebecca@example.com", fmt);
    expect(plain.pill).toBe("Rejected");
    expect(deckDecidedAt("done", "7:15 AM", false)).toBe("done 7:15 AM");
  });
  it("an internal briefing marked Done keeps its tail", () => {
    const [row] = decidedRows([done({ type: "BRIEFING", agent: "morning-brief" })], "rebecca@example.com", fmt);
    expect(row.sub).toBe("Done 7:15 AM · internal");
  });
  it("the technician Approvals pill and the item page outcome line", () => {
    expect(statusPill(done())).toMatchObject({ label: "Done" });
    expect(statusPill(done({ resolution_note: "x" }))).toMatchObject({ label: "Rejected" });
    expect(statusPill(done({ status: "approved" }))).toMatchObject({ label: "Approved" });
    expect(outcomeText("reject", undefined, true)?.text).toMatch(/^Done\./);
    expect(outcomeText("reject", undefined, true)?.text).not.toMatch(/Rejected/);
    expect(outcomeText("reject", undefined, false)?.text).toMatch(/^Rejected/);
  });
  it("the deck, the Approvals page and the item page all read the outcome through the helper", () => {
    expect(readFileSync("src/app/dashboard/queue/deck/deck-view.tsx", "utf8")).toMatch(/outcomeOf/);
    expect(readFileSync("src/lib/queue/deck-lists.ts", "utf8")).toMatch(/isDoneItem/);
    expect(readFileSync("src/app/dashboard/queue/page.tsx", "utf8")).toMatch(/statusPill\(item\)/);
    expect(readFileSync("src/app/dashboard/queue/[id]/page.tsx", "utf8")).toMatch(/statusPill\(item\)/);
    expect(readFileSync("src/app/dashboard/queue/[id]/page.tsx", "utf8")).toMatch(/isDoneItem\(item\)/);
  });
});

describe("the Done card move", () => {
  const props = {
    id: "q1",
    source: "Lectual",
    tag: "Needs your yes",
    title: "Post-consult",
    recipient: null,
    opening: "Hi",
    firstStep: null,
    checkFirst: false,
    position: 1,
    total: 1,
    prevHref: null,
    nextHref: null,
    afterHref: "/dashboard/queue/deck/",
    internal: false,
    canYes: true,
    closerLook: false,
    handedByName: null,
    handNote: null,
    handedToMe: false,
    canMove: true,
    movesUnavailable: null,
    people: [],
    review: { initialBody: "Hi", canApprove: true, canEdit: true },
  };
  const names = (h: string) => [...h.replace(/<small>[^<]*<\/small>/g, "").matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim()).filter(Boolean);
  it("row is Reject, Done, Later, Edit, Hand off, then Yes", () => {
    expect(names(renderToStaticMarkup(<ApprovalCard {...props} />)).slice(0, 6)).toEqual(["Reject", "Done", "Later", "Edit", "Hand off", "Yes"]);
  });
  it("Done also sits beside Open to review and Mark read, and is absent for someone who cannot decide", () => {
    expect(names(renderToStaticMarkup(<ApprovalCard {...props} closerLook />))).toContain("Done");
    expect(names(renderToStaticMarkup(<ApprovalCard {...props} internal />))).toContain("Done");
    expect(names(renderToStaticMarkup(<ApprovalCard {...props} canYes={false} />))).not.toContain("Done");
  });
  it("the hold says Done, not approving", () => {
    const h = renderToStaticMarkup(<HoldToast seconds={5} onUndo={() => {}} done />);
    expect(h).toContain("Marking done in 5");
    expect(h).not.toMatch(/Approving/);
  });
});

describe("copy", () => {
  it("welcome card 2 names Done", () => {
    expect(WELCOME_CARD_2_BODY).toMatch(/Done marks it handled without approving/);
  });
  it("the action never touches the approve path", () => {
    const src = readFileSync("src/app/dashboard/queue/deck/actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function doneCardAction"), src.indexOf("export async function handOffCardAction"));
    expect(fn).toContain('intent: "reject"');
    expect(fn).toContain("note: DONE_NOTE");
    expect(fn).not.toMatch(/intent: "approve"|approveResult|draftInMyMailbox|makeProposalLive|generateApprovedDocument|sendFromMyOutlook/);
  });
});
