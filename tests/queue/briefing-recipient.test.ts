import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cardRecipient, shownRecipient } from "@/lib/queue/shown-recipient";
import { isClientFacing } from "@/lib/queue/stale";
import { INTERNAL_BRIEFING_TO } from "@/lib/ui/words";

/**
 * The prep-consult skill now puts the client's address on its BRIEFINGs, only so they link to the lead. Approvals must never
 * show "To <client>" on an internal briefing (nobody may think a client email is waiting), and a briefing is never client-facing.
 */
const briefing = { type: "BRIEFING" as const, recipient: "dana.ruiz@example.com" };
const email = { type: "CLIENT_EMAIL" as const, recipient: "dana.ruiz@example.com" };

describe("Approvals never shows a client address on an internal briefing", () => {
  it("the item page's To reads the internal label, never the address", () => {
    expect(shownRecipient(briefing)).toBe(INTERNAL_BRIEFING_TO);
    expect(shownRecipient({ type: "BRIEFING", recipient: null })).toBe(INTERNAL_BRIEFING_TO);
    expect(INTERNAL_BRIEFING_TO).not.toMatch(/@/);
  });
  it("the deck card shows no To line for a briefing", () => {
    expect(cardRecipient(briefing)).toBeNull();
  });
  it("a client email still shows its recipient, and none is none", () => {
    expect(shownRecipient(email)).toBe("dana.ruiz@example.com");
    expect(cardRecipient(email)).toBe("dana.ruiz@example.com");
    expect(shownRecipient({ type: "CLIENT_EMAIL", recipient: "  " })).toBeNull();
  });
  it("a briefing with an address is not client-facing (no stale-check confirm, not listed as a client draft)", () => {
    expect(isClientFacing(briefing)).toBe(false);
    expect(isClientFacing(email)).toBe(true);
    expect(isClientFacing({ type: "OTHER" as never, recipient: "x@y.com" })).toBe(true);
  });
  it("the item page and the deck read the recipient only through these helpers", () => {
    const page = readFileSync("src/app/dashboard/queue/[id]/page.tsx", "utf8");
    const deck = readFileSync("src/app/dashboard/queue/deck/deck-view.tsx", "utf8");
    expect(page).toContain('<Meta label="To" value={shownRecipient(item)} />');
    expect(page).not.toMatch(/value=\{item\.recipient\}/);
    expect(deck).toContain("recipient={cardRecipient(card.item)}");
    expect(deck).not.toMatch(/recipient=\{card\.item\.recipient\}/);
  });
});

