import Link from "next/link";
import { formatWhen, type ListRead } from "@/lib/meetings/read";
import { PROVIDER_LABEL } from "@/lib/meetings/types";
import { getFirmTimeZone } from "@/lib/org/profile";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import "./meetings.css";

/**
 * The small "Meetings" card on a lead or matter page. Renders nothing when the
 * read succeeded with no meetings (most records have none), and says so when
 * the read failed rather than implying there are none.
 */
export async function LinkedMeetings({ read }: { read: ListRead }) {
  if (read.status === "ok" && read.meetings.length === 0) return null;
  const tz = await getFirmTimeZone();
  return (
    <section className="lx-card lx-pad lx-meet-card" aria-labelledby="linked-meetings-title">
      <h2 id="linked-meetings-title" className="lx-h3">
        Meetings
      </h2>
      {read.status === "unavailable" ? (
        <LoadFailedLine>Can&apos;t show meetings right now. Refresh to try again.</LoadFailedLine>
      ) : (
        <ul className="lx-list">
          {read.meetings.map((m) => (
            <li key={m.id}>
              <Link href={`/dashboard/meetings/${m.id}/`}>{m.title}</Link>
              <span className="lx-note">
                {" "}
                · {PROVIDER_LABEL[m.provider]} · {formatWhen(m.started_at, tz)}
                {m.has_transcript ? " · transcript" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
