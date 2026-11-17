import type { ReactNode } from "react";
import { lastHeardLabel } from "@/lib/leads/status-row";
import { NOT_RATED, TEMPERATURE_NAME } from "@/lib/ui/words";
import { Pill } from "@/components/ui/Pill";
import { MEANING_TONE } from "@/lib/ui/tones";

/**
 * The one line under the lead's name: Stage pill, Temperature, Owner (when known) and how long
 * since the lead was last heard from. Display only; the Stage and Owner selects stay in the head.
 */
export function LeadStatusRow({
  stageName,
  temperatureLabel,
  ownerName,
  lastInboundAt,
  now,
  hideLastHeard = false,
}: {
  stageName: string | null;
  /** "Hot" / "Warm" / "Cold", or null for a lead nobody has rated. */
  temperatureLabel: string | null;
  ownerName: string | null;
  lastInboundAt: string | null;
  now: number;
  /** The four facts under it already say Last contact (with who wrote last), so the page hides this line. */
  hideLastHeard?: boolean;
}): ReactNode {
  return (
    <ul className="lx-status-row" aria-label="Lead status">
      <li>
        <Pill tone={MEANING_TONE.neutral}>{stageName ?? "No stage"}</Pill>
      </li>
      <li className="lx-note">
        {TEMPERATURE_NAME}: <b>{temperatureLabel ?? NOT_RATED}</b>
      </li>
      {ownerName && (
        <li className="lx-note">
          Owner: <b>{ownerName}</b>
        </li>
      )}
      {!hideLastHeard && <li className="lx-note">{lastHeardLabel(lastInboundAt, now)}</li>}
    </ul>
  );
}
