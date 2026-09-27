import "./brain.css";
import { resolveFirmSession } from "@/lib/firm/session";
import {
  listBrainEntries,
  listClaims,
  type BrainEntry,
  type BrainCategory,
  type ClaimEntry,
  type ClaimStatus,
} from "@/lib/brain";
import {
  BRAIN_CATEGORIES,
  BRAIN_CATEGORY_LABEL,
  BRAIN_CATEGORY_BLURB,
  CLAIM_STATUSES,
  CLAIM_STATUS_LABEL,
  canManageBrainEntries,
  canProposeClaims,
  canReviewClaims,
} from "./enums";
import NewEntryForm from "./_components/NewEntryForm";
import EntryRow from "./_components/EntryRow";
import ProposeClaimForm from "./_components/ProposeClaimForm";
import ClaimRow from "./_components/ClaimRow";

export const dynamic = "force-dynamic";

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

const CLAIM_STATUS_BLURB: Record<ClaimStatus, string> = {
  proposed: "Written down by the firm, not yet reviewed.",
  approved: "Reviewed and cleared for this firm's own marketing copy.",
  forbidden: "Reviewed and ruled out — don't use this language.",
};

const CLAIM_STATUS_FOOTNOTE: Record<ClaimStatus, string> = {
  proposed: "Awaiting review",
  approved: "Cleared for use",
  forbidden: "Do not use",
};

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateFormat.format(d);
}

/** Newest `updated_at` in a set of rows, or null when the set is empty. */
function latestUpdate(rows: { updated_at: string }[]): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    if (!newest || row.updated_at > newest) newest = row.updated_at;
  }
  return newest;
}

/**
 * Firm brain — the firm's own internal memory (identity, voice, pricing,
 * engagement norms, decision log, client language, templates, stage
 * mapping), plus a claim library for attorney-advertising compliance.
 *
 * Ported from lectual main (src/app/(firm)/dashboard/brain,
 * src/lib/brain) into lectual.app's design system — see PORTED_FROM.md.
 * `src/lib/brain/rpb-seed.ts` (one firm's seeded content) is deliberately
 * left out; this app never ships another firm's content into a new tenant.
 *
 * Unlike a module-gated surface, this page is not hard-gated: any signed-in
 * org member may read (crm_brain_select_own / crm_claim_select_own have no
 * role check in RLS) — every WRITE is independently re-checked in
 * @/lib/brain and, finally, by RLS. Nothing here sends, files, or is legal
 * advice: it is software recording the firm's own internal reference and
 * review state (UPL firewall, AGENTS.md).
 *
 * There is no retrieval or "answer" engine behind this page — the search a
 * design mock might show would be a pure client-side filter over rows RLS
 * already returned. This first cut skips search and groups everything by
 * category/status instead; nothing here synthesizes an answer, a corpus
 * size, or a source count that isn't a literal count of the rows fetched.
 *
 * Reads use a plain try/catch, not the three-state ok/unconfigured/
 * unavailable shape in src/lib/queue/load.ts — crm_firm_brain_entry and
 * crm_claim_library are ordinary tables that exist on both lectual-dev and
 * lectual-prod (0024/0026 are old, applied migrations), so "table missing
 * in this environment" is not a reachable state the way it is for the newer
 * lectual.app-only tables. A failed read still surfaces honestly, as an
 * explicit "couldn't load" card — never as an empty list.
 */
export default async function BrainPage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") {
    return (
      <>
        <div className="lx-page-head">
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="lx-label">IP.OS</div>
            <h1 className="lx-h1">Firm brain</h1>
          </div>
        </div>
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Sign in to see the firm brain
          </h2>
        </div>
      </>
    );
  }

  const role = session.role;
  const canManageEntries = canManageBrainEntries(role);
  const canPropose = canProposeClaims(role);
  const canReview = canReviewClaims(role);

  let entries: BrainEntry[] = [];
  let claims: ClaimEntry[] = [];
  let loadError: string | null = null;
  try {
    [entries, claims] = await Promise.all([listBrainEntries(), listClaims()]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const entriesByCategory = groupBy(entries, (e) => e.category as BrainCategory);
  const claimsByStatus = groupBy(claims, (c) => c.status as ClaimStatus);
  const usedCategories = BRAIN_CATEGORIES.filter((c) => entriesByCategory.has(c));
  const lastTouched = formatDay(latestUpdate([...entries, ...claims]));

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">
            IP.OS · {entries.length} {entries.length === 1 ? "entry" : "entries"} · {claims.length}{" "}
            {claims.length === 1 ? "claim" : "claims"}
            {lastTouched ? ` · updated ${lastTouched}` : ""}
          </div>
          <h1 className="lx-h1">Firm brain</h1>
          <p className="lx-sub">Everything the firm has written down about itself — internal only, nothing here sends.</p>
        </div>
      </div>

      {loadError ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Couldn&apos;t load the firm brain
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>{loadError}</p>
        </div>
      ) : (
        <>
          <div className="lx-card lx-brain-banner">
            <div className="lx-brain-banner-row">
              <span className="lx-brain-badge" aria-hidden>
                ✦
              </span>
              <span className="lx-label" style={{ margin: 0 }}>
                Firm memory
              </span>
              <span style={{ marginLeft: "auto" }} className="lx-note">
                Internal only · nothing on this page sends
              </span>
            </div>
            <p className="lx-brain-lede">
              The firm&apos;s shared internal reference — identity, voice, pricing, engagement norms,
              decision log, client language, templates, and stage mapping — plus a library of proposed
              marketing claims.
            </p>
            <p className="lx-brain-fine">
              Everything here is memory the firm wrote down itself, scoped to this organization. Nothing on
              this page sends an email, files anything, or goes to a client.
            </p>
          </div>

          {(canManageEntries || canPropose) && (
            <div className="lx-brain-forms">
              {canManageEntries && <NewEntryForm />}
              {canPropose && <ProposeClaimForm />}
            </div>
          )}

          <div className="lx-brain-collections">
            <h2 className="lx-h2">Knowledge</h2>
            {usedCategories.length === 0 ? (
              <div className="lx-card lx-empty-card">
                <h2 className="lx-h2" style={{ fontSize: 20 }}>
                  No brain entries yet
                </h2>
                <p className="lx-note" style={{ margin: 0 }}>
                  {canManageEntries
                    ? "Add one above to start building the firm's shared memory."
                    : "Nothing has been recorded yet. Ask a firm admin to add entries."}
                </p>
              </div>
            ) : (
              usedCategories.map((category) => {
                const rows = entriesByCategory.get(category)!;
                const updated = formatDay(latestUpdate(rows));
                return (
                  <div key={category} className="lx-brain-collection">
                    <div className="lx-brain-collection-head">
                      <div className="lx-brain-collection-title">
                        <h3>{BRAIN_CATEGORY_LABEL[category]}</h3>
                        <span className="lx-pill lx-pill-mute">{rows.length}</span>
                      </div>
                      {updated && <span className="lx-brain-foot">Updated {updated}</span>}
                    </div>
                    <p className="lx-brain-collection-desc">{BRAIN_CATEGORY_BLURB[category]}</p>
                    <ul className="lx-brain-rows">
                      {rows.map((entry) => (
                        <EntryRow key={entry.id} entry={entry} canManage={canManageEntries} />
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>

          <div className="lx-brain-collections">
            <h2 className="lx-h2">Claim library</h2>
            <p className="lx-brain-fine">
              Approved/forbidden status here is an attorney-advertising compliance aid for this firm&apos;s
              own marketing copy — it is not legal advice. Route case-specific questions to a licensed
              attorney.
            </p>
            {claims.length === 0 ? (
              <div className="lx-card lx-empty-card">
                <h2 className="lx-h2" style={{ fontSize: 20 }}>
                  No claims proposed yet
                </h2>
                <p className="lx-note" style={{ margin: 0 }}>
                  {canPropose ? "Propose a claim above — an admin or attorney will review it." : "Nothing has been proposed yet."}
                </p>
              </div>
            ) : (
              CLAIM_STATUSES.filter((status) => (claimsByStatus.get(status)?.length ?? 0) > 0).map((status) => {
                const rows = claimsByStatus.get(status)!;
                return (
                  <div key={status} className="lx-brain-collection">
                    <div className="lx-brain-collection-head">
                      <div className="lx-brain-collection-title">
                        <h3>{CLAIM_STATUS_LABEL[status]}</h3>
                        <span className="lx-pill lx-pill-mute">{rows.length}</span>
                      </div>
                      <span className="lx-brain-foot">{CLAIM_STATUS_FOOTNOTE[status]}</span>
                    </div>
                    <p className="lx-brain-collection-desc">{CLAIM_STATUS_BLURB[status]}</p>
                    <ul className="lx-brain-rows">
                      {rows.map((claim) => (
                        <ClaimRow key={claim.id} claim={claim} canReview={canReview} />
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}
