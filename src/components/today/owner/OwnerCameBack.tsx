import Link from "next/link";
import { Notice } from "@/components/ui/Notice";
import type { CameBackRead } from "@/lib/today/came-back-rules";
import { CAME_BACK_LABEL, CAME_BACK_OPEN, CAME_BACK_UNAVAILABLE, cameBackLine } from "@/lib/ui/words";

/**
 * "Came back" on the owner's Today: Lost, Won or Nurture leads with a new enquiry in Lawmatics. Three states: rows,
 * nothing at all (none came back: no card), or the fixed "Can't show returning clients right now" line.
 */
export function OwnerCameBack({ read }: { read: CameBackRead }) {
  if (read.status === "ok" && read.items.length === 0) return null;
  return (
    <section className="lx-card ot-card" aria-labelledby="ot-came-back-h">
      <div className="ot-card-head">
        <h2 id="ot-came-back-h" className="lx-h3">
          {CAME_BACK_LABEL}
        </h2>
        {read.status === "ok" && <span className="ot-count">{read.items.length}</span>}
      </div>
      {read.status === "unavailable" ? (
        <Notice tone="warn" role="status">
          {CAME_BACK_UNAVAILABLE}
        </Notice>
      ) : (
        read.items.map((c) => (
          <div key={c.id} className="ot-row">
            <div className="ot-row-main">
              <span className="ot-row-title">{cameBackLine(c.name, c.category)}</span>
            </div>
            <Link href={`/dashboard/leads/${c.leadId}/`} className="lx-link">
              {CAME_BACK_OPEN}
            </Link>
          </div>
        ))
      )}
    </section>
  );
}
