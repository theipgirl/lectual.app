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
import { ViewToggle } from "@/components/ViewToggle";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar } from "@/components/list-page/ListToolbar";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import "@/components/list-page/list-page.css";
import { NewMatterForm } from "@/components/matters/MatterForms";
import { MatterBoard } from "@/components/matters/MatterBoard";
import { MovedOutNotice } from "@/components/matters/MovedOutNotice";
import { loadMatterStages, type MatterStageRead } from "@/lib/matters/stages";
import {
  defaultGroupChoice,
  PHASE_GROUPS,
  ALL_GROUPS,
  boardStagesForChoice,
  filterByGroupChoice,
  firmHasPhases,
  parseGroupChoice,
  phaseGroupCounts,
} from "@/lib/matters/phase-group";
import { MATTER_GROUPS_NAV, MATTER_GROUP_ALL, MATTER_GROUP_EMPTY, MATTER_GROUP_LABEL, MATTER_PHASES_UNAVAILABLE, MATTER_STATUS_NAV } from "@/lib/ui/words";
import { resolveFirmSession } from "@/lib/firm/session";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { matterIdsNeedingReview } from "./list-utils";
import { MATTERS_LIST_VALUE, mattersViewFromParam } from "@/lib/matters/list-href";
import { LIST_CHIPS, mattersSubtitle, reviewHref, reviewItemByMatter, stageDisplayName, statusNote } from "@/lib/matters/list-view";
import { OPEN_MATTER_PANEL_ID, OpenMatterButton } from "@/components/matters/OpenMatterButton";
import { MATTER_TYPE_LABEL } from "./labels";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Matters") };

export const dynamic = "force-dynamic";

/**
 * The docket as a worklist: one band per whose-move-is-it, from the design.
 * Filters are links (a filtered worklist is a shareable URL); the server
 * re-filters on navigation.
 */
export default async function MattersPage({ searchParams }: { searchParams: Promise<{ seg?: string; q?: string; view?: string; group?: string }> }) {
  const { seg: segRaw, q, view, group: groupRaw } = await searchParams;
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
  const groupCountsBySeg = new Map(SEGMENTS.map((s) => [s.key, phaseGroupCounts(filterBySegment(all, s.key, sets))]));
  const defaultFor = (s: SegmentKey) => defaultGroupChoice(groupCountsBySeg.get(s)!);
  const group = parseGroupChoice(groupRaw) ?? defaultFor(seg);
  const inGroup = grouped ? filterByGroupChoice(all, group) : all;
  const counts = new Map(SEGMENTS.map((s) => [s.key, filterBySegment(inGroup, s.key, sets).length]));
  const groupCounts = phaseGroupCounts(filterBySegment(all, seg, sets));
  // Four chips. Review only when the queue was reached; the bands stay as headings below.
  const segments = LIST_CHIPS.filter((s) => s.key !== "review" || queue.status === "ok");

  const shown = searchMatters(filterBySegment(inGroup, seg, sets), search);
  const boardStages = grouped ? boardStagesForChoice(stageList, group, shown) : stageList;
  const bands = groupIntoBands(shown);
  const memberName = new Map(members.map((m) => [m.userId, m.displayName ?? m.email ?? "Teammate"]));
  const leadOptions = leads.map((l) => ({
    id: l.id,
    label: [l.business_name?.trim() || `${l.first_name} ${l.last_name}`.trim(), l.email].filter(Boolean).join(" · "),
  }));

  const href = (next: { seg?: string; q?: string; view?: string | null; group?: string }) => {
    const p = new URLSearchParams();
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
      <ListHeader title="Matters" tour="matters-head" sub={mattersSubtitle(boardView ? "board" : "table")} />

      <ListToolbar
        search={{
          label: "Search matters",
          placeholder: "Mark, number, owner or serial",
          defaultValue: search,
          hidden: { ...(boardView ? {} : { view: MATTERS_LIST_VALUE }), ...(seg !== "open" ? { seg } : {}), ...(grouped && group !== defaultFor(seg) ? { group } : {}) },
          clearHref: href({ q: "" }),
        }}
        toggle={<ViewToggle value={boardView ? "board" : "table"} hrefFor={(next) => href({ view: next === "board" ? null : MATTERS_LIST_VALUE })} />}
        primary={<OpenMatterButton />}
      />

      {grouped && (
        <FilterChips as="nav" label={MATTER_GROUPS_NAV}>
          {PHASE_GROUPS.map((g) => (
            <Chip key={g} href={href({ group: g })} active={group === g} count={groupCounts[g]}>
              {MATTER_GROUP_LABEL[g]}
            </Chip>
          ))}
          <Chip href={href({ group: ALL_GROUPS })} active={group === ALL_GROUPS} count={PHASE_GROUPS.reduce((n, g) => n + groupCounts[g], 0)}>
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
      {phasesFailed && (
        <p className="lx-banner lx-banner-warn" role="status" style={{ margin: 0 }}>
          {MATTER_PHASES_UNAVAILABLE}
        </p>
      )}
      {queue.status === "unavailable" && (
        <p className="lx-banner lx-banner-warn" role="status" style={{ margin: 0 }}>
          The approval queue can&apos;t be reached right now, so matters can&apos;t be checked for drafts waiting on review.
        </p>
      )}

      <details id={OPEN_MATTER_PANEL_ID} className="lx-card lx-disclosure">
        <summary>Open a matter</summary>
        <NewMatterForm leads={leadOptions} canCreateLitigation={canCreateLitigation} />
      </details>

      {loadError ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>Matters couldn&apos;t be loaded</h2>
          <p className="lx-note" style={{ margin: 0 }}>
            Can&apos;t show this right now. Refresh to try again.
          </p>
        </div>
      ) : boardView && shown.length > 0 ? (
        <>
        {grouped && <MovedOutNotice />}
        <MatterBoard
          stages={boardStages}
          moveStages={stageList}
          collapseEmpty={grouped}
          matters={shown}
          canMove={!!role && MATTER_WRITE_ROLES.includes(role)}
          reviewIds={reviewIds}
          reviewItems={reviewItems}
          ownerName={(id) => (id ? memberName.get(id) ?? "Teammate" : null)}
        />
        </>
      ) : bands.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>{all.length === 0 ? "No matters yet" : "Nothing matches"}</h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {all.length === 0
              ? "A matter opens when a lead signs, or from the form above."
              : grouped && !search
                ? MATTER_GROUP_EMPTY(group)
                : "Try another filter or search."}
          </p>
        </div>
      ) : (
        bands.map((band) => (
          <section key={band.key} className="lx-card lx-band" aria-labelledby={`band-${band.key}`}>
            <header className="lx-band-head">
              <h2 id={`band-${band.key}`} className="lx-h2">
                {BAND_COPY[band.key].label}
              </h2>
              <span className="lx-note">
                {band.matters.length} · {BAND_COPY[band.key].hint}
              </span>
            </header>
            <div style={{ overflow: "auto" }}>
              <table className="lx-tbl lx-stack">
                <colgroup>
                  <col style={{ width: "36%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "27%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Matter</th>
                    <th>Type</th>
                    <th>Stage</th>
                    <th>In stage</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {band.matters.map((m) => {
                    const age = stageAge(m);
                    const note = statusNote(m.status);
                    const reviewId = reviewItems.get(m.id);
                    return (
                      <tr key={m.id} className="lp-row">
                        <td className="pri">
                          <Link href={`/dashboard/matters/${m.id}/`} className="lx-rowlink">
                            {matterLabel(m)}
                          </Link>
                          <div className="lx-note mt-sub">
                            <span className="lx-num">{m.matter_number}</span>
                            {m.owner_name ? ` · ${m.owner_name}` : ""}
                            {note ? ` · ${note}` : ""}
                            {reviewIds.has(m.id) &&
                              (reviewId ? (
                                <Link href={reviewHref(reviewId)} className="lp-pill lp-pill-warn" style={{ marginLeft: 6, position: "relative", zIndex: 1 }}>
                                  Review
                                </Link>
                              ) : (
                                <span className="lp-pill lp-pill-warn" style={{ marginLeft: 6 }}>Review</span>
                              ))}
                          </div>
                        </td>
                        <td data-label="Type">{MATTER_TYPE_LABEL[m.type]}</td>
                        <td data-label="Stage">{m.stage ? <span className="lp-pill lp-pill-wrap">{stageDisplayName(m.stage.label)}</span> : <span className="lx-note">—</span>}</td>
                        <td className="lx-num" data-label="In stage">
                          {age.days === null ? "—" : age.stale ? <span className="lp-pill lp-pill-num lp-pill-risk">{age.days}d</span> : <span>{age.days}d</span>}
                        </td>
                        <td data-label="Owner">{m.assigned_to ? memberName.get(m.assigned_to) ?? "Teammate" : <span className="lx-note">Unassigned</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
