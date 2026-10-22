import Link from "next/link";
import { INTEGRATIONS_PATH } from "@/lib/setup/routes";
import type { SetupChecklist, SetupItemStatus } from "@/lib/setup/types";
import "./setup.css";

/** Every status has its own words, so colour is never the only signal. */
export const STATUS_PILL: Record<SetupItemStatus, { label: string; tone: string }> = {
  done: { label: "Done", tone: "lx-pill-ok" },
  "to-do": { label: "To do", tone: "lx-pill-mute" },
  "couldnt-check": { label: "Couldn't check", tone: "lx-pill-warn" },
};

/** The checklist as the setup page draws it. Presentational: it only reads what it is given. */
export function SetupChecklistView({ checklist }: { checklist: SetupChecklist }) {
  const { items, doneCount, total, complete } = checklist;
  return (
    <div className="su-wrap">
      <section className="lx-card su-summary" aria-labelledby="setup-count">
        <h2 id="setup-count" className="su-count">
          {`${doneCount} of ${total} done`}
        </h2>
        <div className="su-bar" aria-hidden="true">
          <span style={{ width: `${Math.round((doneCount / total) * 100)}%` }} />
        </div>
        {complete ? (
          <p className="lx-sub" style={{ margin: 0 }}>
            Everything is set up
          </p>
        ) : (
          <p className="lx-sub" style={{ margin: 0 }}>
            Work down the list. Each button opens the page where that step is done.
          </p>
        )}
      </section>

      <section className="lx-card" aria-label="Setup checklist">
        <ol className="su-list">
          {items.map((item, i) => {
            const pill = STATUS_PILL[item.status];
            return (
              <li key={item.id} className="su-item" data-item={item.id} data-status={item.status}>
                <span className="su-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="su-state">
                  <span className={`lx-pill ${pill.tone}`}>{pill.label}</span>
                </span>
                <div>
                  <div className="su-label">{item.label}</div>
                  <p className="lx-note su-why">{item.why}</p>
                </div>
                <span className="su-action">
                  {item.status !== "done" && (
                    <Link href={item.href} className="lx-btn lx-btn-sec lx-btn-sm" aria-label={`Set up: ${item.label}`}>
                      Set up
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
