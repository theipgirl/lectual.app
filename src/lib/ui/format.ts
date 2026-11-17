// Small pure formatters shared by every list: money, a person's name, "Showing N of M".
import { BLANK, TEAMMATE, showingOf } from "@/lib/ui/words";

export { showingOf };

/** Staff-page money: "$4,950", "$4,950.50" only when cents are not whole dollars, "-$500", a non-number reads as the blank. */
export function formatMoney(cents: number): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return BLANK;
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const whole = dollars.toLocaleString("en-US");
  const body = rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
  return negative && abs !== 0 ? `-${body}` : body;
}

/** A person's name from the directory. No id gives null (the caller shows UNASSIGNED); an id the directory doesn't know is "Teammate". */
export function personName(id: string | null | undefined, names: ReadonlyMap<string, string>): string | null {
  if (!id) return null;
  const name = names.get(id)?.trim();
  return name ? name : TEAMMATE;
}
