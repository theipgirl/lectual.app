import type { Metadata } from "next";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar } from "@/components/list-page/ListToolbar";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import "@/components/list-page/list-page.css";
import { ReviewSection } from "@/components/review/ReviewSection";
import { KpiStrip, MeetingCard, ReviewBoard, StageView, ViewSwitch } from "@/components/review/ReviewViews";
import { resolveFirmSession } from "@/lib/firm/session";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { loadReview } from "@/lib/review/load";
import { bucketOf, reviewBuckets, reviewSubline } from "@/lib/review/buckets";
import { boardLanes, kpis, meetingPosition, meetingQueue, stageGroups } from "@/lib/review/lanes";
import { applyReviewFilters, parseReviewParams, reviewHref, type ReviewParams } from "@/lib/review/params";
import { criticalAlert, detailsNote } from "@/lib/review/notes";
import { pageTitle } from "@/lib/ui/page-title";
import { REVIEW_NAME } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(REVIEW_NAME) };

export const dynamic = "force-dynamic";

type SearchParams = { who?: string | string[]; kind?: string | string[]; q?: string | string[]; view?: string | string[]; i?: string | string[] };

/**
 * One page for Monday's walk-through: every open matter and every lead past first contact, in the
 * section that says what needs a person. Filters are links (a shareable URL). Reads are three-state per
 * source: a failed critical source is ONE alert and no sections; a failed optional source is one note.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = parseReviewParams(await searchParams);
  const [load, session] = await Promise.all([loadReview(), resolveFirmSession()]);
  const role = session.kind === "ok" ? session.role : null;
  const userId = session.kind === "ok" ? session.user.id : null;
  const canWrite = !!role && MATTER_WRITE_ROLES.includes(role);

  if (load.status === "unavailable") {
    return (
      <div className="lp-root">
        <ListHeader title={REVIEW_NAME} tour="review-head" sub="Open matters and leads that need a person this week." />
        <div className="lx-card lx-empty-card" role="alert">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>The weekly review couldn&apos;t be loaded</h2>
          <p className="lx-note" style={{ margin: 0 }}>{criticalAlert(load.failed)}</p>
        </div>
      </div>
    );
  }

  const link = (next: Partial<ReviewParams>) => reviewHref({ ...params, i: 1, ...next });
  const shown = applyReviewFilters(load.rows, params, userId);
  const buckets = reviewBuckets(shown, load.today);
  // Chip counts: each chip counts what it would show with the other filters kept.
  const countFor = (over: Partial<ReviewParams>) => applyReviewFilters(load.rows, { ...params, ...over }, userId).length;
  const note = detailsNote(load.failed);
  const common = { today: load.today, members: load.members, canWrite };
  const queue = meetingQueue(buckets, load.members);
  const pos = meetingPosition(queue.length, params.i);
  const focus = pos ? queue[pos.index] : null;

  return (
    <div className="lp-root">
      <ListHeader title={REVIEW_NAME} tour="review-head" sub={reviewSubline(buckets)} />

      <ListToolbar
        search={{
          label: "Search clients and marks",
          placeholder: "Client or mark",
          defaultValue: params.q,
          hidden: { ...(params.view !== "board" ? { view: params.view } : {}), ...(params.who === "mine" ? { who: "mine" } : {}), ...(params.kind !== "both" ? { kind: params.kind === "matter" ? "matters" : "leads" } : {}) },
          clearHref: link({ q: "", i: 1 }),
        }}
        toggle={<ViewSwitch params={params} />}
      />

      <KpiStrip kpis={kpis(buckets, shown, !load.failed.includes("approvals"))} />

      <FilterChips as="nav" label="Whose">
        <Chip href={link({ who: "all" })} active={params.who === "all"} count={countFor({ who: "all" })}>Everyone</Chip>
        <Chip href={link({ who: "mine" })} active={params.who === "mine"} count={countFor({ who: "mine" })}>Mine</Chip>
      </FilterChips>
      <FilterChips as="nav" label="Matters or leads">
        <Chip href={link({ kind: "both" })} active={params.kind === "both"} count={countFor({ kind: "both" })}>Both</Chip>
        <Chip href={link({ kind: "matter" })} active={params.kind === "matter"} count={countFor({ kind: "matter" })}>Matters</Chip>
        <Chip href={link({ kind: "lead" })} active={params.kind === "lead"} count={countFor({ kind: "lead" })}>Leads</Chip>
      </FilterChips>

      {note && (
        <p className="lx-banner lx-banner-warn" role="status" style={{ margin: 0 }}>
          {note}
        </p>
      )}

      {shown.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>{load.rows.length === 0 ? "Nothing to review" : "Nothing matches"}</h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {load.rows.length === 0 ? "Open matters and leads past first contact will show up here." : "Try another filter or search."}
          </p>
        </div>
      ) : params.view === "meeting" ? (
        <MeetingCard row={focus} bucket={focus ? bucketOf(focus, load.today) : null} pos={pos} params={params} {...common} />
      ) : params.view === "stage" ? (
        <StageView groups={stageGroups(buckets)} {...common} />
      ) : (
        <>
          <ReviewBoard lanes={boardLanes(buckets, load.members)} {...common} />
          <ReviewSection bucket="uspto" rows={buckets.sections.uspto} collapsed {...common} />
          <ReviewSection bucket="track" rows={buckets.sections.track} collapsed {...common} />
        </>
      )}
    </div>
  );
}
