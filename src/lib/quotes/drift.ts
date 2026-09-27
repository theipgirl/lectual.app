import { formatCents } from "./money";
// Type-only: erased at compile time, so this pure module does not pull the
// server-only public read path in with it.
import type { QuoteAcceptedSnapshotLine } from "./public";
import type { QuoteLineRow } from "./types";

/**
 * What an accepted quote's LIVE rows say that its signed record does not.
 *
 * `crm_quote_line` stays mutable after acceptance; `accepted_snapshot` is the
 * frozen record of what the client signed (§5). The builder renders the
 * snapshot, and uses this to SURFACE — never hide — any edit made after the
 * signature, because a divergence means somebody changed the agreement after
 * it was signed.
 *
 * Plain sentences rather than a boolean: "these differ" tells staff to go
 * looking, "was signed at $1,250.00 and is now $1,600.00" tells them what
 * happened. Wire-loose numbers (PostgREST can hand an int8 back as a quoted
 * numeral) are normalised on BOTH sides first, so a string/number mismatch
 * never reports a change nobody made.
 *
 * Pure. In `lectual` this lived in the LinesEditor component; it moved here so
 * it can be tested without rendering.
 */
export function describeLineDrift(
  signedLines: readonly QuoteAcceptedSnapshotLine[],
  liveLines: readonly QuoteLineRow[],
): string[] {
  const live = new Map(liveLines.map((line) => [line.id, line]));
  const out: string[] = [];

  for (const signedLine of signedLines) {
    const current = live.get(signedLine.id);
    if (!current) {
      out.push(`“${signedLine.label}” has been deleted from the quote since it was signed.`);
      continue;
    }
    if (current.label !== signedLine.label) {
      out.push(`“${signedLine.label}” is now labelled “${current.label}”.`);
    }
    const signedUnit = toAmount(signedLine.unit_amount_cents);
    const liveUnit = toAmount(current.unit_amount_cents);
    if (signedUnit !== liveUnit) {
      out.push(`“${signedLine.label}” was signed at ${formatCents(signedUnit)} and is now ${formatCents(liveUnit)}.`);
    }
    const signedQty = toCount(signedLine.quantity);
    const liveQty = toCount(current.quantity);
    if (signedQty !== liveQty) {
      out.push(`“${signedLine.label}” was signed at quantity ${signedQty} and is now ${liveQty}.`);
    }
    if (current.charge_at !== signedLine.charge_at) {
      out.push(
        `“${signedLine.label}” was signed as charged ${chargeWords(signedLine.charge_at)} and is now charged ${chargeWords(current.charge_at)}.`,
      );
    }
    if (Boolean(current.selected) !== Boolean(signedLine.selected)) {
      out.push(
        signedLine.selected
          ? `“${signedLine.label}” was included in the signed agreement and is now marked declined.`
          : `“${signedLine.label}” was declined in the signed agreement and is now marked included.`,
      );
    }
  }

  const signedIds = new Set(signedLines.map((line) => line.id));
  for (const line of liveLines) {
    if (!signedIds.has(line.id)) {
      out.push(`“${line.label}” was added to the quote after it was signed.`);
    }
  }

  return out;
}

function chargeWords(chargeAt: string): string {
  if (chargeAt === "signing") return "at signing";
  if (chargeAt === "filing") return "at filing";
  if (chargeAt === "not_charged") return "not at all";
  return chargeAt;
}

/** Wire-loose cents → a definite number. Unreadable is 0, not NaN, so a
 * malformed stored figure renders as an obviously wrong amount instead of the
 * string "NaN" on a fee agreement. */
export function toAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Same, for quantities — floored at 1 so a missing count never reads "× 0". */
export function toCount(value: unknown): number {
  const n = toAmount(value);
  return n > 0 ? n : 1;
}
