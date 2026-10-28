import type { ReactNode } from "react";
import { lastHeardLabel } from "@/lib/leads/status-row";
import { NOT_RATED, TEMPERATURE_NAME } from "@/lib/ui/words";

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
}: {
  stageName: string | null;
  /** "Hot" / "Warm" / "Cold", or null for a lead nobody has rated. */
  temperatureLabel: string | null;
  ownerName: string | null;
  lastInboundAt: string | null;
  now: number;
}): ReactNode {
  return (
    <ul className="lx-status-row" aria-label="Lead status">
      <li>
        <span className="lx-pill lx-pill-ox">{stageName ?? "No stage"}</span>
      </li>
      <li className="lx-note">
        {TEMPERATURE_NAME}: <b>{temperatureLabel ?? NOT_RATED}</b>
      </li>
      {ownerName && (
        <li className="lx-note">
          Owner: <b>{ownerName}</b>
        </li>
      )}
      <li className="lx-note">{lastHeardLabel(lastInboundAt, now)}</li>
    </ul>
  );
}
