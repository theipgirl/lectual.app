import "./brain.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveViewSession } from "@/lib/views/view-as";
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
  claimsHelp,
  knowledgeHelp,
} from "./enums";
import NewEntryForm from "./_components/NewEntryForm";
import EntryRow from "./_components/EntryRow";
import ProposeClaimForm from "./_components/ProposeClaimForm";
import ClaimRow from "./_components/ClaimRow";
import type { Metadata } from "next";
import { DEADLINE_ALERT_KEY } from "@/lib/today/deadline-alerts";
import { pageTitle } from "@/lib/ui/page-title";
import { listStages } from "@/lib/pipeline/stages";
import { isSignalId } from "@/lib/stage-keeper/signals";
import { formatDay as sharedFormatDay } from "@/lib/ui/dates";
import { getFirmTimeZone } from "@/lib/org/profile";
import { FIRM_NOTES_NAME, FIRM_NOTES_PURPOSE } from "@/lib/ui/words";
import { EmptyState, LoadFailedCard, PageHeader, Pill } from "@/components/ui";

export const metadata: Metadata = { title: pageTitle(FIRM_NOTES_NAME) };

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

/** "Nov 16" in the firm's zone (year only when it is not this year); null for a missing or unreadable date. */
function formatDay(iso: string | null | undefined, tz: string): string | null {
  return sharedFormatDay(iso, { tz });
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
 * Firm notes — the firm's own internal memory (identity, voice, pricing,
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
export default async function BrainPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
} = {}) {
  const { tab: tabRaw } = (await searchParams) ?? {};
  // Anything but "claims" is Knowledge.
  const tab: "knowledge" | "claims" = tabRaw === "claims" ? "claims" : "knowledge";
  const session = await resolveViewSession();
  // The dashboard layout gates sign-in; a session that isn't ok here fails closed with no explanation.
  if (session.kind !== "ok") notFound();

  const role = session.role;
  const canManageEntries = canManageBrainEntries(role);
  const canPropose = canProposeClaims(role);
  const canReview = canReviewClaims(role);

  let entries: BrainEntry[] = [];
  let claims: ClaimEntry[] = [];
  let loadFailed = false;
  try {
    [entries, claims] = await Promise.all([listBrainEntries(), listClaims()]);
    // A setting stored as a firm note (Settings -> Team's deadline alert list) is changed there, not here.
    entries = entries.filter((e) => !(e.category === "other" && e.key === DEADLINE_ALERT_KEY));
  } catch (err) {
    // The message can carry database text, so it is logged and never drawn.
    console.error("[brain] load failed", err instanceof Error ? err.name : typeof err);
    loadFailed = true;
  }

  // Stage choices for the stage-rule type: null means the stages could not be read.
  let stageChoices: { id: string; name: string }[] | null = null;
  if (!loadFailed && tab === "knowledge" && canManageEntries) {
    try {
      stageChoices = (await listStages()).map((s) => ({ id: s.id, name: s.name }));
    } catch {
      stageChoices = null;
    }
  }
  const ruledSignals = entries
    .filter((e) => e.category === "stage_mapping")
    .map((e) => e.key.trim().toLowerCase())
    .filter(isSignalId);

  const entriesByCategory = groupBy(entries, (e) => e.category as BrainCategory);
  const claimsByStatus = groupBy(claims, (c) => c.status as ClaimStatus);
  const usedCategories = BRAIN_CATEGORIES.filter((c) => entriesByCategory.has(c));
  const tz = await getFirmTimeZone();
  const lastTouched = formatDay(latestUpdate([...entries, ...claims]), tz);

  return (
    <>
      <PageHeader
        title={FIRM_NOTES_NAME}
        sub={
          <>
            {entries.length} {entries.length === 1 ? "entry" : "entries"} · {claims.length}{" "}
            {claims.length === 1 ? "claim" : "claims"}
            {lastTouched ? ` · updated ${lastTouched}` : ""}
          </>
        }
      />
      <p className="lx-note" style={{ margin: 0 }}>{FIRM_NOTES_PURPOSE}</p>

      {loadFailed ? (
        <LoadFailedCard what="your firm notes" />
      ) : (
        <>
          <nav className="lx-tabs" role="tablist" aria-label="Firm notes sections">
            <Link
              href="/dashboard/brain/"
              role="tab"
              aria-selected={tab === "knowledge"}
              aria-current={tab === "knowledge" ? "page" : undefined}
            >
              Knowledge
            </Link>
            <Link
              href="/dashboard/brain/?tab=claims"
              role="tab"
              aria-selected={tab === "claims"}
              aria-current={tab === "claims" ? "page" : undefined}
            >
              Claim library
            </Link>
          </nav>

          {tab === "knowledge" && (
          <div className="lx-brain-collections">
            <h2 className="lx-h2">Knowledge</h2>
            <p className="lx-note" style={{ margin: 0 }}>{knowledgeHelp(role)}</p>
            {canManageEntries && <NewEntryForm stages={stageChoices} ruledSignals={ruledSignals} />}
            {usedCategories.length === 0 ? (
              <EmptyState title="No firm notes yet">
                {canManageEntries
                  ? "Use New entry above to start building the firm's shared memory."
                  : "Nothing has been recorded yet. Ask a firm admin to add entries."}
              </EmptyState>
            ) : (
              usedCategories.map((category) => {
                const rows = entriesByCategory.get(category)!;
                const updated = formatDay(latestUpdate(rows), tz);
                return (
                  <div key={category} className="lx-brain-collection">
                    <div className="lx-brain-collection-head">
                      <div className="lx-brain-collection-title">
                        <h3 className="lx-h3">{BRAIN_CATEGORY_LABEL[category]}</h3>
                        <Pill tone="mute" num>{rows.length}</Pill>
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

          )}

          {tab === "claims" && (
          <div className="lx-brain-collections">
            <h2 className="lx-h2">Claim library</h2>
            <p className="lx-note" style={{ margin: 0 }}>{claimsHelp(role)}</p>
            {canPropose && <ProposeClaimForm />}
            <p className="lx-brain-fine">
              Approved/forbidden status here is an attorney-advertising compliance aid for this firm&apos;s
              own marketing copy — it is not legal advice. Route case-specific questions to a licensed
              attorney.
            </p>
            {claims.length === 0 ? (
              <EmptyState title="No claims proposed yet">
                {canPropose ? "Use Propose a claim above — an admin or attorney will review it." : "Nothing has been proposed yet."}
              </EmptyState>
            ) : (
              CLAIM_STATUSES.filter((status) => (claimsByStatus.get(status)?.length ?? 0) > 0).map((status) => {
                const rows = claimsByStatus.get(status)!;
                return (
                  <div key={status} className="lx-brain-collection">
                    <div className="lx-brain-collection-head">
                      <div className="lx-brain-collection-title">
                        <h3 className="lx-h3">{CLAIM_STATUS_LABEL[status]}</h3>
                        <Pill tone="mute" num>{rows.length}</Pill>
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
          )}
        </>
      )}
    </>
  );
}
