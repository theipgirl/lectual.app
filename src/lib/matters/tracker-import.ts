// Parse layer for the one-time Excel-tracker → Lectual import.
//
// Spec: docs/specs/2026-08-17-tracker-to-lectual-migration.md
//
// PORTED VERBATIM from commit e24a2d39ffa68c170261df6a7f21de2163e322d2
// ("spec + parse layer for retiring the Excel tracker") on branch
// claude/rebecca-morning-email-brief-ar2omq, together with its test file
// tests/tracker-import.test.ts. It arrived here already written and already
// tested; nothing below was redesigned. The two branches were split only so
// that the SCHEMA these functions write into (crm_matter_stage, 0042) could
// land independently of the brief that motivated them.
//
// Pure functions only — no Supabase, no filesystem. The writer that consumes
// these lives in scripts/import-tracker.ts, so every rule below is testable
// against a fixture without touching a database.
//
// The rules encode real defects in the source workbook, all observed in the
// August 2026 export of RPB Law Team Tasks / Trademarks. Do not "tidy" them:
//   * The owner column is headed `0`; the one headed "Trademark Owner" is blank
//     on every row.
//   * `19A` and `19F` are opposite states that both start with 19.
//   * The Notes log contains typo dates in the future ("2.3.36"), which would
//     make a 400-day-stale matter look worked yesterday.
//   * ~940 trailing blank rows follow the real data.

export type StageRef = { code: string; label: string };

export type NoteEntry = {
  /** The entry as written, e.g. "RL draft OA notice email 8.3.26". */
  text: string;
  /** Team member initials, when the entry starts with them. */
  initials: string | null;
  /** ISO date parsed from the entry, or null when it carries none. */
  date: string | null;
  /**
   * The written date was in the future, so it is a typo. The date is clamped to
   * the import date and this flag is carried into the activity payload rather
   * than silently corrected — the note is evidence, and evidence keeps its warts.
   */
  dateSuspect: boolean;
  /** Stable identity for dedupe on re-run. */
  sourceHash: string;
};

export type ImportedMatter = {
  /** Idempotency key. Re-running updates this row rather than duplicating it. */
  matterNumber: string;
  mark: string | null;
  ownerName: string | null;
  serialNumber: string | null;
  /** Verbatim status cell, kept for audit. */
  statusText: string;
  /** `'19A'` — the real stage identity. */
  stageCode: string;
  notes: NoteEntry[];
};

export type RowProblem = { row: number; reason: string; statusText?: string };

export type ParseResult = {
  matters: ImportedMatter[];
  /** Rows that could not be imported, with why. A silent import is not an import. */
  skipped: RowProblem[];
};

// ------------------------------------------------------------------ helpers

/** First non-empty value among candidate column names. */
function col(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * The stage code including its sub-stage letter: "19A. OA Issued" → "19A".
 *
 * Uppercased so a lowercase "19a" still matches. Returning the letter is the
 * whole point: dropping it merges "response owed to the USPTO" with "response
 * already filed", which is how already-handled matters reached the top of the
 * most urgent section of the Monday brief.
 */
export function stageCodeOf(status: string | null): string | null {
  if (!status) return null;
  const m = status.trim().match(/^(\d{1,2}[A-Za-z]?)/);
  return m ? m[1].toUpperCase() : null;
}

/** Cheap, stable, non-cryptographic hash — identity for dedupe, not security. */
export function sourceHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Slugify for the fallback matter number. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * The matter's stable key.
 *
 * A USPTO serial is globally unique and never changes, so it wins. Without one
 * (matters that predate filing) fall back to owner+mark, which is what the team
 * uses verbally. Both are deterministic, which is what makes re-running the
 * import an update rather than a duplicate.
 */
export function matterNumberFor(m: {
  serialNumber: string | null;
  ownerName: string | null;
  mark: string | null;
}): string | null {
  if (m.serialNumber) return `TM-${m.serialNumber.replace(/\D/g, '')}`;
  const parts = [m.ownerName, m.mark].filter(Boolean) as string[];
  if (!parts.length) return null;
  return `TM-${slug(parts.join('-'))}`;
}

// -------------------------------------------------------------- note splitting

const DATE_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{2})\b/g;
const INITIALS_RE = /^([A-Z]{2,3})\b/;

/**
 * Split the Notes cell into individual dated entries.
 *
 * The team writes an append-only log in one cell: "RL draft OA notice email
 * 8.3.26 TM sent to client 8.5.26". Each entry ENDS with its date, so the dates
 * are the delimiters — segment the text after each one. Trailing text with no
 * date is still kept as an undated entry; a note without a date is information,
 * just not evidence of when.
 *
 * `now` clamps future dates. The export genuinely contains "2.3.36", and a note
 * dated ten years out would otherwise make the matter look freshly worked.
 */
export function splitNoteEntries(text: string | null, now: Date): NoteEntry[] {
  if (!text || !text.trim()) return [];
  const src = text.replace(/\s+/g, ' ').trim();

  const cuts: Array<{ end: number; y: number; mo: number; d: number }> = [];
  for (const m of src.matchAll(DATE_RE)) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue; // not a date; e.g. a version number
    cuts.push({ end: (m.index ?? 0) + m[0].length, y: 2000 + Number(m[3]), mo, d });
  }

  const entries: NoteEntry[] = [];
  let start = 0;
  const push = (raw: string, date: string | null, suspect: boolean) => {
    const t = raw.trim();
    if (!t) return;
    entries.push({
      text: t,
      initials: t.match(INITIALS_RE)?.[1] ?? null,
      date,
      dateSuspect: suspect,
      sourceHash: sourceHash(t),
    });
  };

  for (const c of cuts) {
    const iso = new Date(Date.UTC(c.y, c.mo - 1, c.d));
    const suspect = iso.getTime() > now.getTime();
    // Clamp rather than drop: the note happened, only its written date is wrong.
    const use = suspect ? now : iso;
    push(src.slice(start, c.end), use.toISOString().slice(0, 10), suspect);
    start = c.end;
  }
  push(src.slice(start), null, false);

  return entries;
}

// ------------------------------------------------------------------- rows

/**
 * Normalize one worksheet row into an importable matter.
 *
 * Returns a problem instead of a matter when the row cannot be trusted. An
 * unmatched stage code is deliberately fatal for the row rather than defaulting
 * to a stage — silently parking matters in the wrong place is how a docket stops
 * being believed.
 */
export function parseRow(
  row: Record<string, unknown>,
  opts: { now: Date; rowNumber: number; stages: StageRef[] },
): { matter: ImportedMatter } | { problem: RowProblem } {
  const statusText = col(row, 'Status');
  // The export carries ~940 trailing blank rows; they are not a problem to report.
  if (!statusText) return { problem: { row: opts.rowNumber, reason: 'blank row' } };

  const code = stageCodeOf(statusText);
  if (!code) {
    return { problem: { row: opts.rowNumber, reason: 'no stage code in status', statusText } };
  }
  if (!opts.stages.some((s) => s.code === code)) {
    return {
      problem: { row: opts.rowNumber, reason: `stage code '${code}' is not a known stage`, statusText },
    };
  }

  // Owner is under the header `0`. The column headed "Trademark Owner" is blank
  // on every row, and a blank-header column can also arrive under ''. Order
  // matters: only the FIRST blank-header column is the owner, later spacer
  // columns must not win.
  const ownerName = col(row, '0', 'Trademark Owner', '', 'Owner', 'Client');
  const mark = col(row, 'Trademark Name', 'Mark');
  const serialNumber = col(row, 'Serial No. ', 'Serial No.', 'Serial');

  const matterNumber = matterNumberFor({ serialNumber, ownerName, mark });
  if (!matterNumber) {
    return {
      problem: { row: opts.rowNumber, reason: 'no serial, owner, or mark — cannot key the matter', statusText },
    };
  }

  const notesText = [col(row, 'Notes'), col(row, 'Description')].filter(Boolean).join(' ');

  return {
    matter: {
      matterNumber,
      mark,
      ownerName,
      serialNumber,
      statusText,
      stageCode: code,
      notes: splitNoteEntries(notesText, opts.now),
    },
  };
}

/**
 * Parse a whole worksheet.
 *
 * Later rows for the same matter number win on scalar fields, and their notes are
 * merged — the export occasionally carries a matter twice, and losing the second
 * row's log would lose real history.
 */
export function parseWorksheetRows(
  rows: Array<Record<string, unknown>>,
  opts: { now: Date; stages: StageRef[] },
): ParseResult {
  const byNumber = new Map<string, ImportedMatter>();
  const skipped: RowProblem[] = [];

  rows.forEach((row, i) => {
    const r = parseRow(row, { now: opts.now, rowNumber: i + 2, stages: opts.stages });
    if ('problem' in r) {
      if (r.problem.reason !== 'blank row') skipped.push(r.problem);
      return;
    }
    const existing = byNumber.get(r.matter.matterNumber);
    if (!existing) {
      byNumber.set(r.matter.matterNumber, r.matter);
      return;
    }
    const seen = new Set(existing.notes.map((n) => n.sourceHash));
    byNumber.set(r.matter.matterNumber, {
      ...r.matter,
      notes: [...existing.notes, ...r.matter.notes.filter((n) => !seen.has(n.sourceHash))],
    });
  });

  return { matters: [...byNumber.values()], skipped };
}
