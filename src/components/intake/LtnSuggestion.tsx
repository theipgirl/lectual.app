import Link from "next/link";
import type { TemperatureResult } from "@/lib/intake/temperature";

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
      style={{
        display: "inline-block",
        minWidth: 0,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        verticalAlign: "bottom",
        fontSize: 11,
        lineHeight: 1.3,
        color: "var(--mute)",
        whiteSpace: "nowrap",
      }}
      title="Unbooked by day 10. Moving the lead is your call; nothing changes by itself."
    >
      Long-Term Nurture suggested{" "}
      <Link href={href} style={{ color: "var(--ox)", textDecoration: "underline" }}>
        {target === "sequences" ? "See sequences" : "Open lead"}
      </Link>
    </span>
  );
}
