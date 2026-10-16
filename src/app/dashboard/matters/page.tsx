import Link from "next/link";
import { listMatters, summarizeDocket, type Matter } from "@/lib/matters";
import { listLeads } from "@/lib/pipeline";
import { listMemberDirectory } from "@/lib/members/directory";
import { loadActiveQueue } from "@/lib/queue/load";
import { orgHasModule } from "@/lib/org/modules";
import { matterStatusLabel } from "@/lib/matters/status";
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
import { NewMatterForm } from "@/components/matters/MatterForms";
import { MatterBoard } from "@/components/matters/MatterBoard";
import { listMatterStages } from "@/lib/matters/stages";
import { resolveFirmSession } from "@/lib/firm/session";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { matterIdsNeedingReview } from "./list-utils";
import { MATTER_TYPE_LABEL } from "./labels";

export const dynamic = "force-dynamic";

/**
 * The docket as a worklist: one band per whose-move-is-it, from the design.
 * Filters are links (a filtered worklist is a shareable URL); the server
 * re-filters on navigation.
 */
export default async function MattersPage({ searchParams }: { searchParams: Promise<{ seg?: string; q?: string; view?: string }> }) {
  const { seg: segRaw, q, view } = await searchParams;
  const boardView = view === "board";
  const seg: SegmentKey = isSegment(segRaw) ? segRaw : "open";
  const search = (q ?? "").trim().slice(0, 80);

  let all: Matter[] = [];
  let loadError = false;
  try {
    all = await listMatters();
  } catch {
    loadError = true;
  }

  const [queue, members, leads, canCreateLitigation, stages, role] = await Promise.all([
    loadActiveQueue(),
    listMemberDirectory().catch(() => []),
    listLeads().catch(() => []),
    orgHasModule("litigation"),
    boardView ? listMatterStages().catch(() => []) : Promise.resolve([]),
    resolveFirmSession().then((x) => (x.kind === "ok" ? x.role : null)),
  ]);

  // "Needs your review" means something only when the queue was reached.
  // Unconfigured or unavailable is never shown as "nothing to review".
  const reviewIds = queue.status === "ok" ? matterIdsNeedingReview(queue.items) : new Set<string>();
  const stalledIds = new Set(summarizeDocket(all).stalled.map((m) => m.id));
  const sets = { review: reviewIds, stalled: stalledIds };
  const counts = new Map(SEGMENTS.map((s) => [s.key, filterBySegment(all, s.key, sets).length]));
  // Review only when the queue was reached; court only for a firm that has court matters.
  const segments = SEGMENTS.filter((s) => (s.key !== "review" || queue.status === "ok") && (s.key !== "court" || (counts.get("court") ?? 0) > 0 || seg === "court"));

  const shown = searchMatters(filterBySegment(all, seg, sets), search);
  const bands = groupIntoBands(shown);
  const memberName = new Map(members.map((m) => [m.userId, m.displayName ?? m.email ?? "Teammate"]));
  const leadOptions = leads.map((l) => ({
    id: l.id,
    label: [l.business_name?.trim() || `${l.first_name} ${l.last_name}`.trim(), l.email].filter(Boolean).join(" · "),
  }));

  const href = (next: { seg?: string; q?: string; view?: string | null }) => {
    const p = new URLSearchParams();
    const s = next.seg ?? seg;
    if (s !== "open") p.set("seg", s);
    const term = next.q ?? search;
    if (term) p.set("q", term);
    const v = next.view === undefined ? (boardView ? "board" : null) : next.view;
    if (v) p.set("view", v);
    const qs = p.toString();
    return `/dashboard/matters/${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Docket</div>
          <h1 className="lx-h1">Matters</h1>
          <p className="lx-sub">Every engaged matter, grouped by whose move it is. Longest in its stage first.</p>
        </div>
        <nav className="lx-segs lx-view-toggle" aria-label="View">
          <Link href={href({ view: null })} aria-current={!boardView ? "page" : undefined} className={!boardView ? "on" : undefined}>
            List
          </Link>
          <Link href={href({ view: "board" })} aria-current={boardView ? "page" : undefined} className={boardView ? "on" : undefined}>
            Board
          </Link>
        </nav>
        <form className="lx-search-form" role="search">
          {boardView && <input type="hidden" name="view" value="board" />}
          {seg !== "open" && <input type="hidden" name="seg" value={seg} />}
          <input className="lx-input" name="q" defaultValue={search} placeholder="Mark, number, owner or serial" aria-label="Search matters" />
        </form>
      </div>

      <nav aria-label="Filter matters" className="lx-chips">
        {segments.map((s) => (
          <Link key={s.key} href={href({ seg: s.key })} aria-current={seg === s.key ? "page" : undefined}>
            {s.label}
            <span className="lx-chip-count">{counts.get(s.key) ?? 0}</span>
          </Link>
        ))}
      </nav>
      {queue.status === "unavailable" && (
        <p className="lx-note" style={{ margin: 0 }}>
          The approval queue can&apos;t be reached right now, so matters can&apos;t be checked for drafts waiting on review.
        </p>
      )}

      <details className="lx-card lx-disclosure">
        <summary>Open a matter</summary>
        <NewMatterForm leads={leadOptions} canCreateLitigation={canCreateLitigation} />
      </details>

      {loadError ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>Matters couldn&apos;t be loaded</h2>
          <p className="lx-note" style={{ margin: 0 }}>
            This is a problem reaching the database, not an empty docket. Try again in a moment.
          </p>
        </div>
      ) : boardView && shown.length > 0 ? (
        <MatterBoard
          stages={stages}
          matters={shown}
          canMove={!!role && MATTER_WRITE_ROLES.includes(role)}
          reviewIds={reviewIds}
          ownerName={(id) => (id ? memberName.get(id) ?? "Teammate" : null)}
        />
      ) : bands.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>{all.length === 0 ? "No matters yet" : "Nothing matches"}</h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {all.length === 0 ? "A matter opens when a lead signs, or from the form above." : "Try another filter or search."}
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
              <table className="lx-tbl">
                <colgroup>
                  <col style={{ width: "32%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "9%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Matter</th>
                    <th>Type</th>
                    <th>Stage</th>
                    <th>In stage</th>
                    <th>Owner</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {band.matters.map((m) => {
                    const age = stageAge(m);
                    return (
                      <tr key={m.id}>
                        <td className="pri">
                          <Link href={`/dashboard/matters/${m.id}/`} className="lx-rowlink">
                            {matterLabel(m)}
                          </Link>
                          <div className="lx-note lx-num">
                            {m.matter_number}
                            {m.owner_name ? ` · ${m.owner_name}` : ""}
                            {reviewIds.has(m.id) && <span className="lx-pill lx-pill-warn" style={{ marginLeft: 6 }}>Review</span>}
                          </div>
                        </td>
                        <td>{MATTER_TYPE_LABEL[m.type]}</td>
                        <td>{m.stage ? `${m.stage.code}. ${m.stage.label}` : <span className="lx-note">—</span>}</td>
                        <td className="lx-num">
                          {age.days === null ? "—" : age.stale ? <span className="lx-pill lx-pill-risk">{age.days}d</span> : `${age.days}d`}
                        </td>
                        <td>{m.assigned_to ? memberName.get(m.assigned_to) ?? "Teammate" : <span className="lx-note">Unassigned</span>}</td>
                        <td>{matterStatusLabel(m.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </>
  );
}
