import Link from "next/link";
import type { TemperatureResult } from "@/lib/intake/temperature";
import "@/app/dashboard/intake/leads.css";

/**
 * "Long-Term Nurture suggested", as text and a link. Nothing here moves a lead:
 * the stage and the lane stay a person's act, and the link only goes to the page
 * where that person does it (the lead page from the board and table, the
 * Sequences card from the lead page itself).
 *
 * Renders nothing unless the temperature carries the suggestion.
 */
export function LtnSuggestion({
  suggestion,
  leadId,
  target = "lead",
}: {
  suggestion: TemperatureResult["suggestion"];
  leadId: string;
  /** `lead` opens the lead page; `sequences` jumps to its Sequences card. */
  target?: "lead" | "sequences";
}) {
  if (suggestion !== "long_term_nurture") return null;
  const href = target === "sequences" ? "#sequences-heading" : `/dashboard/leads/${leadId}/`;
  return (
    <span
      className="ix-ltn"
      title="Unbooked by day 10. Moving the lead is your call; nothing changes by itself."
    >
      Long-Term Nurture suggested{" "}
      <Link href={href} className="ix-ltn-link">
        {target === "sequences" ? "See campaigns" : "Open lead"}
      </Link>
    </span>
  );
}
