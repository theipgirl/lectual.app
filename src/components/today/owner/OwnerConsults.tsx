import Link from "next/link";
import { formatEventWhen } from "@/lib/calendar/outlook-format";
import { sourceNote, type TodayConsultsResult } from "@/lib/calendar/consult-sources";
import { civilInZone } from "@/lib/today/outcomes";
import { OWNER_CONSULTS_SHOWN } from "@/lib/today/owner-rules";
import { ownerSeeAll, OWNER_CONSULTS_HEADING, OWNER_CONSULTS_NONE_TODAY, ownerConsultJoinLink, OWNER_CONSULT_LEAD_LINK } from "@/lib/ui/words";

const SOURCE_LABEL = { outlook: "Outlook", zoom: "Zoom" } as const;

/** "10:00 AM" out of the shared "Tue, Nov 10, 10:00 AM" stamp. */
function clockOf(stamp: string): string {
  const parts = stamp.split(", ");
  return parts.length > 1 ? parts[parts.length - 1] : stamp;
}

/**
 * Today's consults on the owner's Today. Same sources and same named states as the technician card (`sourceNote`):
 * "No consults today." only when every source was read; a source that wasn't connected or failed is named with its next step.
 */
export function OwnerConsults({ result, timeZone, today }: { result: TodayConsultsResult; timeZone: string; today: string }) {
  const sources = [
    { source: "outlook" as const, state: result.outlook },
    { source: "zoom" as const, state: result.zoom },
  ];
  const notes = sources.map((s) => sourceNote(s.source, s.state)).filter((n): n is NonNullable<typeof n> => n !== null);
  const readOk = sources.filter((s) => s.state === "ok").map((s) => SOURCE_LABEL[s.source]);
  const todays = result.consults.filter((c) => civilInZone(new Date(c.startsAt), timeZone) === today);

  return (
    <section className="ot-card ot-consults" aria-labelledby="ot-consults-h">
      <div className="ot-card-head">
        <h2 id="ot-consults-h" className="ot-card-title">
          {OWNER_CONSULTS_HEADING}
        </h2>
        {notes.length === 0 && <span className="ot-sub">{todays.length}</span>}
      </div>
      {todays.slice(0, OWNER_CONSULTS_SHOWN).map((c) => {
        const when = c.allDay ? "All day" : clockOf(formatEventWhen({ starts_at: c.startsAt, all_day: false }, timeZone));
        return (
          <div key={c.key} className="ot-row">
            <div className="ot-row-main">
              <span className="ot-row-title">{c.title}</span>
              <span className="ot-sub ot-line">
                {when} &middot; {SOURCE_LABEL[c.source]}
                {c.joinUrl && /^https:\/\//i.test(c.joinUrl) ? (
                  <>
                    {" "}&middot;{" "}
                    <a href={c.joinUrl} target="_blank" rel="noopener noreferrer" className="ot-link">
                      {ownerConsultJoinLink(c.joinUrl)}
                    </a>
                  </>
                ) : null}
              </span>
            </div>
            {c.leadId ? (
              <Link href={`/dashboard/leads/${c.leadId}/`} className="ot-link">
                {OWNER_CONSULT_LEAD_LINK}
              </Link>
            ) : null}
          </div>
        );
      })}
      {todays.length > OWNER_CONSULTS_SHOWN && (
        <Link href="/dashboard/calendar/" className="ot-link ot-more">
          {ownerSeeAll(todays.length)}
        </Link>
      )}
      {todays.length === 0 && notes.length === 0 && <p className="ot-sub ot-empty">{OWNER_CONSULTS_NONE_TODAY}</p>}
      {todays.length === 0 && notes.length > 0 && readOk.length > 0 && <p className="ot-sub ot-empty">No consults today in {readOk.join(" and ")}.</p>}
      {notes.map((n) => (
        <p key={n.source} className="ot-sub ot-note" role="status">
          {n.text}
          {n.link && (
            <>
              {" "}
              <Link href={n.link.href} className="ot-link">
                {n.link.label}
              </Link>
            </>
          )}
        </p>
      ))}
    </section>
  );
}
