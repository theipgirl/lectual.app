import type { Metadata } from "next";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar } from "@/components/list-page/ListToolbar";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import "@/components/list-page/list-page.css";
import { ReviewSection } from "@/components/review/ReviewSection";
import { AgendaView, KpiStrip, MeetingCard, ReviewBoard, StageView, ViewSwitch } from "@/components/review/ReviewViews";
import { CardsDeck, PersonChips } from "@/components/review/CardsDeck";
import { ReviewPanel } from "@/components/review/ReviewPanel";
import { resolveFirmSession } from "@/lib/firm/session";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { CAN_MOVE_STAGE } from "@/lib/pipeline/leads";
import { loadReview } from "@/lib/review/load";
import { agendaOrder, agendaQueue, agendaSection, AGENDA_COPY } from "@/lib/review/agenda";
import { bucketOf, reviewBuckets, reviewSubline } from "@/lib/review/buckets";
import { boardLanes, kpis, meetingPosition, stageGroups } from "@/lib/review/lanes";
import { applyReviewFilters, DEFAULT_REVIEW_VIEW, parseReviewParams, reviewHref, type ReviewParams } from "@/lib/review/params";
import { criticalAlert, detailsNote } from "@/lib/review/notes";
import { noticeFor } from "@/lib/review/notice";
import { buildDeck, chosenPerson, deckPeople } from "@/lib/review/deck";
import { loadLatestNote, loadReviewDetail } from "@/lib/review/detail-load";
import { pageTitle } from "@/lib/ui/page-title";
import { REVIEW_NAME } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(REVIEW_NAME) };

export const dynamic = "force-dynamic";

type SearchParams = { who?: string | string[]; kind?: string | string[]; q?: string | string[]; view?: string | string[]; i?: string | string[]; person?: string | string[]; open?: string | string[]; notice?: string | string[] };

/**
 * One page for Monday's walk-through: every open matter and every lead past first contact, in the
 * section that says what needs a person. Filters are links (a shareable URL). Reads are three-state per
 * source: a failed critical source is ONE alert and no sections; a failed optional source is one note.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const params = parseReviewParams(sp);
  const [load, session] = await Promise.all([loadReview(), resolveFirmSession()]);
  const role = session.kind === "ok" ? session.role : null;
  const userId = session.kind === "ok" ? session.user.id : null;
  const canWrite = !!role && MATTER_WRITE_ROLES.includes(role);
  const canMove = canWrite && CAN_MOVE_STAGE.includes(role);

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

  const link = (next: Partial<ReviewParams>) => reviewHref({ ...params, i: 1, open: null, ...next });
  const shown = applyReviewFilters(load.rows, params, userId);
  const buckets = reviewBuckets(shown, load.today);
  // Chip counts: each chip counts what it would show with the other filters kept.
  const countFor = (over: Partial<ReviewParams>) => applyReviewFilters(load.rows, { ...params, ...over }, userId).length;
  const note = detailsNote(load.failed);
  const common = { today: load.today, members: load.members, canWrite, params };
  const agenda = agendaOrder(shown, load.today);
  const queue = agendaQueue(agenda, load.today);
  const pos = meetingPosition(queue.length, params.i);
  const focus = pos ? queue[pos.index] : null;

  // Cards: one person's deck, built from every row that passes the search and the kind chips (Whose is ignored: the picker is the person).
  let cards: { people: ReturnType<typeof deckPeople>; personId: string | null; card: ReturnType<typeof buildDeck>[number] | null; pos: ReturnType<typeof meetingPosition>; note: Awaited<ReturnType<typeof loadLatestNote>> | null } | null = null;
  if (params.view === "cards") {
    const deckBuckets = reviewBuckets(applyReviewFilters(load.rows, { ...params, who: "all" }, userId), load.today);
    let people = deckPeople(load.members, boardLanes(deckBuckets, load.members).map((l) => l.userId));
    if (people.length === 0 && userId) people = [{ userId, name: "You" }];
    const personId = chosenPerson(people, params.person, userId);
    const deck = buildDeck(deckBuckets, load.members, personId, load.today);
    const cardPos = meetingPosition(deck.length, params.i);
    const card = cardPos ? deck[cardPos.index] : null;
    cards = { people, personId, card, pos: cardPos, note: card ? await loadLatestNote({ kind: card.row.kind, id: card.row.id }) : null };
  }

  // The detail panel: the record is read AGAIN through the scoped client; the review row only supplies the computed facts.
  const panel = params.open
    ? { detail: await loadReviewDetail(params.open), row: load.rows.find((r) => r.kind === params.open!.kind && r.id === params.open!.id) ?? null }
    : null;
  const notice = noticeFor(sp.notice);

  return (
    <div className="lp-root">
      <ListHeader title={REVIEW_NAME} tour="review-head" sub={reviewSubline(buckets)} />

      <ListToolbar
        search={{
          label: "Search clients and marks",
          placeholder: "Client or mark",
          defaultValue: params.q,
          hidden: { ...(params.view !== DEFAULT_REVIEW_VIEW ? { view: params.view } : {}), ...(params.view === "cards" && params.person ? { person: params.person } : {}), ...(params.who === "mine" ? { who: "mine" } : {}), ...(params.kind !== "both" ? { kind: params.kind === "matter" ? "matters" : "leads" } : {}) },
          clearHref: link({ q: "", i: 1 }),
        }}
        toggle={<ViewSwitch params={params} />}
      />

      <KpiStrip kpis={kpis(buckets, shown, !load.failed.includes("approvals"), { known: !load.failed.includes("proposals"), today: load.today })} />

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
      {notice && (
        <p className="lx-banner lx-banner-warn" role="alert" style={{ margin: 0 }}>
          {notice}
        </p>
      )}

      {shown.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>{load.rows.length === 0 ? "Nothing to review" : "Nothing matches"}</h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {load.rows.length === 0 ? "Open matters and leads past first contact will show up here." : "Try another filter or search."}
          </p>
        </div>
      ) : params.view === "cards" && cards ? (
        <>
          <PersonChips people={cards.people} personId={cards.personId} params={params} />
          <CardsDeck card={cards.card} pos={cards.pos} personId={cards.personId} personName={cards.people.find((p) => p.userId === cards.personId)?.name ?? null} note={cards.note} {...common} />
        </>
      ) : params.view === "meeting" ? (
        <MeetingCard row={focus} bucket={focus ? bucketOf(focus, load.today) : null} sectionLabel={focus ? AGENDA_COPY[agendaSection(focus, load.today)].label : null} pos={pos} {...common} />
      ) : params.view === "stage" ? (
        <StageView groups={stageGroups(buckets)} {...common} />
      ) : params.view === "agenda" ? (
        <AgendaView groups={agenda} {...common} />
      ) : (
        <>
          <ReviewBoard lanes={boardLanes(buckets, load.members)} {...common} />
          <ReviewSection bucket="uspto" rows={buckets.sections.uspto} collapsed {...common} />
          <ReviewSection bucket="track" rows={buckets.sections.track} collapsed {...common} />
        </>
      )}
      {panel && params.open && (
        <ReviewPanel
          open={params.open}
          row={panel.row}
          detail={panel.detail}
          today={load.today}
          timeZone={load.timeZone}
          members={load.members}
          canWrite={canWrite}
          canMove={canMove}
          closeStages={load.closeStages}
          closeHref={reviewHref({ ...params, open: null })}
        />
      )}
    </div>
  );
}
