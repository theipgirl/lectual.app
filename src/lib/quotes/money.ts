/**
 * Money ↔ text for the quote surfaces — the builder, the list, the service
 * library and the client's `/q/[token]` page.
 *
 * Pure, and deliberately NOT in pricing.ts: that module is integer arithmetic
 * and its header says why it ships no formatter ("a pure module that formats
 * invites a caller to round-trip money through a string and back"). In
 * `lectual` each rendering slice carried its own copy of these two functions;
 * the port keeps one, because two copies of a money parser is how one of them
 * ends up rounding differently.
 */

/**
 * Integer cents as currency — "$4,750.00".
 *
 * `Math.round` before dividing, so a value that arrived as anything other than
 * whole cents cannot produce a third decimal place. A negative amount (a
 * discount) formats with its sign — "-$500.00" — rather than accounting
 * parentheses half the readers of a client-facing proposal have never seen.
 * A non-finite value renders as an em dash, never "$NaN".
 */
export function formatCents(cents: number, currency = "USD"): string {
  if (!Number.isFinite(cents)) return "—";
  const safe = Math.round(cents);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe / 100);
  } catch {
    // An unrecognised currency code throws in Intl. The number is still the
    // truth; showing it without a symbol beats showing nothing.
    return `${(safe / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * A user-typed dollar amount ("1,250", "1250.5", "$0.00") → whole cents, or
 * null when it isn't one.
 *
 * String arithmetic only — no `parseFloat(x) * 100`, the float trap where
 * `1.005 * 100` is `100.49999999999999`. Splitting on the decimal point and
 * padding the fraction to two digits keeps every step an integer operation.
 * More than two decimal places is refused rather than rounded: a fee someone
 * typed as $10.005 is a typo to show them, not a rounding to decide for them.
 */
export function parseDollarsToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "").replace(/^\$/, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const [, sign, whole, frac = ""] = match;
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return sign === "-" ? -cents : cents;
}

/** Cents → the plain "1250.00" a form field is pre-filled with. Magnitude
 * only: a discount is stored negative and typed positive (the action applies
 * the sign from the kind), so the field never asks anyone to type a minus. */
export function centsToInput(cents: number): string {
  if (!Number.isFinite(cents)) return "";
  const abs = Math.abs(Math.round(cents));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
