import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadPipeline } from "@/lib/lifecycle/load";
import { COLUMN_HINT, COLUMN_LABEL, filterCards, groupColumns, type PipelineCard, type PipelineColumn } from "@/lib/lifecycle/columns";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar } from "@/components/list-page/ListToolbar";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import "@/components/list-page/list-page.css";
import { PIPELINE_VIEW_ONLY } from "@/lib/ui/words";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Pipeline") };

export const dynamic = "force-dynamic";

/** How many cards a column draws before "and N more". */
const CARDS_PER_COLUMN = 40;
const PRE: readonly PipelineColumn[] = ["intake", "consult"];
/** Where a column header goes: the Leads board for the lead columns, the Matters board for the rest. */
const LEADS_BOARD_HREF = "/dashboard/intake/?view=board";
const MATTERS_BOARD_HREF = "/dashboard/matters/?view=board";

function Card({ c }: { c: PipelineCard }) {
  return (
    <li className="lp-board-card">
      <Link href={c.href} className="lx-rowlink" style={{ fontWeight: 600 }}>
        {c.client}
      </Link>
      {c.mark && <span className="lx-note">{c.mark}</span>}
      <span className="lx-note">
        {c.ref}
        {c.stageLabel ? ` · ${c.stageLabel}` : ""}
      </span>
      <span className="lx-note" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{c.ownerName ?? (c.ownerId ? "Team member" : "No owner")}</span>
        {c.ageLabel && <span className="lx-num">{c.ageLabel}</span>}
      </span>
    </li>
  );
}

/**
 * The matter pipeline: one board from a referral or new intake to a
 * registration (src/lib/lifecycle/columns.ts has the mapping rule). It lives
 * under Active matters in the rail and is linked from the Intake and Active
 * matters reports, because it spans both.
 *
 * Every read is scoped (RLS), and each half of the board has its own state:
 * a half that couldn't be read shows "couldn't be loaded" over its columns,
 * never an empty column with a zero.
 */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ q?: string; owner?: string }> }) {
  const session = await resolveFirmSession({ signInNext: "/dashboard/pipeline/" });
  if (session.kind !== "ok") notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const owner = typeof sp.owner === "string" ? sp.owner : "";

  const load = await loadPipeline();
  const columns = groupColumns(filterCards(load.cards, { q, owner: owner || undefined }));
  const failed = (col: PipelineColumn) => (PRE.includes(col) ? load.leads !== "ok" : load.matters !== "ok");
  const ownerHref = (o: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (o) p.set("owner", o);
    const s = p.toString();
    return `/dashboard/pipeline/${s ? `?${s}` : ""}`;
  };

  return (
    <div className="lp-root">
      <ListHeader title="Pipeline" sub={`Every client from first contact to registration. ${PIPELINE_VIEW_ONLY}`} />

      <ListToolbar
        search={{
          label: "Search the pipeline",
          placeholder: "Search client, mark or matter",
          defaultValue: q,
          hidden: owner ? { owner } : {},
          clearHref: `/dashboard/pipeline/${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`,
        }}
      />

      {load.owners.length > 0 && (
        <FilterChips as="nav" label="Owner">
          <Chip href={ownerHref("")} active={!owner}>
            Everyone
          </Chip>
          <Chip href={ownerHref(session.user.id)} active={owner === session.user.id}>
            Mine
          </Chip>
          {load.owners
            .filter((o) => o.id !== session.user.id)
            .map((o) => (
              <Chip key={o.id} href={ownerHref(o.id)} active={owner === o.id}>
                {o.name}
              </Chip>
            ))}
          <Chip href={ownerHref("none")} active={owner === "none"}>
            No owner
          </Chip>
        </FilterChips>
      )}

      {(load.leads !== "ok" || load.matters !== "ok") && (
        <p className="lx-banner lx-banner-warn" role="alert" style={{ margin: 0 }}>
          {load.leads !== "ok" && load.matters !== "ok"
            ? "Can't show the pipeline right now. Refresh to try again."
            : load.leads !== "ok"
              ? "Leads couldn't be loaded, so the first two columns can't be shown. Refresh to try again."
              : "Matters couldn't be loaded, so the columns from Engaged on can't be shown. Refresh to try again."}
        </p>
      )}
      {load.notes.map((n) => (
        <p key={n} className="lx-note" style={{ margin: 0, color: "var(--warn)" }}>
          {n}
        </p>
      ))}

      <div className="lx-board" aria-label="Pipeline">
        {columns.map(({ column, count, cards }) => {
          const isFailed = failed(column);
          const body = (
            <>
              {isFailed ? (
                <p className="lx-note" style={{ margin: 0 }}>
                  Can&apos;t show this column right now.
                </p>
              ) : cards.length === 0 ? (
                <p className="lx-note" style={{ margin: 0 }}>
                  {q || owner ? "Nothing matches." : "Nothing here."}
                </p>
              ) : (
                <ul>
                  {cards.slice(0, CARDS_PER_COLUMN).map((c) => (
                    <Card key={c.key} c={c} />
                  ))}
                </ul>
              )}
              {!isFailed && cards.length > CARDS_PER_COLUMN && <p className="lx-note" style={{ margin: 0 }}>And {cards.length - CARDS_PER_COLUMN} more. Search to narrow.</p>}
            </>
          );
          const header = (
            <header>
              <span className="lx-board-title">
                <Link href={PRE.includes(column) ? LEADS_BOARD_HREF : MATTERS_BOARD_HREF} className="lx-rowlink" data-column-link={column}>
                  {COLUMN_LABEL[column]}
                </Link>{" "}
                <span className="lx-num lx-note">{isFailed ? "—" : count}</span>
              </span>
              <span className="lx-note" style={{ fontSize: 12 }}>
                {COLUMN_HINT[column]}
              </span>
            </header>
          );
          return column === "closed" ? (
            <details key={column} className="lx-board-col" aria-label={COLUMN_LABEL[column]} style={{ flexBasis: 220 }}>
              <summary style={{ cursor: "pointer", listStyle: "none" }}>{header}</summary>
              {body}
            </details>
          ) : (
            <section key={column} className="lx-board-col" aria-label={COLUMN_LABEL[column]}>
              {header}
              {body}
            </section>
          );
        })}
      </div>
    </div>
  );
}
