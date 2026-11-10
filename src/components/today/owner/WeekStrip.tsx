import Link from "next/link";
import type { WeekDay } from "@/lib/today/owner-rules";
import { OWNER_WEEK_NOT_LOADED } from "@/lib/ui/words";

const DOT_CAP = 3;

/**
 * Seven day boxes (desktop: the day's consults and deadlines as small tinted items; phone: a dot strip). A day whose
 * sources could not be read says "Not loaded", never an empty day. Each box links to the calendar.
 */
export function WeekStrip({ days }: { days: readonly WeekDay[] }) {
  return (
    <div className="ot-week">
      {days.map((d) => {
        const known = d.consults !== null || d.deadlines !== null;
        const label = !known ? `${d.label}: not loaded` : `${d.label}: ${d.consults ?? 0} consults, ${d.deadlines ?? 0} deadlines`;
        return (
          <Link key={d.date} href="/dashboard/calendar/" prefetch={false} className="ot-day" aria-label={label} aria-current={d.isToday ? "date" : undefined}>
            <span className="ot-day-date">
              <span className="ot-mono">{d.weekday}</span> {d.num}
            </span>
            <span className="ot-day-items" aria-hidden="true">
              {!known ? (
                <span className="ot-sub">{OWNER_WEEK_NOT_LOADED}</span>
              ) : d.items.length === 0 ? (
                <span className="ot-sub">&mdash;</span>
              ) : (
                d.items.map((it, i) => (
                  <span key={i} className={it.kind === "consult" ? "ot-item ot-item-consult" : "ot-item ot-item-deadline"}>
                    <b>{it.lead}</b>
                    {it.text}
                  </span>
                ))
              )}
            </span>
            <span className="ot-day-dots" aria-hidden="true">
              {d.consults ? <span className="ot-dot ot-dot-consult" /> : null}
              {d.consults && d.consults > 1 ? <span className="ot-dot ot-dot-consult" /> : null}
              {Array.from({ length: Math.min(DOT_CAP, d.items.filter((it) => it.kind === "deadline").length) }, (_, i) => (
                <span key={i} className="ot-dot ot-dot-deadline" />
              ))}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
