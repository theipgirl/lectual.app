import "@/app/dashboard/proposals/proposals.css";
import "@/components/list-page/list-page.css";
import { ListSearch } from "@/components/list-page/ListToolbar";
import { ViewToggle } from "@/components/ViewToggle";
import { EmptyState } from "@/components/ui/EmptyState";
import { searchPlaceholder } from "@/lib/ui/words";
import { SEARCH_MAX, NEW_PROPOSAL_PATH, showingLine, type PickerView } from "@/lib/proposals/new-picker";
import { StartDraftRow } from "./StartDraft";
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
export function WhoIsThisFor({
  view,
  chosen,
  basePath = NEW_PROPOSAL_PATH,
  intro = "Pick a lead or a matter and the draft is created from it. You can change anything in the editor before the link goes live.",
  hidden,
  create,
}: {
  /** New proposal: a row creates the draft in one step (a form posting the record's id) instead of linking to a page. */
  create?: { type: "trademark" | "general" };
  /** Spec 9: extra query values the search keeps (New proposal's `type=general`). */
  hidden?: Record<string, string>;
  view: PickerView | null;
  chosen: WhoChosen | null;
  /** Where the search form submits. New proposal by default; New document passes its own page. */
  basePath?: string;
  /** The sentence under the title. */
  intro?: string;
}) {
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
        <h2 id="who-title" className="lx-h3">
          Who is this for?
        </h2>
        {view.blankHref && (
          <a href={view.blankHref} className="pe-who-blank">
            Start blank
          </a>
        )}
      </div>
      <p className="lx-note pe-hint">{intro}</p>
      <ViewToggle<RecordKind>
        className="pe-who-switch"
        label="Kind of record"
        value={kind}
        views={[
          { value: "lead", label: HEADING.lead },
          { value: "matter", label: HEADING.matter },
        ]}
        hrefFor={(k) => view.switchHrefs[k]}
      />
      <ListSearch
        id={inputId}
        className="pe-who-search"
        action={basePath}
        maxLength={SEARCH_MAX}
        name="q"
        defaultValue={term}
        placeholder={searchPlaceholder(PLURAL[kind])}
        label={`Search ${PLURAL[kind]}`}
        hidden={{ kind, ...(hidden ?? {}) }}
        clearHref={`${basePath}?${new URLSearchParams({ kind, ...(hidden ?? {}) }).toString()}`}
      />
      <p className="lx-note pe-hint">{SEARCH_HINT[kind]}</p>
      {list.status === "failed" ? (
        <p className="pe-msg pe-msg-err" role="alert">
          We couldn&apos;t load your {PLURAL[kind]}.
        </p>
      ) : list.rows.length === 0 ? (
        <EmptyState variant="line">{term ? `No matches for "${term}".` : `No ${PLURAL[kind]} on file yet.`}</EmptyState>
      ) : (
        <>
          <ul className="lx-list pe-who-list">
            {list.rows.map((r) => (
              <li key={r.id}>
                {create ? (
                  <StartDraftRow recordKind={kind} id={r.id} name={r.name} secondary={r.secondary} type={create.type} />
                ) : (
                <a href={r.href} className="pe-who-row" aria-current={r.selected ? "true" : undefined} data-selected={r.selected ? "true" : undefined}>
                  <span className="pe-who-name">{r.name}</span>
                  {r.secondary && <span className="pe-who-sub">{r.secondary}</span>}
                  {r.selected && <span className="pe-who-mark">Selected</span>}
                </a>
                )}
              </li>
            ))}
          </ul>
          <p className="lx-note pe-hint">{showingLine(list.rows.length, list.total)}</p>
        </>
      )}
      {otherFailed.map((k) => (
        <p key={k} className="pe-msg pe-msg-err" role="alert">
          We couldn&apos;t load your {PLURAL[k]}.
        </p>
      ))}
    </section>
  );
}
