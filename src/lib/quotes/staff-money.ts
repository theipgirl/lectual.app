import { formatMoney } from "@/lib/ui/format";
import { formatCents } from "./money";

/**
 * Money on a STAFF page: "$4,950" (the one staff formatter) for a US dollar quote, and the full currency format for any other
 * currency (the staff formatter is dollars only). The public quote page keeps `formatCents`.
 */
export function moneyFor(cents: number, currency: string | null | undefined): string {
  return !currency || currency === "USD" ? formatMoney(cents) : formatCents(cents, currency);
}
