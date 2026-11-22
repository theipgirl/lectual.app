import type { Metadata } from "next";
import Link from "next/link";
import { ListHeader } from "@/components/list-page/ListHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailedCard } from "@/components/ui/LoadFailed";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { ListSearch, ListToolbar } from "@/components/list-page/ListToolbar";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import "@/components/list-page/list-page.css";
import { ReviewSection } from "@/components/review/ReviewSection";
import { DeadlinesStrip, KpiStrip, ReviewBoard, ViewSwitch, WaitingOnStrip } from "@/components/review/ReviewViews";
import { SheetView } from "@/components/review/SheetView";
import { SheetSaveStatus } from "@/components/review/SheetSaveStatus";
import { loadSheetStages } from "@/lib/review/sheet-edit-load";
import { loadSheetNotes } from "@/lib/review/sheet-notes-load";
import { READ_ONLY_PERMS, type SheetPerms } from "@/lib/review/sheet-edit";
import { CardsDeck, PersonChips } from "@/components/review/CardsDeck";
import { ReviewCardAside } from "@/components/review/ReviewCardExtras";
import { RecordCardHost } from "@/components/record-card/RecordCardHost";
import { loadRecordCard } from "@/lib/record-card/load";
import { cardEdits } from "@/lib/record-card/rules";
import { resolveFirmSession } from "@/lib/firm/session";
import { NO_PREVIEW, previewFor, viewFor } from "@/lib/views";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { CAN_MOVE_STAGE, CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { loadReview } from "@/lib/review/load";
import { reviewBuckets, reviewSubline } from "@/lib/review/buckets";
import { boardLanes, kpis, meetingPosition, offBoard } from "@/lib/review/lanes";
import { deadlinesOut, reviewPerson, waitingOnPerson } from "@/lib/review/strips";
import { applyReviewFilters, olderHiddenCount, sinceSuspended, DEFAULT_REVIEW_VIEW, parseReviewParams, reviewHref, type ReviewParams } from "@/lib/review/params";
import { criticalAlert, detailsNote } from "@/lib/review/notes";
import { noticeFor } from "@/lib/review/notice";
import { buildDeck, chosenPerson, deckPeople } from "@/lib/review/deck";
import { loadDeckDocuments, loadLatestNote } from "@/lib/review/detail-load";
import { pageTitle } from "@/lib/ui/page-title";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";
import { REVIEW_NAME, REVIEW_SHOW_ALL, REVIEW_SHOWING_ALL, REVIEW_SINCE_LABEL, REVIEW_SINCE_SUSPENDED, reviewIntro, reviewOlderHidden } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(REVIEW_NAME) };

export const dynamic = "force-dynamic";

type SearchParams = { since?: string | string[]; who?: string | string[]; kind?: string | string[]; q?: string | string[]; view?: string | string[]; i?: string | string[]; person?: string | string[]; open?: string | string[]; notice?: string | string[] };

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
        <LoadFailedCard role="alert" what="the weekly review" body={criticalAlert(load.failed)} />
      </div>
    );
  }

  const link = (next: Partial<ReviewParams>) => reviewHref({ ...params, i: 1, open: null, ...next });
  // A failed read behind one of the since filter's protections turns the filter off for this page, and the chip says so.
  const sinceOff = sinceSuspended(load.failed);
  const filterParams: ReviewParams = sinceOff ? { ...params, since: "all" } : params;
  const shown = applyReviewFilters(load.rows, filterParams, userId);
  const buckets = reviewBuckets(shown, load.today);
  // Chip counts (technician view): each chip counts what it would show with the other filters kept.
  const countFor = (over: Partial<ReviewParams>) => applyReviewFilters(load.rows, { ...filterParams, ...over }, userId).length;
  const note = detailsNote(load.failed);
  // The board look is the owner view's; every other view keeps the page as it was. Decided the way Today decides it.
  const owner = session.kind === "ok" && viewFor({
    role: session.role,
    preview: session.actingAsStaff ? previewFor(session.user?.user_metadata, session.org?.id) : NO_PREVIEW,
    firmHasRoleViews: (session.org?.modules ?? []).includes("role-views"),
    actingAsStaff: session.actingAsStaff,
  }) === "owner";
  const common = { owner, today: load.today, members: load.members, canWrite, params };
  // The owner's Sheet edits in place. Each permission comes from the role re-resolved above; the stage lists are read only for a role that can move one.
  let sheetPerms: SheetPerms | null = null;
  if (owner && params.view === "sheet") {
    const writeLead = !!role && CAN_WRITE_LEAD.includes(role);
    const moveLead = writeLead && !!role && CAN_MOVE_STAGE.includes(role);
    const stages = canWrite || moveLead ? await loadSheetStages() : { matter: null, lead: null };
    sheetPerms = canWrite || writeLead ? { writeMatter: canWrite, writeLead, moveLead, matterStages: canWrite ? stages.matter : null, leadStages: moveLead ? stages.lead : null } : READ_ONLY_PERMS;
  }
  // The Notes column: the newest plain note of each row ON SCREEN, read only for the Sheet (three-state; a failed read says so in the cells).
  const sheetNotes = params.view === "sheet" && shown.length > 0 ? await loadSheetNotes(shown, load.timeZone) : null;
  const approvalsKnown = !load.failed.includes("approvals");
  // An approver sees the strip about THEM ("Waiting on you"); anyone else sees it about the review person, as before.
  const isApprover = !!role && !!userId && QUEUE_APPROVE_ROLES.includes(role);
  const person = isApprover ? { userId: userId!, firstName: "you" } : reviewPerson(load.members);
  const olderHidden = olderHiddenCount(load.rows, params, userId);
  // No review person, no "Waiting on" strip. The Deadlines strip (PGE Sprint 3) is always drawn: the open deadlines in the
  // rows on screen, or one line saying the deadlines couldn't load (never "no deadlines").
  const deadlinesFailed = load.failed.includes("deadlines");
  const strips = (
    <div className="rv-strips">
      {person && <WaitingOnStrip owner={owner} firstName={person.firstName} you={isApprover} personId={person.userId} rows={waitingOnPerson(shown, person.userId)} approvalsKnown={approvalsKnown} params={params} />}
      <DeadlinesStrip items={deadlinesFailed ? [] : deadlinesOut(shown, load.today)} failed={deadlinesFailed} params={params} />
    </div>
  );
  const lanes = boardLanes(buckets, load.members);
  const rest = offBoard(buckets);

  // Cards: one person's deck, built from every row that passes the search and the kind chips (Whose is ignored: the picker is the person).
  let cards: { people: ReturnType<typeof deckPeople>; personId: string | null; card: ReturnType<typeof buildDeck>[number] | null; pos: ReturnType<typeof meetingPosition>; note: Awaited<ReturnType<typeof loadLatestNote>> | null; docs: Awaited<ReturnType<typeof loadDeckDocuments>> | null } | null = null;
  if (params.view === "cards") {
    const deckBuckets = reviewBuckets(applyReviewFilters(load.rows, { ...filterParams, who: "all" }, userId), load.today);
    let people = deckPeople(load.members, boardLanes(deckBuckets, load.members).map((l) => l.userId));
    if (people.length === 0 && userId) people = [{ userId, name: "You" }];
    const personId = chosenPerson(people, params.person, userId);
    const deck = buildDeck(deckBuckets, load.members, personId);
    const cardPos = meetingPosition(deck.length, params.i);
    const card = cardPos ? deck[cardPos.index] : null;
    // The current card only: one small read of its own record's documents, not every row's.
    const [cardNote, cardDocs] = card ? await Promise.all([loadLatestNote({ kind: card.row.kind, id: card.row.id }), loadDeckDocuments({ kind: card.row.kind, id: card.row.id })]) : [null, null];
    cards = { people, personId, card, pos: cardPos, note: cardNote, docs: cardDocs };
  }

  // `?open=` opens the record in the SAME centred card Intake and Matters open (no drawer). The card re-reads the record through the
  // scoped client (`loadRecordCard`: a foreign or missing id is "couldn't be found", a failed read "couldn't be loaded"); the review
  // row only supplies the facts it computed. A merged lead opened by URL shows its keeper (the loader followed the pointer).
  const cardLoad = params.open ? await loadRecordCard(params.open) : null;
  const cardShownId = cardLoad?.status === "ok" ? (cardLoad.kind === "lead" ? cardLoad.lead.id : cardLoad.matter.id) : null;
  const cardRow = params.open && cardShownId ? (load.rows.find((r) => r.kind === params.open!.kind && r.id === cardShownId) ?? null) : null;
  // Close (and Back) land on the same review view: every other review param is kept, only `open` goes.
  const cardBase = reviewHref({ ...params, open: null });
  const cardParams = new URLSearchParams(cardBase.includes("?") ? cardBase.slice(cardBase.indexOf("?") + 1) : "");
  // Rendered here (an async server component called once) so the page itself stays one synchronous tree.
  const card =
    params.open && cardLoad
      ? await RecordCardHost({
          open: params.open,
          path: "/dashboard/review/",
          params: cardParams,
          load: cardLoad,
          review: {
            aside: (
              <ReviewCardAside
                open={{ kind: params.open.kind, id: cardShownId ?? params.open.id }}
                row={cardRow}
                members={load.members}
                today={load.today}
                // Said only to a role that could change the stage (the card's own `stage` edit, judged as if the stages had been read).
                stagesFailed={cardLoad.status === "ok" && cardLoad.stages.status !== "ok" && cardEdits({ role: cardLoad.role, kind: cardLoad.kind }).stage}
                closeStages={canMove ? load.closeStages : []}
                deadlinesFailed={load.failed.includes("deadlines")}
              />
            ),
          },
        })
      : null;
  const notice = noticeFor(sp.notice);

  const searchHidden = { ...(params.since === "all" ? { since: "all" } : {}), ...(params.view !== DEFAULT_REVIEW_VIEW ? { view: params.view } : {}), ...(params.view === "cards" && params.person ? { person: params.person } : {}), ...(params.who === "mine" ? { who: "mine" } : {}), ...(params.kind !== "both" ? { kind: params.kind === "matter" ? "matters" : "leads" } : {}) };

  return (
    <div className={owner ? "lp-root rv-root rv-owner" : "lp-root rv-root"}>
      {owner ? (
        <>
      <PageHeader
        title={REVIEW_NAME}
        tour="review-head"
        className="rv-head lx-head-split"
        sub={buckets.total === 0 ? reviewSubline(buckets) : reviewIntro(buckets.total)}
        actions={
          sheetPerms && sheetPerms !== READ_ONLY_PERMS ? (
            <div className="rse-head-right">
              <SheetSaveStatus />
              <ViewSwitch params={params} />
            </div>
          ) : (
            <ViewSwitch params={params} />
          )
        }
      />

      <div className="rv-filters">
        {sinceOff ? (
          <Chip href={link({})} active={false}>{REVIEW_SINCE_SUSPENDED}</Chip>
        ) : params.since === "all" ? (
          <Link href={link({ since: "default" })} className="rv-since">{REVIEW_SHOWING_ALL} · {REVIEW_SINCE_LABEL}</Link>
        ) : (
          <Link href={link({ since: "all" })} className="rv-since">
            {REVIEW_SINCE_LABEL} · {reviewOlderHidden(olderHidden)} · <span className="rv-since-act">{REVIEW_SHOW_ALL}</span>
          </Link>
        )}
        <span className="rv-divider" aria-hidden />
        <FilterChips as="nav" label="Whose" className="rv-chips">
          <Chip href={link({ who: "all" })} active={params.who === "all"}>Everyone</Chip>
          <Chip href={link({ who: "mine" })} active={params.who === "mine"}>Mine</Chip>
        </FilterChips>
        <FilterChips as="nav" label="Matters or leads" className="rv-chips">
          <Chip href={link({ kind: "both" })} active={params.kind === "both"}>All</Chip>
          <Chip href={link({ kind: "matter" })} active={params.kind === "matter"}>Matters</Chip>
          <Chip href={link({ kind: "lead" })} active={params.kind === "lead"}>Leads</Chip>
        </FilterChips>
        <div className="rv-search">
          <span className="rv-search-label" aria-hidden>Search</span>
          <ListSearch label="Search clients and marks" placeholder="Client or mark" defaultValue={params.q} hidden={searchHidden} clearHref={link({ q: "", i: 1 })} />
        </div>
      </div>

      {/* The owner's Sheet keeps the key numbers and the two strips above the table, as the Board does (Taylor, Nov 10). */}
      <KpiStrip owner kpis={kpis(buckets)} />
        </>
      ) : (
        <>
      <ListHeader title={REVIEW_NAME} tour="review-head" sub={reviewSubline(buckets)} />

      <ListToolbar
        search={{
          label: "Search clients and marks",
          placeholder: "Client or mark",
          defaultValue: params.q,
          hidden: searchHidden,
          clearHref: link({ q: "", i: 1 }),
        }}
        toggle={<ViewSwitch params={params} />}
      />

      <KpiStrip kpis={kpis(buckets)} />

      <FilterChips as="nav" label="Whose">
        <Chip href={link({ who: "all" })} active={params.who === "all"} count={countFor({ who: "all" })}>Everyone</Chip>
        <Chip href={link({ who: "mine" })} active={params.who === "mine"} count={countFor({ who: "mine" })}>Mine</Chip>
      </FilterChips>
      <FilterChips as="nav" label="Matters or leads">
        <Chip href={link({ kind: "both" })} active={params.kind === "both"} count={countFor({ kind: "both" })}>Both</Chip>
        <Chip href={link({ kind: "matter" })} active={params.kind === "matter"} count={countFor({ kind: "matter" })}>Matters</Chip>
        <Chip href={link({ kind: "lead" })} active={params.kind === "lead"} count={countFor({ kind: "lead" })}>Leads</Chip>
      </FilterChips>

      <FilterChips as="nav" label="Since">
        {sinceOff ? (
          <Chip href={link({})} active={false}>{REVIEW_SINCE_SUSPENDED}</Chip>
        ) : params.since === "all" ? (
          <Chip href={link({ since: "default" })} active={false}>{REVIEW_SHOWING_ALL} · {REVIEW_SINCE_LABEL}</Chip>
        ) : (
          <>
            <Chip href={link({ since: "default" })} active>{REVIEW_SINCE_LABEL} · {reviewOlderHidden(olderHidden)}</Chip>
            <Chip href={link({ since: "all" })} active={false}>{REVIEW_SHOW_ALL}</Chip>
          </>
        )}
      </FilterChips>
        </>
      )}

      {note && (
        <Notice tone="warn" role="status">
          {note}
        </Notice>
      )}
      {notice && (
        <Notice tone="warn" role="alert">
          {notice}
        </Notice>
      )}

      {shown.length === 0 ? (
        <EmptyState title={load.rows.length === 0 ? "Nothing to review" : "Nothing matches"}>
          {load.rows.length === 0 ? "Open matters and leads past first contact will show up here." : "Try another filter or search."}
        </EmptyState>
      ) : params.view === "cards" && cards ? (
        <>
          <PersonChips people={cards.people} personId={cards.personId} params={params} />
          <CardsDeck card={cards.card} pos={cards.pos} personId={cards.personId} personName={cards.people.find((p) => p.userId === cards.personId)?.name ?? null} note={cards.note} docs={cards.docs} timeZone={load.timeZone} {...common} />
        </>
      ) : params.view === "sheet" ? (
        <>
          {strips}
          <SheetView rows={shown} notes={sheetNotes} {...common} {...(sheetPerms ? { sheetEdit: { perms: sheetPerms } } : {})} />
        </>
      ) : (
        <>
          {strips}
          <ReviewBoard lanes={lanes} {...common} />
          {owner ? (
            <div className="rv-rest">
              <ReviewSection bucket="uspto" rows={rest.uspto} collapsed {...common} />
              <ReviewSection bucket="track" rows={rest.track} collapsed {...common} />
            </div>
          ) : (
            <>
              <ReviewSection bucket="uspto" rows={rest.uspto} collapsed {...common} />
              <ReviewSection bucket="track" rows={rest.track} collapsed {...common} />
            </>
          )}
        </>
      )}
      {card}
    </div>
  );
}
