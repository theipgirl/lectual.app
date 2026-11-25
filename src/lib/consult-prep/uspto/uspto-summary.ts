// Brief-ready USPTO summary prose. The Sprint 4 composer places it in a status
// callout. Every status carries the knockout disclaimer, and only an `ok` pull
// ever reads as a count of hits: unavailable and skipped never do.

import type { NearIdenticalHit, UsptoOk, UsptoResult } from './uspto';

const DISCLAIMER_OK = 'This is a knockout list, not a clearance or comprehensive search.';
const DISCLAIMER_GENERIC = 'Any USPTO check is a knockout list, not a clearance or comprehensive search.';

function hitLine(h: NearIdenticalHit): string {
  const name = h.wordmark || '(no wordmark)';
  const classes = h.classes ? `IC ${h.classes}` : 'classes not listed';
  const owner = h.owner || 'owner not listed';
  return `- ${name} — ${h.status} — ${classes} — ${owner} — serial ${h.serial}`;
}

function nearIdenticalLines(r: UsptoOk): string[] {
  if (r.tier1Total === 0 && r.nearIdentical.length === 0) {
    return ['0 near-identical hits found in this knockout list.'];
  }
  const shown = r.nearIdentical.length;
  const head =
    shown < r.tier1Total
      ? `Near-identical hits (${r.tier1Total}), showing first ${shown} of ${r.tier1Total}:`
      : `Near-identical hits (${r.tier1Total}):`;
  return [head, ...r.nearIdentical.map(hitLine)];
}

function stemLine(r: UsptoOk): string {
  switch (r.stemSearch) {
    case 'ran': {
      // Plain words, never the internal tier label ("2-live LEGACY in IC 41,35").
      const n = r.tier2Classes.length;
      const where = n === 0 ? 'the likely classes' : `${n === 1 ? 'Class' : 'Classes'} ${r.tier2Classes.join(', ')}`;
      return `Live marks containing ${r.tier2Stem ?? 'the stem'} in ${where}: ${r.tier2Total} total.`;
    }
    case 'not-run-filled':
      return 'Stem search was not run because the near-identical hits filled the list.';
    default:
      return 'Stem search was not run (no stem or likely classes were given).';
  }
}

/** Rows written per tier label. */
function rowsByTier(r: UsptoOk): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.tier] = (out[row.tier] ?? 0) + 1;
  return out;
}

/**
 * Do more matching records exist than the list holds? Only claimed when it is
 * known to be true:
 * - paging stopped at the backend's from+size cap (a truncated list shorter
 *   than the limit can only have been cut there), or
 * - a tier's own total exceeds what was written for it. Tier-2 rows that were
 *   already in tier 1 are deduped out of tier 2, so tier 2 is credited with
 *   every tier-1 row before it counts as short; that never over-claims.
 */
function moreExist(r: UsptoOk): { more: boolean; capped: boolean } {
  const capped = r.truncated && r.written < r.limit;
  if (capped) return { more: true, capped };
  const byTier = rowsByTier(r);
  const labels = Object.keys(r.totals);
  const tier1 = labels.find((l) => l.startsWith('1-'));
  const tier1Rows = tier1 ? byTier[tier1] ?? 0 : 0;
  for (const label of labels) {
    const written = (byTier[label] ?? 0) + (label === tier1 ? 0 : tier1Rows);
    if (r.totals[label] > written) return { more: true, capped };
  }
  return { more: false, capped };
}

function attachmentLine(r: UsptoOk): string {
  if (!r.truncated) return `Full list attached: ${r.written} rows.`;
  const { more, capped } = moreExist(r);
  if (!more) return `First ${r.written} attached.`;
  return capped
    ? `First ${r.written} attached (the search's paging cap was reached; more exist).`
    : `First ${r.written} attached (the list was cut at the limit; more exist).`;
}

export function summarizeUspto(result: UsptoResult): string {
  switch (result.status) {
    case 'ok':
      return [...nearIdenticalLines(result), stemLine(result), attachmentLine(result), DISCLAIMER_OK].join('\n');
    case 'unavailable':
      return ['USPTO search unavailable — run it on the call.', DISCLAIMER_GENERIC].join('\n');
    case 'skipped':
      return ['Nothing to search — no mark is confirmed yet.', DISCLAIMER_GENERIC].join('\n');
  }
}
