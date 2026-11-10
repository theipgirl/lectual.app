import Link from "next/link";
import type { WeekDay } from "@/lib/today/owner-rules";

/** Seven days of the week. A count that couldn't be read is a dash, never a zero. */
export function WeekStrip({ days }: { days: readonly WeekDay[] }) {
  return (
    <div className="ot-week">
      {days.map((d) => {
        const known = d.consults !== null || d.deadlines !== null;
        const total = (d.consults ?? 0) + (d.deadlines ?? 0);
        const label = !known ? `${d.label}: not loaded` : `${d.label}: ${d.consults ?? 0} consults, ${d.deadlines ?? 0} deadlines`;
        return (
          <Link key={d.date} href="/dashboard/calendar/" prefetch={false} className="ot-day" aria-label={label} aria-current={d.isToday ? "date" : undefined}>
            <span>{d.label}</span>
            <span className="ot-dots" aria-hidden="true">
              {!known ? "—" : total === 0 ? "·" : (
                <>
                  {d.consults ? <span>{"●".repeat(Math.min(d.consults, 3))}</span> : null}
                  {d.deadlines ? <span>{"◆".repeat(Math.min(d.deadlines, 3))}</span> : null}
                </>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
