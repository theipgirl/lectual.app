import Link from "next/link";
import { getFirmTimeZone } from "@/lib/org/profile";
import { canExportCsv } from "@/lib/intake-forms/export-csv";
import {
  EVENT_PEOPLE_CARD_LIMIT,
  bandText,
  buildEventPeople,
  canSeeEventPeople,
  peopleCountLine,
  takenAtText,
  temperatureText,
} from "@/lib/intake-forms/event-people";
import { loadEventPeople } from "@/lib/intake-forms/load-results";
import type { EventRange } from "@/lib/intake-forms/booth-results";
import "./event.css";

/**
 * The event page's "People": one card per scorecard, newest first. Read-only.
 * Shown to every staff role; a viewer, social media or an unreadable role gets
 * nothing here and no lead is read for them. Temperature is staff-only and says
 * so. A failed read is "couldn't be loaded", never "nobody yet".
 */

export async function EventPeople({ code, range, role, now }: { code: string; range: EventRange; role: unknown; now: Date }) {
  if (!canSeeEventPeople(role)) return null;
  const timeZone = await getFirmTimeZone();
  const since = range === "all" ? undefined : new Date(now.getTime() - range * 86_400_000).toISOString();
  const read = await loadEventPeople(code, { contact: false, max: 5000, show: EVENT_PEOPLE_CARD_LIMIT, since });
  const exportHref = `/dashboard/forms/event-export/?event=${encodeURIComponent(code)}`;

  const head = (
    <div className="ev-people-head">
      <h2 className="ifm-title">People</h2>
      {canExportCsv(role) && (
        <a className="lx-btn lx-btn-sm lx-btn-ghost" href={exportHref}>
          {range === "all" ? "Download CSV" : "Download CSV (all time)"}
        </a>
      )}
    </div>
  );

  if (read.status !== "ok") {
    return (
      <section aria-label="People who took this assessment">
        {head}
        <div role="status" className="lx-banner lx-banner-warn">
          {read.status === "unconfigured" ? "People aren't switched on for your firm yet. Lectual will turn them on." : "People couldn't be loaded. Refresh to try again."}
        </div>
      </section>
    );
  }

  const people = buildEventPeople(read.value.cards, read.value.leads);
  const total = read.value.total;
  const over = read.value.over;
  return (
    <section aria-label="People who took this assessment">
      {head}
      {people.length === 0 ? (
        <p className="ifm-help">No one in this range.</p>
      ) : (
        <>
          <ul className="ev-people">
            {people.map((p) => (
              <li key={p.id} className="ifm-card ev-person">
                <div className="ev-cell ev-who">
                  <span className="ev-label">Name</span>
                  <span className="ev-value ev-name">{p.leadFound ? p.name || "No name" : "Lead not available"}</span>
                  {p.business && <span className="ev-sub">{p.business}</span>}
                </div>
                <div className="ev-cell">
                  <span className="ev-label">Taken</span>
                  <span className="ev-value">{takenAtText(p.takenAt, timeZone)}</span>
                </div>
                <div className="ev-cell">
                  <span className="ev-label">Score</span>
                  <span className="ev-value">{p.score === null ? "—" : `${p.score} · ${bandText(p.band)}`}</span>
                </div>
                <div className="ev-cell">
                  <span className="ev-label">Temperature (staff only)</span>
                  <span className={`ev-value ev-temp ev-temp-${p.temperature ?? "none"}`}>{temperatureText(p.temperature)}</span>
                </div>
                <div className="ev-cell">
                  <span className="ev-label">Card</span>
                  <span className="ev-value">{p.finished ? "Finished" : "Didn’t finish"}</span>
                </div>
                <div className="ev-cell ev-link">
                  {p.leadFound ? (
                    <Link className="lx-btn lx-btn-sm lx-btn-ghost" href={`/dashboard/leads/${p.leadId}/`}>
                      Open lead
                    </Link>
                  ) : (
                    <span className="ev-sub">No lead to open</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="ifm-help">{peopleCountLine(people.length, total, over)}</p>
        </>
      )}
    </section>
  );
}
