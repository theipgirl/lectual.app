import Link from "next/link";
import { formatWhen, type ListRead } from "@/lib/meetings/read";
import { PROVIDER_LABEL } from "@/lib/meetings/types";

/**
 * The small "Meetings" card on a lead or matter page. Renders nothing when the
 * read succeeded with no meetings (most records have none), and says so when
 * the read failed rather than implying there are none.
 */
export function LinkedMeetings({ read }: { read: ListRead }) {
  if (read.status === "ok" && read.meetings.length === 0) return null;
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 10 }} aria-labelledby="linked-meetings-title">
      <h2 id="linked-meetings-title" className="lx-h2" style={{ fontSize: 23 }}>
        Meetings
      </h2>
      {read.status === "unavailable" ? (
        <p className="lx-note" style={{ margin: 0 }}>Meetings couldn&apos;t be loaded just now.</p>
      ) : (
        <ul className="lx-list" style={{ margin: 0 }}>
          {read.meetings.map((m) => (
            <li key={m.id}>
              <Link href={`/dashboard/meetings/${m.id}/`}>{m.title}</Link>
              <span className="lx-note">
                {" "}
                · {PROVIDER_LABEL[m.provider]} · {formatWhen(m.started_at)}
                {m.has_transcript ? " · transcript" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
