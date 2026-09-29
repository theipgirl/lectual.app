import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadPipeline } from "@/lib/lifecycle/load";
import { COLUMN_HINT, COLUMN_LABEL, filterCards, groupColumns, type PipelineCard, type PipelineColumn } from "@/lib/lifecycle/columns";

export const dynamic = "force-dynamic";

/** How many cards a column draws before "and N more". */
const CARDS_PER_COLUMN = 40;
const PRE: readonly PipelineColumn[] = ["intake", "consult"];

function Card({ c }: { c: PipelineCard }) {
  return (
    <li className="lx-board-card">
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
        {c.ageDays !== null && <span className="lx-num">{c.ageDays}d in stage</span>}
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
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Active matters</div>
          <h1 className="lx-h1">Pipeline</h1>
          <p className="lx-sub">
            Every client from first contact to registration. Leads fill the first columns by your intake stages; matters fill the rest by
            their docket stage.
          </p>
        </div>
        <form method="get" className="lx-search-form" role="search">
          {owner && <input type="hidden" name="owner" value={owner} />}
          <input className="lx-input" type="search" name="q" defaultValue={q} placeholder="Search client, mark or matter" aria-label="Search the pipeline" />
        </form>
      </div>

      {load.owners.length > 0 && (
        <nav className="lx-chips" aria-label="Owner">
          <Link href={ownerHref("")} aria-current={!owner ? "page" : undefined}>
            Everyone
          </Link>
          <Link href={ownerHref(session.user.id)} aria-current={owner === session.user.id ? "page" : undefined}>
            Mine
          </Link>
          {load.owners
            .filter((o) => o.id !== session.user.id)
            .map((o) => (
              <Link key={o.id} href={ownerHref(o.id)} aria-current={owner === o.id ? "page" : undefined}>
                {o.name}
              </Link>
            ))}
          <Link href={ownerHref("none")} aria-current={owner === "none" ? "page" : undefined}>
            No owner
          </Link>
        </nav>
      )}

      {(load.leads !== "ok" || load.matters !== "ok") && (
        <p className="lx-banner lx-banner-warn" role="alert" style={{ margin: 0 }}>
          {load.leads !== "ok" && load.matters !== "ok"
            ? "Neither leads nor matters could be loaded, so the pipeline can't be shown. Try again shortly."
            : load.leads !== "ok"
              ? "Leads couldn't be loaded, so the intake and consult columns are unknown (not empty)."
              : "Matters couldn't be loaded, so the columns from Engaged on are unknown (not empty)."}
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
                  Couldn&apos;t be loaded.
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
                {COLUMN_LABEL[column]} <span className="lx-num lx-note">{isFailed ? "—" : count}</span>
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
    </>
  );
}
