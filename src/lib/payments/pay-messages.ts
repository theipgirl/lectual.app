/**
 * What the client's Pay section does after a pay attempt comes back — pure, so
 * the rule that is expensive to get wrong is tested without a DOM. Ported from
 * lectual's PayPanel.tsx (branch claude/lectual-firm-dashboard-prd-f3loev).
 *
 * Client-safe: imported by a "use client" component, so no server imports.
 */

/** Mirrors `PayRefusal` in src/lib/quotes/public-payment.ts (types only there). */
export type PayRefusalReason =
  | "not_found"
  | "not_accepted"
  | "already_paid"
  | "awaiting_confirmation"
  | "manual"
  | "declined"
  | "not_processed"
  | "rejected"
  | "indeterminate"
  | "charged_unrecorded"
  | "unavailable";

/**
 *   refresh             — the server knows better (already paid / in flight).
 *   close_indeterminate — money MAY have moved. No retry: LawPay has no
 *                         idempotency key, so "try again" could charge twice.
 *   close_no_retry      — nothing moved, and no card the client owns can help.
 *   retry               — nothing moved and another card is a real next move.
 */
export function retryPolicy(reason: PayRefusalReason | undefined): "refresh" | "close_indeterminate" | "close_no_retry" | "retry" {
  switch (reason) {
    case "already_paid":
    case "awaiting_confirmation":
      return "refresh";
    case "indeterminate":
    case "charged_unrecorded":
      return "close_indeterminate";
    case "rejected":
    case "manual":
      return "close_no_retry";
    default:
      return "retry";
  }
}

/** The provider's words, bounded and punctuated so they splice into ours. */
function clientSentence(detail: string): string | null {
  const collapsed = detail.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const clipped = collapsed.length > 160 ? `${collapsed.slice(0, 160).trimEnd().replace(/[.,;:—-]+$/, "")}…` : collapsed;
  return /[.!?…]$/.test(clipped) ? clipped : `${clipped}.`;
}

/**
 * A refusal as a sentence. None of them says which piece of the firm's setup is
 * missing: on an unauthenticated page that would be an oracle.
 */
export function payMessage(reason: PayRefusalReason | undefined, detail: string | undefined, firmName: string): string {
  switch (reason) {
    case "declined": {
      const sentence = detail ? clientSentence(detail) : null;
      return sentence
        ? `That payment didn't go through: ${sentence} Nothing has been charged — you can try another card.`
        : "That payment didn't go through. Nothing has been charged — you can try another card.";
    }
    case "not_processed":
      return `That payment couldn't be processed. Nothing has been charged — check the card details or try another card. If it keeps happening, contact ${firmName}.`;
    case "rejected":
      return `We couldn't take that payment. Nothing has been charged — your signature is recorded, and ${firmName} will be in touch to take payment another way.`;
    case "manual":
      return `We couldn't take a card payment here. Your signature is recorded — ${firmName} will send you a way to pay the amount due today. Nothing has been charged.`;
    case "not_accepted":
    case "not_found":
      return "This proposal isn't ready for payment. Reload the page.";
    default:
      return `We couldn't take that payment just now. Nothing has been charged — try again in a moment, or contact ${firmName}.`;
  }
}
