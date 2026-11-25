import Link from "next/link";
import { listMatters, summarizeDocket, type Matter } from "@/lib/matters";
import { listLeads } from "@/lib/pipeline";
import { listMemberDirectory } from "@/lib/members/directory";
import { loadActiveQueue } from "@/lib/queue/load";
import { orgHasModule } from "@/lib/org/modules";
import { matterLabel } from "@/lib/matters/docket-summary";
import {
  BAND_COPY,
  SEGMENTS,
  filterBySegment,
  groupIntoBands,
  isSegment,
  searchMatters,
  stageAge,
  type SegmentKey,
} from "@/lib/matters/worklist";
import { EmptyState, LoadFailedCard, Notice, SheetCard } from "@/components/ui";
import { ViewToggle } from "@/components/ViewToggle";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar } from "@/components/list-page/ListToolbar";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import "@/components/list-page/list-page.css";
import "./matters.css";
import { NewMatterForm } from "@/components/matters/MatterForms";
import { MatterBoard } from "@/components/matters/MatterBoard";
import { MovedOutNotice } from "@/components/matters/MovedOutNotice";
import { loadMatterStages, type MatterStageRead } from "@/lib/matters/stages";
import {
  defaultGroupChoice,
  DRAWN_GROUPS,
  ALL_GROUPS,
  intakeStageIds,
  boardStagesForGroup,
  matterMoveStages,
  pastLoeView,
  boardStagesForChoice,
  filterByGroupChoice,
  firmHasPhases,
  parseGroupChoice,
  phaseGroupCounts,
} from "@/lib/matters/phase-group";
import { searchPlaceholder, BLANK, MATTERS_NAME, OWNER_COLUMN, TEAMMATE, UNASSIGNED, MATTER_GROUPS_NAV, MATTER_GROUP_ALL, MATTER_INTAKE_STAGES, MATTER_INTAKE_SHOW, MATTER_SHOWING_INTAKE, MATTER_BACK_TO_PAST_INTAKE, MATTER_ALL_INTAKE_BODY, MATTER_ALL_INTAKE_TITLE, MATTER_GROUP_EMPTY, MATTER_GROUP_LABEL, MATTER_PHASES_UNAVAILABLE, MATTER_STATUS_NAV, CONTRACTS_NAME, MATTER_KIND_NAV, HIDDEN_FIRM_COLUMN, DEADLINE_FLAGS_UNCHECKED, NO_MAINTENANCE_DEADLINE_HINT, NO_OPEN_DEADLINE, NO_OPEN_DEADLINE_HINT } from "@/lib/ui/words";
import { inPreview, resolveViewSession } from "@/lib/views/view-as";
import { loadOwnerState } from "@/lib/views/layout/owner-load";
import { isOwner } from "@/lib/views/layout/owner";
import { loadStageHoldings } from "@/lib/stages/holdings";
import { loadViewLayout } from "@/lib/views/layout/load";
import { layoutNote, savedLayoutOf } from "@/lib/views/layout/state";
import { resolveLayout } from "@/lib/views/layout/apply";
import { HiddenColumnsMenu, type HiddenGroup } from "@/components/views/layout/HiddenColumnsMenu";
import { MatterListTable } from "@/components/matters/MatterListTable";
import { ManageStages } from "@/components/matters/ManageStages";
import { MATTER_VIEW_KEYS, drawnMatterColumns, filterByMatterKind, matterListColumns, parseMatterKind, type MatterKind } from "@/lib/matters/views";
import { loadMatterListExtras } from "@/lib/matters/list-extras";
import { canSeeCustomMoney, customCells } from "@/lib/custom-columns/rules";
import { civilDateIn } from "@/lib/review/build";
import { isRegisteredTrademark, needsDeadlineCheck, noOpenDeadline, noOpenDeadlineHint } from "@/lib/matters/deadline-safety";
import { loadOpenDeadlineMatterIds } from "@/lib/matters/open-deadlines-read";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { matterIdsNeedingReview } from "./list-utils";
import { MATTERS_LIST_VALUE, mattersViewFromParam } from "@/lib/matters/list-href";
import { sortStagesByOrder } from "@/lib/matters/board";
import { LIST_CHIPS, mattersSubtitle, reviewHref, reviewItemByMatter, stageDisplayName, statusNote } from "@/lib/matters/list-view";
import { OPEN_MATTER_PANEL_ID, OpenMatterButton } from "@/components/matters/OpenMatterButton";
import { MATTER_TYPE_LABEL } from "./labels";
import { RecordCardHost } from "@/components/record-card/RecordCardHost";
import { NextStepLine, OwnerPick, StagePick } from "@/components/record-card/controls";
import { MatterCardMenu } from "@/components/record-card/MatterBits";
import { buildMatterCards } from "@/lib/record-card/matter-cards";
import { parseCardOpen } from "@/lib/record-card/open";
import { loadOpenSteps } from "@/lib/record-card/steps-read";
import { getFirmTimeZone } from "@/lib/org/profile";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import type { CardMember, CardRead } from "@/lib/record-card/model";
import { leadLabel } from "@/lib/record-card/lead-label";
import "@/components/record-card/record-card.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle(MATTERS_NAME) };

export const dynamic = "force-dynamic";

/**
 * The docket as a worklist: one band per whose-move-is-it, from the design.
 * Filters are links (a filtered worklist is a shareable URL); the server
 * re-filters on navigation.
 */
export default async function MattersPage({ searchParams }: { searchParams: Promise<{ seg?: string; q?: string; view?: string; group?: string; intake?: string; kind?: string | string[]; open?: string | string[] }> }) {
  const rawParams = await searchParams;
  const { seg: segRaw, q, view, group: groupRaw, intake: intakeRaw } = rawParams;
  // No `view` opens the Board; the explicit list value (and any other value) is the list, as before.
  const boardView = mattersViewFromParam(view) === "board";
  const seg: SegmentKey = isSegment(segRaw) ? segRaw : "open";
  // Two views over one docket: Trademarks (no `kind`, every old link) and Contracts (`?kind=contracts`). Each has a List and a Board.
  const kind: MatterKind = parseMatterKind(rawParams.kind);
  const layoutView = boardView ? MATTER_VIEW_KEYS[kind].board : MATTER_VIEW_KEYS[kind].list;
  const search = (q ?? "").trim().slice(0, 80);

  let all: Matter[] = [];
  let loadError = false;
  try {
    all = await listMatters();
  } catch {
    loadError = true;
  }

  // Deadline safety (PGE Sprint 3): which filed and registered trademarks hold an open deadline (a registered one needs a
  // Section 8 / renewal deadline, Taylor Nov 23). Only those matters are asked about; a failed read flags nothing and says so.
  const filedIds = all.filter((m) => needsDeadlineCheck(m)).map((m) => m.id);
  const [queue, members, leads, canCreateLitigation, stageRead, session, openDeadlineRead, layoutRead, ownerRead, previewing] = await Promise.all([
    loadActiveQueue(),
    listMemberDirectory().catch(() => []),
    listLeads().catch(() => []),
    orgHasModule("litigation"),
    loadMatterStages().catch((error): MatterStageRead => ({ status: "unavailable", error })),
    resolveViewSession(),
    loadOpenDeadlineMatterIds(filedIds),
    // The firm's saved layout for the view being drawn (three-state; anything but a read row draws the standard columns), and whether
    // this viewer may CHANGE the view: an owner by their own membership row, never while previewing a teammate.
    loadViewLayout(layoutView),
    loadOwnerState(),
    inPreview(),
  ]);
  const role = session.kind === "ok" ? session.role : null;
  const savedLayout = savedLayoutOf(layoutRead);
  const layoutSaid = layoutNote(layoutRead);
  const ownerNow = isOwner(ownerRead) && !previewing;
  const layoutEdit = ownerNow && layoutRead.status === "ok" ? { view: layoutView, rev: layoutRead.rev } : null;
  const openDeadlineIds = openDeadlineRead.status === "ok" ? openDeadlineRead.ids : null;

  // "Needs your review" means something only when the queue was reached.
  // Unconfigured or unavailable is never shown as "nothing to review".
  const reviewIds = queue.status === "ok" ? matterIdsNeedingReview(queue.items) : new Set<string>();
  const reviewItems = queue.status === "ok" ? reviewItemByMatter(queue.items) : new Map<string, string>();
  const stalledIds = new Set(summarizeDocket(all).stalled.map((m) => m.id));
  const byKind = { trademarks: filterByMatterKind(all, "trademarks"), contracts: filterByMatterKind(all, "contracts") };
  const scoped = byKind[kind];
  const sets = { review: reviewIds, stalled: stalledIds };

  // Phase groups (Intake / Pre-filing / Post-filing / Matters). Drawn only for a firm whose stages carry a phase: a
  // database with no phase column, or stages with none set, sees today's page. A FAILED read says so and shows today's page.
  const stageList = stageRead.status === "unavailable" ? [] : stageRead.stages;
  const phasesFailed = stageRead.status === "unavailable";
  // Phase groups and the past-signed-LOE cut are the Trademarks view's; Contracts has no phases to group by and is never cut.
  const phasesOn = stageRead.status === "ok" && firmHasPhases(stageList);
  const grouped = kind === "trademarks" && phasesOn;
  // What the Matters chip counts: the trademark matters past the signed engagement (all of them for a firm that has no such stage).
  const trademarksPastLoe = phasesOn ? pastLoeView(byKind.trademarks, stageList, intakeStageIds(stageList)).matters : byKind.trademarks;
  // The default group depends on the status chip (Pre-filing only while it holds a matter under that filter), so it is
  // worked out for every status once; a link that omits `group` means "the default for the status it names".
  // Only matters past Signed LOE are drawn: a matter on an intake-phase stage is counted and named in one line instead.
  // A firm with no signed-engagement stage cuts nothing (`intakeStageIds` is empty): a record is never hidden on a guess.
  const intakeView = grouped ? pastLoeView(scoped, stageList, intakeStageIds(stageList)) : null;
  const pastLoe = intakeView ? intakeView.matters : scoped;
  const groupCountsBySeg = new Map(SEGMENTS.map((s) => [s.key, phaseGroupCounts(filterBySegment(pastLoe, s.key, sets))]));
  const defaultFor = (s: SegmentKey) => defaultGroupChoice(groupCountsBySeg.get(s)!);
  const group = parseGroupChoice(groupRaw) ?? defaultFor(seg);
  // `?intake=1` (reached from the notice line) lists the matters still in intake stages, and nothing else.
  const showIntake = !!intakeView && intakeRaw === "1";
  const inGroup = showIntake ? intakeView.intake : grouped ? filterByGroupChoice(pastLoe, group) : scoped;
  const counts = new Map(SEGMENTS.map((s) => [s.key, filterBySegment(inGroup, s.key, sets).length]));
  const groupCounts = phaseGroupCounts(filterBySegment(pastLoe, seg, sets));
  const drawableStages = intakeView ? intakeView.stages : stageList;
  // One list for every move control on this page (card, card menu, board drag): never an intake-phase stage while grouped.
  const moveStages = matterMoveStages(stageList, drawableStages, showIntake);
  // Four chips. Review only when the queue was reached; the bands stay as headings below.
  const segments = LIST_CHIPS.filter((s) => s.key !== "review" || queue.status === "ok");

  const shown = searchMatters(filterBySegment(inGroup, seg, sets), search);
  // Contracts: the stages with no filing phase (and any stage holding a contract), empty ones folded into one row.
  const contractStages = kind === "contracts" && stageRead.status === "ok" && firmHasPhases(stageList) ? boardStagesForGroup(stageList, "other", shown) : stageList;
  const boardStages = showIntake ? stageList.filter((s) => !drawableStages.some((d) => d.id === s.id)) : grouped ? boardStagesForChoice(drawableStages, group, shown) : contractStages;
  const collapseEmpty = grouped || kind === "contracts";
  const bands = groupIntoBands(shown);
  // The intake line is about the chip in use (the intake matters are left out of every chip, so each says how many it
  // left out); with a search it counts the matches only. "Show them" keeps the chip.
  const stillInIntake = intakeView ? searchMatters(filterBySegment(intakeView.intake, seg, sets), search).length : 0;

  // The owner's stage menu on the docket board (spec-editable-views.md 3b): an owner MEMBERSHIP ROW, never in a preview, and only
  // when the stage list was read. What each stage holds (every matter, any status) is read then, for the delete dialog; a failed
  // read offers no delete and no open/closed change. Every action asks the row again.
  const stageOwner = boardView && stageRead.status !== "unavailable" && ownerNow;
  const stageAdmin = stageOwner
    ? {
        all: stageList.map((s) => ({ id: s.id, name: s.label, isOpen: s.is_open, role: s.role ?? null })),
        holdings: await loadStageHoldings("matter").then((h) => (h.status === "ok" ? h.byStage : null)),
      }
    : null;
  const everyMatterInIntake = !showIntake && !!intakeView && scoped.length > 0 && pastLoe.length === 0;
  // Manage stages (owner): every matter stage, the closed and the left-out intake ones included, each with the board column's stage menu.
  const orderedStages = sortStagesByOrder(stageList);
  const manageStages = stageAdmin
    ? {
        stages: orderedStages.map((s) => ({ id: s.id, name: s.label, isOpen: s.is_open, role: s.role ?? null })),
        leftOut: grouped ? intakeStageIds(stageList) : new Set<string>(),
      }
    : null;
  const memberName = new Map(members.map((m) => [m.userId, m.displayName ?? m.email ?? TEAMMATE]));
  const leadOptions = leads.map((l) => ({
    id: l.id,
    // The person's name first, the company beside it (Taylor, Nov 17 call); the company stands in only with no person's name.
    label: [leadLabel(l).name, leadLabel(l).sub, l.email && l.email !== leadLabel(l).name ? l.email : null].filter(Boolean).join(" · "),
  }));

  // Sprint 10 Part 2: what each role may do on each matter, the open link and the next-step line. A matter on screen is either in
  // `shown`; its steps are one batched read, three-state (a failed one says so on the card and is never "No next step").
  const stepsRead = loadError ? ({ status: "unavailable" } as const) : await loadOpenSteps("matter", shown.map((m) => m.id));
  const memberRead: CardRead<CardMember[]> = members.length > 0 ? { status: "ok", value: members.map((m) => ({ userId: m.userId, name: (m.displayName ?? m.email ?? "").trim() || TEAMMATE })) } : { status: "unavailable" };
  const firmZone = await getFirmTimeZone().catch(() => DEFAULT_TIME_ZONE);
  // The List's own reads (never the Board's): the firm's columns and the Notes column's notes. A hidden Notes column reads no notes.
  const canMoneyColumns = session.kind === "ok" && canSeeCustomMoney(session.role, session.actingAsStaff);
  const notesShown = savedLayout?.find((c) => c.key === "notes")?.hidden !== true;
  const extras = !boardView && !loadError && shown.length > 0 ? await loadMatterListExtras({ matters: shown, withNotes: notesShown, timeZone: firmZone, canSeeMoney: canMoneyColumns }) : null;
  const firmFields = extras?.custom.status === "ok" ? extras.custom.fields : [];
  const listColumns = matterListColumns(firmFields, kind, canMoneyColumns);
  const drawnColumns = drawnMatterColumns(listColumns, savedLayout);
  const todayCivil = civilDateIn(new Date(), firmZone);
  const firmCells =
    extras?.custom.status === "ok"
      ? customCells(shown.map((m) => ({ key: m.id, kind: "matter" as const, id: m.id, matterType: m.type })), firmFields, extras.custom, members.map((m) => ({ userId: m.userId, name: (m.displayName ?? m.email ?? "").trim() || TEAMMATE })), todayCivil)
      : {};
  const fieldMeta = Object.fromEntries(firmFields.map((f) => [`cf:${f.id.toLowerCase()}`, { kind: f.kind as string, options: f.options as readonly string[] }]));
  // The owner's "Hidden columns" for the List: the columns the firm's layout hides, each with Show.
  const hiddenListGroups: HiddenGroup[] | null =
    layoutEdit && !boardView
      ? (() => {
          const known = new Set(listColumns.map((c) => c.key));
          const items = resolveLayout(listColumns, savedLayout)
            .filter((r) => r.hidden)
            .map((r) => ({ key: r.key, label: r.label }));
          // A hidden firm column whose fields weren't read this time: still listed, under a fixed name, so it can be brought back.
          for (const c of savedLayout ?? []) if (c.hidden && c.key.startsWith("cf:") && !known.has(c.key)) items.push({ key: c.key, label: HIDDEN_FIRM_COLUMN });
          return [{ view: layoutView, rev: layoutEdit.rev, items }];
        })()
      : null;
  const cards = buildMatterCards({
    matters: shown,
    ctx: {
      role,
      members: memberRead,
      stages: stageRead.status === "unavailable" ? { status: "unavailable" } : { status: "ok", value: moveStages.map((s) => ({ id: s.id, label: s.label })) },
      mergeAvailable: false,
      path: "/dashboard/matters/",
      params: rawParams as Record<string, string | string[] | undefined>,
      now: new Date(),
      timeZone: firmZone,
    },
    steps: stepsRead,
  });
  const openRef = parseCardOpen(rawParams.open);

  const href = (next: { seg?: string; q?: string; view?: string | null; group?: string; intake?: boolean; kind?: MatterKind }) => {
    const p = new URLSearchParams();
    // Switching between Matters and Contracts starts the other view fresh: its groups and its intake line are not this one's.
    const switching = next.kind !== undefined && next.kind !== kind;
    const k = next.kind ?? kind;
    if (!switching && (next.intake ?? showIntake)) p.set("intake", "1");
    const g = next.group ?? group;
    const s = (next.seg ?? seg) as SegmentKey;
    if (!switching && grouped && g !== defaultFor(s)) p.set("group", g);
    if (s !== "open") p.set("seg", s);
    const term = next.q ?? search;
    if (term) p.set("q", term);
    if (k === "contracts") p.set("kind", "contracts");
    const v = next.view === undefined ? (boardView ? null : MATTERS_LIST_VALUE) : next.view;
    if (v) p.set("view", v);
    const qs = p.toString();
    return `/dashboard/matters/${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="lp-root">
      <ListHeader title={MATTERS_NAME} tour="matters-head" sub={mattersSubtitle(boardView ? "board" : "table")} />

      <ListToolbar
        search={{
          label: searchPlaceholder("matters"),
          placeholder: searchPlaceholder("matters"),
          defaultValue: search,
          hidden: { ...(boardView ? {} : { view: MATTERS_LIST_VALUE }), ...(kind === "contracts" ? { kind } : {}), ...(seg !== "open" ? { seg } : {}), ...(grouped && group !== defaultFor(seg) ? { group } : {}), ...(showIntake ? { intake: "1" } : {}) },
          clearHref: href({ q: "" }),
        }}
        toggle={<ViewToggle value={boardView ? "board" : "table"} hrefFor={(next) => href({ view: next === "board" ? null : MATTERS_LIST_VALUE })} />}
        more={hiddenListGroups ? <HiddenColumnsMenu groups={hiddenListGroups} /> : undefined}
        primary={<OpenMatterButton />}
      />

      <FilterChips as="nav" label={MATTER_KIND_NAV}>
        <Chip href={href({ kind: "trademarks" })} active={kind === "trademarks"} count={filterBySegment(trademarksPastLoe, "open", sets).length}>
          {MATTERS_NAME}
        </Chip>
        <Chip href={href({ kind: "contracts" })} active={kind === "contracts"} count={filterBySegment(byKind.contracts, "open", sets).length}>
          {CONTRACTS_NAME}
        </Chip>
      </FilterChips>

      {grouped && !showIntake && (
        <FilterChips as="nav" label={MATTER_GROUPS_NAV}>
          {DRAWN_GROUPS.map((g) => (
            <Chip key={g} href={href({ group: g })} active={group === g} count={groupCounts[g]}>
              {MATTER_GROUP_LABEL[g]}
            </Chip>
          ))}
          <Chip href={href({ group: ALL_GROUPS })} active={group === ALL_GROUPS} count={DRAWN_GROUPS.reduce((n, g) => n + groupCounts[g], 0)}>
            {MATTER_GROUP_ALL}
          </Chip>
        </FilterChips>
      )}
      <FilterChips as="nav" label={MATTER_STATUS_NAV}>
        {segments.map((s) => (
          <Chip key={s.key} href={href({ seg: s.key })} active={seg === s.key} count={counts.get(s.key) ?? 0}>
            {s.label}
          </Chip>
        ))}
      </FilterChips>
      {showIntake && (
        <p role="status" className="lx-note lx-state-line">
          {MATTER_SHOWING_INTAKE} <Link href={href({ intake: false })}>{MATTER_BACK_TO_PAST_INTAKE}</Link>
        </p>
      )}
      {!showIntake && stillInIntake > 0 && (
        <p role="status" className="lx-note lx-state-line">
          {MATTER_INTAKE_STAGES(stillInIntake, !!search)} · <Link href={href({ intake: true })}>{MATTER_INTAKE_SHOW}</Link>
        </p>
      )}
      {layoutSaid && (
        <Notice tone="warn" role="status">
          {layoutSaid}
        </Notice>
      )}
      {phasesFailed && (
        <Notice tone="warn" role="status">
          {MATTER_PHASES_UNAVAILABLE}
        </Notice>
      )}
      {openDeadlineIds === null && filedIds.length > 0 && (
        <Notice tone="warn" role="status">
          {DEADLINE_FLAGS_UNCHECKED}
        </Notice>
      )}
      {queue.status === "unavailable" && (
        <Notice tone="warn" role="status">
          The approval queue can&apos;t be reached right now, so matters can&apos;t be checked for drafts waiting on review.
        </Notice>
      )}

      {boardView && manageStages && stageAdmin && <ManageStages stages={manageStages.stages} holdings={stageAdmin.holdings} leftOut={manageStages.leftOut} />}

      <details id={OPEN_MATTER_PANEL_ID} className="lx-card lx-disclosure">
        <summary>Open a matter</summary>
        <NewMatterForm leads={leadOptions} canCreateLitigation={canCreateLitigation} />
      </details>

      {loadError ? (
        <LoadFailedCard what="matters" />
      ) : boardView && shown.length > 0 ? (
        <>
        {grouped && !showIntake && <MovedOutNotice />}
        <MatterBoard
          stages={boardStages}
          moveStages={moveStages}
          collapseEmpty={collapseEmpty}
          matters={shown}
          canMove={!!role && MATTER_WRITE_ROLES.includes(role)}
          reviewIds={reviewIds}
          reviewItems={reviewItems}
          noDeadlineIds={new Set(shown.filter((m) => noOpenDeadline(m, openDeadlineIds)).map((m) => m.id))}
          registeredNoDeadlineIds={new Set(shown.filter((m) => noOpenDeadline(m, openDeadlineIds) && isRegisteredTrademark(m)).map((m) => m.id))}
          ownerName={(id) => (id ? memberName.get(id) ?? TEAMMATE : null)}
          cards={cards}
          stageAdmin={stageAdmin}
          layout={savedLayout}
          layoutEdit={layoutEdit}
        />
        </>
      ) : bands.length === 0 ? (
        scoped.length === 0 ? (
          <EmptyState title={kind === "contracts" ? "No contracts yet" : "No matters yet"} action={<OpenMatterButton />}>
            A matter opens when a lead signs, or from the form above.
          </EmptyState>
        ) : everyMatterInIntake ? (
          <EmptyState title={MATTER_ALL_INTAKE_TITLE}>{MATTER_ALL_INTAKE_BODY}</EmptyState>
        ) : (
          <EmptyState title="Nothing matches">
            {grouped && !search ? MATTER_GROUP_EMPTY(group) : "Try another filter or search."}
          </EmptyState>
        )
      ) : (
        bands.map((band) => (
          <SheetCard as="section" key={band.key} className="lx-band" aria-labelledby={`band-${band.key}`}>
            <header className="lx-band-head">
              <h2 id={`band-${band.key}`} className="lx-h2">
                {BAND_COPY[band.key].label}
              </h2>
              <span className="lx-note">
                {band.matters.length} · {BAND_COPY[band.key].hint}
              </span>
            </header>
            <MatterListTable
              matters={band.matters}
              columns={drawnColumns}
              kind={kind}
              layoutEdit={layoutEdit}
              fieldMeta={fieldMeta}
              cards={cards}
              memberName={memberName}
              reviewIds={reviewIds}
              reviewItems={reviewItems}
              openDeadlineIds={openDeadlineIds}
              firmCells={firmCells}
              notes={extras?.notes ?? null}
              canWrite={!!role && MATTER_WRITE_ROLES.includes(role) && !previewing}
              today={todayCivil}
            />
          </SheetCard>
        ))
      )}
      {!boardView && !loadError && !previewing && !!role && MATTER_WRITE_ROLES.includes(role) && (
        <div className="lx-list-add">
          <OpenMatterButton />
        </div>
      )}
      {openRef ? <RecordCardHost open={openRef} path="/dashboard/matters/" params={rawParams as Record<string, string | string[] | undefined>} moveStages={stageRead.status === "unavailable" ? undefined : moveStages} /> : null}
    </div>
  );
}
