import { relativeTime } from "@/lib/relative-time";
import { describeActivity } from "@/components/leads/describe";

type Row = { id: string; type: string; actor_type: string | null; created_at: string; payload: unknown };

/**
 * A record's activity timeline (lead or matter). Voice notes play from a
 * short-lived signed URL the page minted through the caller's own scoped
 * client (voiceNotePlaybackUrls); a note whose URL couldn't be minted still
 * shows its transcript.
 */
export function Timeline({ rows, mediaUrls = {} }: { rows: readonly Row[]; mediaUrls?: Record<string, string> }) {
  if (rows.length === 0) return <p className="lx-note">Nothing yet.</p>;
  return (
    <ol className="lx-timeline">
      {rows.slice(0, 100).map((r) => {
        const d = describeActivity(r);
        const audio = mediaUrls[r.id];
        return (
          <li key={r.id} data-tone={d.tone}>
            <div className="lx-timeline-head">
              <span>{d.title}</span>
              <span className="lx-note">{relativeTime(r.created_at)}</span>
            </div>
            {audio && <audio controls preload="none" src={audio} aria-label="Voice note" style={{ width: "100%", height: 34, marginTop: 6 }} />}
            {d.detail && <p>{d.detail}</p>}
            {d.link && (
              <a href={d.link} target="_blank" rel="noreferrer noopener" className="lx-note">
                Open in mail
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
