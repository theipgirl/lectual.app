import Link from "next/link";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import type { LeadMattersRead } from "@/lib/matters/for-lead";

/**
 * The lead page's "Matters" line: a link to every matter opened for this lead.
 * Three states, never two: matters, "No matters yet." (the read worked and found
 * none) and a warning when the read failed.
 */
export function LeadMattersLine({ read }: { read: LeadMattersRead }) {
  return (
    <div className="lx-meta">
      <span>Matters</span>
      {read.status === "ok" ? (
        <span>
          {read.matters.map((m) => (
            <span key={m.id} style={{ display: "block" }}>
              <Link href={`/dashboard/matters/${m.id}/`}>{m.label}</Link>
              <span className="lx-note" style={{ display: "block" }}>
                {m.matterNumber} · {m.stageLabel}
              </span>
            </span>
          ))}
        </span>
      ) : read.status === "none" ? (
        <span>No matters yet.</span>
      ) : (
        <LoadFailedLine role="alert">Matters couldn&apos;t be loaded.</LoadFailedLine>
      )}
    </div>
  );
}
