import Link from "next/link";
import { INTEGRATIONS_PATH } from "@/lib/setup/routes";
import type { SetupChecklist, SetupItem, SetupItemStatus } from "@/lib/setup/types";
import { LECTUAL_SETS_UP } from "@/lib/ui/words";
import "./setup.css";

/** Every status has its own words, so colour is never the only signal. */
export const STATUS_PILL: Record<SetupItemStatus, { label: string; tone: string }> = {
  done: { label: "Done", tone: "lx-pill-ok" },
  "to-do": { label: "To do", tone: "lx-pill-mute" },
  "couldnt-check": { label: "Couldn't check", tone: "lx-pill-warn" },
};

/** The pill an item wears: Lectual's own words for a step the firm cannot finish, else its status. */
export function pillFor(item: SetupItem): { label: string; tone: string } {
  return item.owner === "lectual" && item.status === "to-do" ? { label: LECTUAL_SETS_UP, tone: "lx-pill-mute" } : STATUS_PILL[item.status];
}

/** The button label by status; none for a step that is Lectual's to do. */
export function actionLabelFor(item: SetupItem): string | null {
  if (item.owner === "lectual" && item.status === "to-do") return null;
  return item.status === "done" ? "Review" : item.status === "couldnt-check" ? "Check again" : "Set up";
}

/** The checklist as the setup page draws it. Presentational: it only reads what it is given. */
export function SetupChecklistView({ checklist }: { checklist: SetupChecklist }) {
  const { items, doneCount, total, complete } = checklist;
  const waitingOnLectual = items.filter((i) => i.owner === "lectual" && i.status === "to-do").length;
  return (
    <div className="su-wrap">
      <section className="lx-card su-summary" aria-labelledby="setup-count">
        <h2 id="setup-count" className="su-count">
          {`${doneCount} of ${total} done`}
        </h2>
        <div
          className="su-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={doneCount}
          aria-labelledby="setup-count"
        >
          <span style={{ width: `${total === 0 ? 100 : Math.round((doneCount / total) * 100)}%` }} />
        </div>
        {complete ? (
          <p className="lx-sub" style={{ margin: 0 }}>
            All set. Next: try the{" "}
            <Link href="/dashboard/getting-started/">Getting started guides</Link>.
          </p>
        ) : (
          <p className="lx-sub" style={{ margin: 0 }}>
            Work down the list. Each button opens the page where that step is done.
          </p>
        )}
        {waitingOnLectual > 0 && (
          <p className="lx-note" style={{ margin: 0 }}>
            {waitingOnLectual === 1 ? "One step is" : `${waitingOnLectual} steps are`} Lectual&apos;s to switch on, so{" "}
            {waitingOnLectual === 1 ? "it isn't" : "they aren't"} counted against you.
          </p>
        )}
      </section>

      <section className="lx-card" aria-label="Setup checklist">
        <ol className="su-list">
          {items.map((item, i) => {
            const pill = pillFor(item);
            const action = actionLabelFor(item);
            return (
              <li key={item.id} className="su-item" data-item={item.id} data-status={item.status} data-owner={item.owner}>
                <span className="su-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="su-text">
                  <div className="su-label">{item.label}</div>
                  <p className="lx-note su-why">{item.why}</p>
                </div>
                <span className="su-state">
                  <span className={`lx-pill ${pill.tone}`}>{pill.label}</span>
                </span>
                <span className="su-action">
                  {action && (
                    <Link href={item.href} className="lx-btn lx-btn-sec lx-btn-sm" aria-label={`${action}: ${item.label}`}>
                      {action}
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/** The way out of the setup page for a firm whose remaining items are Lectual's to switch on. */
export function GoToIntegrationsLink() {
  return (
    <Link href={INTEGRATIONS_PATH} className="lx-btn lx-btn-sec">
      Go to Integrations
    </Link>
  );
}
