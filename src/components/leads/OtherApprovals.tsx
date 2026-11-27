import type { LeadStepView, QueueRefView } from "@/lib/lead-step/view-model";
import { LEAD_PAGE_ALSO_WAITING, LEAD_PAGE_BRIEFINGS } from "@/lib/ui/words";
import "./lead-step.css";

function List({ label, rows }: { label: string; rows: QueueRefView[] }) {
  return (
    <section className="ls-others" aria-label={label}>
      <h2 className="lx-label">{label}</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <a className="lx-link" href={r.href}>
              {r.headline}
            </a>
            {r.queued && <span className="lx-note"> · {r.queued}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What else is waiting on this lead, under the top card: the other pending drafts, and the internal briefings, each with its
 * own link to the approval. This is what the old "Waiting on attorney review" list showed, so nothing is lost. Drawn only
 * when there is something to list; a failed queue read is the top card's couldn't-load sentence, not an empty list.
 */
export function OtherApprovals({ queue }: { queue: LeadStepView["queue"] }) {
  if (!queue || (queue.others.length === 0 && queue.briefings.length === 0)) return null;
  return (
    <>
      {queue.others.length > 0 && <List label={LEAD_PAGE_ALSO_WAITING} rows={queue.others} />}
      {queue.briefings.length > 0 && <List label={LEAD_PAGE_BRIEFINGS} rows={queue.briefings} />}
    </>
  );
}
