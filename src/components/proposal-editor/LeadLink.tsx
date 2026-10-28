import Link from "next/link";
import type { ReactNode } from "react";
import type { LeadLinkState } from "@/lib/proposals/lead-link";

/**
 * The editor header's "Open lead ->" link (Sprint 28 E), plus the matter when one is set. A proposal
 * with no lead says so and offers `linker` (the picker) to link one. Plain text and links only.
 */
export function LeadLink({ lead, matterId, linker }: { lead: LeadLinkState; matterId: string | null; linker?: ReactNode }) {
  return (
    <div className="pe-for" aria-label="Who this proposal is for">
      {lead.state === "linked" && (
        <Link href={`/dashboard/leads/${lead.id}/`} className="pe-for-link" aria-label={`Open lead: ${lead.name}`}>
          Open lead →
        </Link>
      )}
      {lead.state === "unreadable" && (
        <span className="pe-for-warn" role="status">
          Lead couldn&apos;t be loaded.{" "}
          <Link href={`/dashboard/leads/${lead.id}/`}>Open the lead</Link>
        </span>
      )}
      {lead.state === "none" && <span className="pe-for-none">Not linked to a lead</span>}
      {matterId && (
        <Link href={`/dashboard/matters/${matterId}/`} className="pe-for-link">
          Open matter →
        </Link>
      )}
      {lead.state === "none" && linker}
    </div>
  );
}
