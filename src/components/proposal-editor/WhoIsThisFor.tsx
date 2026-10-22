import "@/app/dashboard/proposals/proposals.css";
import { SEARCH_MAX, NEW_PROPOSAL_PATH, showingLine, type PickerView } from "@/lib/proposals/new-picker";
import type { RecordKind } from "@/lib/skills/catalog";

const PLURAL: Record<RecordKind, string> = { lead: "leads", matter: "matters" };
const HEADING: Record<RecordKind, string> = { lead: "Leads", matter: "Matters" };
const SEARCH_HINT: Record<RecordKind, string> = { lead: "Search by name, business or email.", matter: "Search by mark, title, matter number or client." };

/** What the bar says once someone is chosen, or the person started blank. */
export type WhoChosen = { kind: "chosen"; label: string; changeHref: string } | { kind: "blank"; chooseHref: string };

/**
 * "Who is this for?" at the top of New proposal. A plain GET form and links, so it
 * works without JavaScript and nothing is written: choosing a record is a link to
 * `?lead=<id>` / `?matter=<id>`, and the page re-reads that record itself.
 *
 * Collapsed, it is one line: "For: <label> . Change". A failed list read is its
 * own sentence for that kind and is never drawn as "No matches".
 */
export function WhoIsThisFor({ view, chosen }: { view: PickerView | null; chosen: WhoChosen | null }) {
  if (chosen?.kind === "chosen") {
    return (
      <section className="lx-card pe-who pe-who-bar" aria-label="Who is this for?">
        <span className="lx-label">For:</span> <strong>{chosen.label}</strong> · <a href={chosen.changeHref}>Change</a>
      </section>
    );
  }
  if (chosen?.kind === "blank") {
    return (
      <section className="lx-card pe-who pe-who-bar" aria-label="Who is this for?">
        <span className="lx-label">Starting blank</span> · <a href={chosen.chooseHref}>Choose a lead or matter</a>
      </section>
    );
  }

  if (!view) return null;
  const { kind, term, list } = view;
  const inputId = "who-search";
  const otherFailed = view.failed.filter((k) => k !== kind);
  return (
    <section className="lx-card pe-who" aria-labelledby="who-title">
      <div className="pe-who-head">
        <h2 id="who-title" className="pe-h">
          Who is this for?
        </h2>
        <a href={view.blankHref} className="pe-who-blank">
          Start blank
        </a>
      </div>
      <p className="lx-note pe-hint">Pick a lead or a matter and the form below is filled from it. You can change anything before you create the draft.</p>
      <nav className="lx-segs pe-who-switch" aria-label="Kind of record">
        {(["lead", "matter"] as const).map((k) => (
          <a key={k} href={view.switchHrefs[k]} aria-current={k === kind ? "page" : undefined}>
            {HEADING[k]}
          </a>
        ))}
      </nav>
      <form method="get" action={NEW_PROPOSAL_PATH} className="pe-who-search" role="search">
        <input type="hidden" name="kind" value={kind} />
        <input
          id={inputId}
          className="lx-input"
          name="q"
          type="search"
          maxLength={SEARCH_MAX}
          defaultValue={term}
          aria-label={`Search ${PLURAL[kind]}`}
        />
        <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm">
          Search
        </button>
      </form>
      <p className="lx-note pe-hint">{SEARCH_HINT[kind]}</p>
      {list.status === "failed" ? (
        <p className="lx-note pe-who-alert" role="alert">
          We couldn&apos;t load your {PLURAL[kind]}.
        </p>
      ) : list.rows.length === 0 ? (
        <p className="lx-note pe-hint">{term ? `No matches for "${term}".` : `No ${PLURAL[kind]} on file yet.`}</p>
      ) : (
        <>
          <ul className="lx-list pe-who-list">
            {list.rows.map((r) => (
              <li key={r.id}>
                <a href={r.href}>{r.label}</a>
                {r.detail && <span className="lx-note"> · {r.detail}</span>}
              </li>
            ))}
          </ul>
          <p className="lx-note pe-hint">{showingLine(list.rows.length, list.total)}</p>
        </>
      )}
      {otherFailed.map((k) => (
        <p key={k} className="lx-note pe-who-alert" role="alert">
          We couldn&apos;t load your {PLURAL[k]}.
        </p>
      ))}
    </section>
  );
}
