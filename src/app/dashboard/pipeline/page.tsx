import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadPipeline } from "@/lib/lifecycle/load";
import { COLUMN_HINT, COLUMN_LABEL, filterCards, groupColumns, type PipelineCard, type PipelineColumn } from "@/lib/lifecycle/columns";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar } from "@/components/list-page/ListToolbar";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import "@/components/list-page/list-page.css";
import { BoardCard, BoardColumn, LoadFailedLine, Notice, Pill, ShowingCount } from "@/components/ui";
import { BLANK, CANT_SHOW, PIPELINE_VIEW_ONLY, TEAMMATE, UNASSIGNED, columnEmpty, searchPlaceholder } from "@/lib/ui/words";
import { stageDisplayName } from "@/lib/matters/list-view";
import "./pipeline.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Pipeline") };

export const dynamic = "force-dynamic";

/** How many cards a column draws before "and N more". */
const CARDS_PER_COLUMN = 40;
const PRE: readonly PipelineColumn[] = ["intake", "consult"];
/** Where a column header goes: the Leads board for the lead columns, the Matters board for the rest. */
const LEADS_BOARD_HREF = "/dashboard/intake/?view=board";
const MATTERS_BOARD_HREF = "/dashboard/matters/?group=all&view=board";
/** The noun an empty column names ("No clients here yet."). */
const COLUMN_NOUN: Record<PipelineColumn, string> = { intake: "leads", consult: "leads", engaged: "matters", filed: "matters", office: "matters", registered: "matters", closed: "matters" };

function Card({ c }: { c: PipelineCard }) {
  return (
    <BoardCard
      href={c.href}
      title={c.client}
      meta={[c.mark, c.ref, c.stageLabel ? stageDisplayName(c.stageLabel) : null].filter(Boolean).join(" · ")}
      chip={c.ageLabel ? <Pill num>{c.ageLabel}</Pill> : undefined}
      foot={c.ownerName ?? (c.ownerId ? TEAMMATE : UNASSIGNED)}
    />
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
          label: searchPlaceholder("the pipeline"),
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
            {UNASSIGNED}
          </Chip>
        </FilterChips>
      )}

      {(load.leads !== "ok" || load.matters !== "ok") && (
        <Notice tone="warn" role="alert">
          {load.leads !== "ok" && load.matters !== "ok"
            ? CANT_SHOW
            : load.leads !== "ok"
              ? "Leads couldn't be loaded, so the first two columns can't be shown. Refresh to try again."
              : "Matters couldn't be loaded, so the columns from Engaged on can't be shown. Refresh to try again."}
        </Notice>
      )}
      {load.notes.map((n) => (
        <Notice key={n} tone="warn">
          {n}
        </Notice>
      ))}

      <div className="lx-board" aria-label="Pipeline">
        {columns.map(({ column, count, cards }) => {
          const isFailed = failed(column);
          const shownCards = cards.slice(0, CARDS_PER_COLUMN);
          return (
            <BoardColumn
              key={column}
              title={COLUMN_LABEL[column]}
              titleHref={PRE.includes(column) ? LEADS_BOARD_HREF : MATTERS_BOARD_HREF}
              titleLinkProps={{ "data-column-link": column }}
              as={column === "closed" ? "details" : "section"}
              className={column === "closed" ? "pl-closed" : undefined}
              count={isFailed ? BLANK : count}
              note={
                <>
                  <p className="lx-board-note">{COLUMN_HINT[column]}</p>
                  {isFailed && <LoadFailedLine role="alert" refresh={false}>Can&apos;t show this column right now.</LoadFailedLine>}
                </>
              }
              empty={isFailed ? undefined : q || owner ? "Nothing matches." : columnEmpty(COLUMN_NOUN[column])}
              foot={isFailed ? null : <ShowingCount shown={CARDS_PER_COLUMN} total={cards.length} />}
            >
              {isFailed ? null : shownCards.map((c) => <Card key={c.key} c={c} />)}
            </BoardColumn>
          );
        })}
      </div>
    </div>
  );
}
