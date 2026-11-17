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
import { EmptyState, LoadFailedCard, Notice, Pill, SheetCard, SheetScroll, SheetTable } from "@/components/ui";
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
  pastLoeView,
  boardStagesForChoice,
  filterByGroupChoice,
  firmHasPhases,
  parseGroupChoice,
  phaseGroupCounts,
} from "@/lib/matters/phase-group";
import { searchPlaceholder, BLANK, MATTERS_NAME, OWNER_COLUMN, TEAMMATE, UNASSIGNED, MATTER_GROUPS_NAV, MATTER_GROUP_ALL, MATTER_INTAKE_STAGES, MATTER_INTAKE_SHOW, MATTER_SHOWING_INTAKE, MATTER_BACK_TO_PAST_INTAKE, MATTER_ALL_INTAKE_BODY, MATTER_ALL_INTAKE_TITLE, MATTER_GROUP_EMPTY, MATTER_GROUP_LABEL, MATTER_PHASES_UNAVAILABLE, MATTER_STATUS_NAV } from "@/lib/ui/words";
import { resolveFirmSession } from "@/lib/firm/session";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { matterIdsNeedingReview } from "./list-utils";
import { MATTERS_LIST_VALUE, mattersViewFromParam } from "@/lib/matters/list-href";
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
export default async function MattersPage({ searchParams }: { searchParams: Promise<{ seg?: string; q?: string; view?: string; group?: string; intake?: string; open?: string | string[] }> }) {
  const rawParams = await searchParams;
  const { seg: segRaw, q, view, group: groupRaw, intake: intakeRaw } = rawParams;
  // No `view` opens the Board; the explicit list value (and any other value) is the list, as before.
  const boardView = mattersViewFromParam(view) === "board";
  const seg: SegmentKey = isSegment(segRaw) ? segRaw : "open";
  const search = (q ?? "").trim().slice(0, 80);

  let all: Matter[] = [];
  let loadError = false;
  try {
    all = await listMatters();
  } catch {
    loadError = true;
  }

  const [queue, members, leads, canCreateLitigation, stageRead, role] = await Promise.all([
    loadActiveQueue(),
    listMemberDirectory().catch(() => []),
    listLeads().catch(() => []),
    orgHasModule("litigation"),
    loadMatterStages().catch((error): MatterStageRead => ({ status: "unavailable", error })),
    resolveFirmSession().then((x) => (x.kind === "ok" ? x.role : null)),
  ]);

  // "Needs your review" means something only when the queue was reached.
  // Unconfigured or unavailable is never shown as "nothing to review".
  const reviewIds = queue.status === "ok" ? matterIdsNeedingReview(queue.items) : new Set<string>();
  const reviewItems = queue.status === "ok" ? reviewItemByMatter(queue.items) : new Map<string, string>();
  const stalledIds = new Set(summarizeDocket(all).stalled.map((m) => m.id));
  const sets = { review: reviewIds, stalled: stalledIds };

  // Phase groups (Intake / Pre-filing / Post-filing / Matters). Drawn only for a firm whose stages carry a phase: a
  // database with no phase column, or stages with none set, sees today's page. A FAILED read says so and shows today's page.
  const stageList = stageRead.status === "unavailable" ? [] : stageRead.stages;
  const phasesFailed = stageRead.status === "unavailable";
  const grouped = stageRead.status === "ok" && firmHasPhases(stageList);
  // The default group depends on the status chip (Pre-filing only while it holds a matter under that filter), so it is
  // worked out for every status once; a link that omits `group` means "the default for the status it names".
  // Only matters past Signed LOE are drawn: a matter on an intake-phase stage is counted and named in one line instead.
  const intakeView = grouped ? pastLoeView(all, stageList, intakeStageIds(stageList)) : null;
  const pastLoe = intakeView ? intakeView.matters : all;
  const groupCountsBySeg = new Map(SEGMENTS.map((s) => [s.key, phaseGroupCounts(filterBySegment(pastLoe, s.key, sets))]));
  const defaultFor = (s: SegmentKey) => defaultGroupChoice(groupCountsBySeg.get(s)!);
  const group = parseGroupChoice(groupRaw) ?? defaultFor(seg);
  // `?intake=1` (reached from the notice line) lists the matters still in intake stages, and nothing else.
  const showIntake = !!intakeView && intakeRaw === "1";
  const inGroup = showIntake ? intakeView.intake : grouped ? filterByGroupChoice(pastLoe, group) : all;
  const counts = new Map(SEGMENTS.map((s) => [s.key, filterBySegment(inGroup, s.key, sets).length]));
  const groupCounts = phaseGroupCounts(filterBySegment(pastLoe, seg, sets));
  const drawableStages = intakeView ? intakeView.stages : stageList;
  // Four chips. Review only when the queue was reached; the bands stay as headings below.
  const segments = LIST_CHIPS.filter((s) => s.key !== "review" || queue.status === "ok");

  const shown = searchMatters(filterBySegment(inGroup, seg, sets), search);
  const boardStages = showIntake ? stageList.filter((s) => !drawableStages.some((d) => d.id === s.id)) : grouped ? boardStagesForChoice(drawableStages, group, shown) : stageList;
  const bands = groupIntoBands(shown);
  // The intake line is about the Open chip only; with a search it counts the matches only.
  const stillInIntake = intakeView && seg === "open" ? searchMatters(filterBySegment(intakeView.intake, seg, sets), search).length : 0;
  const everyMatterInIntake = !showIntake && !!intakeView && all.length > 0 && pastLoe.length === 0;
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
  const cards = buildMatterCards({
    matters: shown,
    ctx: {
      role,
      members: memberRead,
      stages: stageRead.status === "unavailable" ? { status: "unavailable" } : { status: "ok", value: stageList.map((s) => ({ id: s.id, label: s.label })) },
      mergeAvailable: false,
      path: "/dashboard/matters/",
      params: rawParams as Record<string, string | string[] | undefined>,
      now: new Date(),
      timeZone: firmZone,
    },
    steps: stepsRead,
  });
  const openRef = parseCardOpen(rawParams.open);

  const href = (next: { seg?: string; q?: string; view?: string | null; group?: string; intake?: boolean }) => {
    const p = new URLSearchParams();
    if (next.intake ?? showIntake) p.set("intake", "1");
    const g = next.group ?? group;
    const s = (next.seg ?? seg) as SegmentKey;
    if (grouped && g !== defaultFor(s)) p.set("group", g);
    if (s !== "open") p.set("seg", s);
    const term = next.q ?? search;
    if (term) p.set("q", term);
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
          hidden: { ...(boardView ? {} : { view: MATTERS_LIST_VALUE }), ...(seg !== "open" ? { seg } : {}), ...(grouped && group !== defaultFor(seg) ? { group } : {}), ...(showIntake ? { intake: "1" } : {}) },
          clearHref: href({ q: "" }),
        }}
        toggle={<ViewToggle value={boardView ? "board" : "table"} hrefFor={(next) => href({ view: next === "board" ? null : MATTERS_LIST_VALUE })} />}
        primary={<OpenMatterButton />}
      />

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
      {phasesFailed && (
        <Notice tone="warn" role="status">
          {MATTER_PHASES_UNAVAILABLE}
        </Notice>
      )}
      {queue.status === "unavailable" && (
        <Notice tone="warn" role="status">
          The approval queue can&apos;t be reached right now, so matters can&apos;t be checked for drafts waiting on review.
        </Notice>
      )}

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
          moveStages={showIntake ? stageList : drawableStages}
          collapseEmpty={grouped}
          matters={shown}
          canMove={!!role && MATTER_WRITE_ROLES.includes(role)}
          reviewIds={reviewIds}
          reviewItems={reviewItems}
          ownerName={(id) => (id ? memberName.get(id) ?? TEAMMATE : null)}
          cards={cards}
        />
        </>
      ) : bands.length === 0 ? (
        all.length === 0 ? (
          <EmptyState title="No matters yet" action={<OpenMatterButton />}>
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
            <SheetScroll>
              <SheetTable fixed minWidth={800}>
                <colgroup>
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "17%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "5%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Matter</th>
                    <th>Type</th>
                    <th>Stage</th>
                    <th className="num">In stage</th>
                    <th>{OWNER_COLUMN}</th>
                    <th>Next step</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {band.matters.map((m) => {
                    const age = stageAge(m);
                    const note = statusNote(m.status);
                    const reviewId = reviewItems.get(m.id);
                    const rc = cards[m.id];
                    return (
                      <tr key={m.id} className="lp-row">
                        <td className="pri">
                          <Link href={rc.openHref} scroll={false} data-card-open="" className="lx-rowlink">
                            {matterLabel(m)}
                          </Link>
                          <div className="lx-note mt-sub">
                            {m.matter_number}
                            {m.owner_name ? ` · ${m.owner_name}` : ""}
                            {note ? ` · ${note}` : ""}
                            {reviewIds.has(m.id) && (
                              <>
                                {" "}
                                {reviewId ? (
                                  <Link href={reviewHref(reviewId)} className="lx-pill lx-pill-warn">
                                    Review
                                  </Link>
                                ) : (
                                  <Pill tone="warn">Review</Pill>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                        <td data-label="Type">{MATTER_TYPE_LABEL[m.type]}</td>
                        <td data-label="Stage">{rc.edits.stage ? <StagePick kind="matter" id={m.id} name={matterLabel(m)} stage={rc.stage} /> : m.stage ? <Pill wrap>{stageDisplayName(m.stage.label)}</Pill> : BLANK}</td>
                        <td className="num" data-label="In stage">
                          {age.days === null ? BLANK : age.stale ? <Pill num tone="risk">{age.days}d</Pill> : `${age.days}d`}
                        </td>
                        <td data-label={OWNER_COLUMN}>{rc.edits.owner ? <OwnerPick kind="matter" id={m.id} name={matterLabel(m)} owner={rc.owner} /> : m.assigned_to ? memberName.get(m.assigned_to) ?? TEAMMATE : UNASSIGNED}</td>
                        <td data-label="Next step">
                          <NextStepLine kind="matter" id={m.id} line={rc.nextStep} dueIso={rc.dueIso} text={rc.bottom.nextStep} />
                        </td>
                        <td data-label="Actions">
                          <MatterCardMenu card={rc} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </SheetTable>
            </SheetScroll>
          </SheetCard>
        ))
      )}
      {openRef ? <RecordCardHost open={openRef} path="/dashboard/matters/" params={rawParams as Record<string, string | string[] | undefined>} /> : null}
    </div>
  );
}
