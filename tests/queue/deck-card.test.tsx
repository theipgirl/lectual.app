import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApprovalCardProps } from "@/components/deck/ApprovalCard";

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
const { DeckFrame } = await import("@/components/deck/DeckFrame");

const base: ApprovalCardProps = {
  id: "q1",
  source: "Lectual · Post-consult",
  tag: "Needs your yes · 2 min",
  title: "Post-consult follow-up — Ana",
  recipient: "ana@example.com",
  opening: "Hi Ana, thanks for the call.",
  firstStep: "Check the class list",
  checkFirst: false,
  position: 2,
  total: 6,
  prevHref: "/dashboard/queue/deck/?at=q0",
  nextHref: "/dashboard/queue/deck/?at=q2",
  afterHref: "/dashboard/queue/deck/?at=q2",
  internal: false,
  canYes: true,
  closerLook: false,
  handedByName: null,
  handNote: null,
  handedToMe: false,
  canMove: true,
  movesUnavailable: null,
  people: [{ userId: "u2", name: "Caitlyn" }],
  review: { initialBody: "Hi Ana", canApprove: true, canEdit: true },
};
const html = (over: Partial<ApprovalCardProps> = {}) => renderToStaticMarkup(<ApprovalCard {...base} {...over} />);
// A move is its name plus a small sub-line; the name is what is pinned.
const buttons = (h: string) => [...h.replace(/<small>[^<]*<\/small>/g, "").matchAll(/<(?:button|a)[^>]*>([^<]*)<\/(?:button|a)>/g)].map((m) => m[1].trim()).filter(Boolean).filter((t) => !/^[‹›]$/.test(t));

describe("ApprovalCard", () => {
  it("draws the anatomy and the main row Reject · Later · Edit · Hand off · Yes", () => {
    const h = html();
    for (const t of ["Lectual · Post-consult", "Needs your yes · 2 min", "To ana@example.com.", "Hi Ana, thanks for the call.", "Check the class list", "2 / 6"]) expect(h).toContain(t);
    expect(buttons(h).slice(0, 5)).toEqual(["Reject", "Later", "Edit", "Hand off", "Yes"]);
    // Back and Skip are small arrows with the keys' hooks, not main buttons.
    expect(h).toMatch(/data-deck-prev/);
    expect(h).toMatch(/data-deck-next/);
    expect(buttons(h)).not.toContain("Skip");
  });

  it("a card that needs a closer look shows Open to review instead of Yes", () => {
    const h = html({ closerLook: true });
    expect(buttons(h)).toContain("Open to review");
    expect(buttons(h)).not.toContain("Yes");
    expect(h).toContain('href="/dashboard/queue/q1/"');
  });

  it("an internal briefing shows Mark read", () => {
    const h = html({ internal: true, tag: "Internal" });
    expect(buttons(h)).toContain("Mark read");
    expect(buttons(h)).not.toContain("Yes");
  });

  it("a card handed to someone who can't approve has no Yes, only Edit and Send back", () => {
    const h = html({ canYes: false, handedToMe: true, handedByName: "Rebecca", handNote: "fix the tone", review: { ...base.review, canApprove: false } });
    expect(buttons(h)).not.toContain("Yes");
    expect(buttons(h)).not.toContain("Reject");
    expect(buttons(h)).toEqual(expect.arrayContaining(["Edit", "Send back"]));
    expect(h).toContain("Handed to you by Rebecca: fix the tone");
  });

  it("Hand off and Later are drawn disabled with the sentence until the table is there", () => {
    const h = html({ movesUnavailable: "This isn't switched on for your firm yet. Lectual will turn it on." });
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="[^"]+"[^>]*>Later<small>/);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="[^"]+"[^>]*>Hand off<small>/);
    expect(h).toContain("This isn&#x27;t switched on for your firm yet. Lectual will turn it on.");
  });

  it("says nothing about Lectual sending", () => {
    expect(html()).not.toMatch(/Lectual (will )?send|sends? automatically/i);
  });
});

describe("DeckFrame", () => {
  const frame = (over: Partial<Parameters<typeof DeckFrame>[0]> = {}) =>
    renderToStaticMarkup(
      <DeckFrame
        dealLine="Today's deal · 7:00 AM"
        view="cards"
        viewHref={(v) => `/d/?view=${v}`}
        side={[
          { id: "a", title: "First", href: "/d/?at=a", current: true, decided: false },
          { id: "b", title: "Done one", href: "/x", current: false, decided: true },
        ]}
        laterArrivals={3}
        nextDealLabel="2:00 PM"
        dealNowHref="/d/?deal=now"
        {...over}
      >
        <p>card</p>
      </DeckFrame>,
    );

  it("header, title, switch, every approval listed with current and decided marked, later arrivals", () => {
    const h = frame();
    expect(h).toContain("Today&#x27;s deal · 7:00 AM");
    expect(h).toContain("Needs you");
    expect(h).toContain("Your deal");
    for (const t of [">Cards<", ">List<", ">Board<"]) expect(h).toContain(t);
    expect(h).toMatch(/aria-current="true"[\s\S]*?First</);
    expect(h).toMatch(/Decided[\s\S]*Done one/);
    expect(h).toContain("3 more at 2:00 PM");
    expect(h).toContain(">Deal them now<");
    expect(h).not.toMatch(/See all/i);
  });

  it("no later arrivals, no footer", () => {
    expect(frame({ laterArrivals: 0 })).not.toContain("Deal them now");
  });
});

describe("the after-approve line claims a mailbox only when the approve result returned a draft", () => {
  const ok = (draft: unknown, message = "Approved.") => html({ initial: { result: { ok: true, message, draft } as never } });
  it("no draft: no Outlook or Gmail claim", () => {
    expect(ok(null, "Approved. Nothing was sent.")).not.toMatch(/Draft is in (Outlook|Gmail)/);
  });
  it("a draft with no provider says no draft was made", () => {
    const h = ok({ provider: null, webLink: null, draftId: null, canSend: false, sendNote: null });
    expect(h).not.toMatch(/Draft is in (Outlook|Gmail)/);
    expect(h).toContain("No draft was made");
  });
  it("a Microsoft draft says Outlook, a Google draft says Gmail", () => {
    expect(ok({ provider: "microsoft", webLink: null, draftId: null, canSend: false, sendNote: null })).toContain("Draft is in Outlook");
    expect(ok({ provider: "google", webLink: null, draftId: null, canSend: false, sendNote: null })).toContain("Draft is in Gmail");
  });
});
