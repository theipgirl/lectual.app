// Ported from theipgirl/lectual `src/lib/intake/sheet-import.ts` (main @ 0c65dca). Logic unchanged;
// only this header is new. Used by the stage reconciliation screen to read Caitlyn's intake sheet.
/**
 * Parse layer for the spreadsheet → intake importer (blueprint
 * docs/specs/2026-09-14-monday-intake-dashboard.md §5).
 *
 * The Trademarks sheet holds two populations in one grid: rows whose status
 * code is 0–6 are people still in INTAKE (they become `crm_lead`), and rows
 * 7+ are clients, which `scripts/import-tracker.ts` already lands as
 * `crm_matter`. This module reads only the first population and refuses the
 * second by name, so the two importers can never fight over a row.
 *
 * Pure functions only — no Supabase, no filesystem, no xlsx. The I/O shell is
 * scripts/import-intake-sheet.ts; the diff against the database is
 * ./sheet-import-plan. That split is what lets every rule below be tested
 * against a synthetic fixture (tests/fixtures/intake/trademarks-sheet.json).
 *
 * The workbook's real defects are documented in
 * src/lib/matters/tracker-import.ts and apply here VERBATIM — the owner column
 * is headed `0`, the log lives in one cell with the dates as delimiters, some
 * of those dates are typos in the future, and ~940 blank rows trail the data.
 * `stageCodeOf`, `splitNoteEntries` and `sourceHash` are imported from there
 * rather than reimplemented: one sheet, one set of parse rules.
 */

import {
  sourceHash,
  splitNoteEntries,
  stageCodeOf,
  type NoteEntry,
} from "@/lib/matters/tracker-import";
import { resolveStage, type StageRef } from "@/lib/lawmatics/stage-map";
import { classifyReferralSource, type ReferralSource } from "./referral-source";
import type { Temperature } from "./temperature";

/** Status codes 0–6 are intake. 7 ("Signed LOE / Deposit Received") is the conversion. */
const MAX_INTAKE_STAGE_CODE = 6;

/** The sheet IS the Trademarks sheet; every row it yields is a trademark intake row. */
export const SHEET_PRACTICE_AREA = "Trademark";

/**
 * `.invalid` is reserved by RFC 2606 and can never resolve, so a placeholder
 * address is incapable of reaching a human by accident. `crm_lead.email` is
 * NOT NULL and the sheet carries no addresses; inventing a plausible-looking
 * one would be worse than useless — it would be mailable.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "intake.invalid";

/**
 * Openers that mark an entry as the LEAD talking to the firm rather than the
 * firm talking to the lead. PNC is RPB's abbreviation for Potential New
 * Client; CL for Client. Compared case-insensitively against the entry's
 * first word.
 */
const INBOUND_OPENERS = new Set(["PNC", "CL", "CLIENT"]);

// ── row shapes ───────────────────────────────────────────────────────────────

export type IntakeSheetRow = {
  /** 1-based worksheet row number, for the operator's report. */
  row: number;
  /** Idempotency key: sourceHash(owner|mark|code). Stable across re-runs. */
  sheetKey: string;
  /** Verbatim owner cell, kept for the report (the split names are derived). */
  ownerName: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
  markText: string | null;
  /** Verbatim Status cell, kept for audit. */
  statusText: string;
  /** `'1'` — the sheet's own numbering, part of the key. NOT the stage's order_index. */
  stageCode: string;
  /** The tenant's own crm_stage row this resolved to, by name. */
  stageId: string;
  stageName: string;
  referralSource: ReferralSource;
  referralDetail: string | null;
  /** false when the Source cell held a token the classifier does not know. */
  referralRecognized: boolean;
  /** From the Priority column only — the one place the sheet already had an opinion. */
  temperature: Temperature | null;
  /** Verbatim Assigned To cell (the export sometimes holds a whole sentence here). */
  assignedRaw: string | null;
  /** Initials, only when the cell is initials-SHAPED. Resolved to a user in the plan. */
  assignedInitials: string | null;
  email: string;
  /** true when `email` is the deterministic placeholder and needs a real address. */
  emailIsPlaceholder: boolean;
  practiceArea: string;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  lastActivityAt: string | null;
  notes: NoteEntry[];
};

/** A row that is NOT imported, and why. A silent import is not an import. */
export type IntakeRowRefusal = {
  row: number;
  reason: string;
  statusText?: string;
  ownerName?: string;
};

export type IntakeParseResult = {
  rows: IntakeSheetRow[];
  refused: IntakeRowRefusal[];
  /** Trailing/interstitial empty rows. Counted, never reported as problems. */
  blankRows: number;
  /** Data rows read (header excluded). */
  rowsRead: number;
};

export type ParseIntakeRowOptions = {
  now: Date;
  rowNumber: number;
  /** The tenant's own crm_stage rows, RLS-scoped by the caller. */
  stages: readonly StageRef[];
  /**
   * `--source "UGW"` — for exports with no Source column (the UGW lead list).
   * Overrides the column when set; the classifier still buckets it.
   */
  sourceOverride?: string | null;
};

// ── cell helpers ─────────────────────────────────────────────────────────────

/**
 * First non-empty value among candidate column names.
 *
 * A copy of tracker-import's private `col()` — it is not exported there and
 * this module must not edit that file (it is a verbatim port). Six lines of
 * duplication is cheaper than widening the ported module's surface.
 */
function cell(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Collapse for the key only — the verbatim text is kept on the row. */
function keyPart(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The row's stable identity. Owner + mark + status code, because that is what
 * distinguishes the sheet's rows from each other: one owner can appear three
 * times with three different marks (they do), and the same owner+mark at a
 * different stage is the same person moving, not a new row — but the code is
 * in the key deliberately, matching the blueprint, so that a re-export with a
 * moved row is visible as a new key rather than silently rewriting history.
 */
export function sheetKeyFor(input: {
  ownerName: string | null;
  markText: string | null;
  stageCode: string;
}): string {
  return sourceHash(`${keyPart(input.ownerName)}|${keyPart(input.markText)}|${input.stageCode}`);
}

/** The deterministic, undeliverable stand-in for a missing address. */
export function placeholderEmailFor(sheetKey: string): string {
  return `sheet+${sheetKey}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

// ── name splitting (blueprint §5 rule 8) ─────────────────────────────────────

export type SplitName = {
  firstName: string;
  lastName: string;
  /** Text found inside parentheses, e.g. "Marguerite (Margo) Delacroix". */
  parenthetical: string | null;
};

/**
 * Split an owner cell into first/last name.
 *
 * The last space-separated token is the surname; everything before it is the
 * given name(s), so "Theo R. Vandermeer" keeps the middle initial with the
 * first name rather than losing it. A single token becomes the surname with an
 * empty first name — `crm_lead.first_name` is NOT NULL but may be empty, and a
 * mononym is a surname far more often than it is a forename in this sheet.
 */
export function splitOwnerName(owner: string): SplitName {
  const parenthetical = owner.match(/\(([^)]*)\)/)?.[1]?.trim() || null;
  const bare = owner.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const tokens = bare ? bare.split(" ") : [];
  if (tokens.length === 0) return { firstName: "", lastName: owner.trim(), parenthetical };
  if (tokens.length === 1) return { firstName: "", lastName: tokens[0], parenthetical };
  return {
    firstName: tokens.slice(0, -1).join(" "),
    lastName: tokens[tokens.length - 1],
    parenthetical,
  };
}

// ── note log → touch timestamps (blueprint §5 rule 5) ────────────────────────

/**
 * The first word of an entry, with leading punctuation removed.
 *
 * splitNoteEntries cuts the log AFTER each date, so every entry but the first
 * begins with the separator that followed the previous one ("; TAM sent ...").
 * Stripping it here rather than in the ported splitter keeps that file
 * untouched and keeps this rule where it is used.
 */
function openerOf(text: string): string | null {
  const stripped = text.replace(/^[^A-Za-z]+/, "");
  return stripped.match(/^([A-Za-z]+)\b/)?.[1] ?? null;
}

export type TouchDirection = "inbound" | "outbound" | null;

/**
 * Who moved, per entry.
 *
 * Inbound is an explicit opener (PNC / CL / Client) — the lead did something.
 * Outbound is ALL-CAPS staff initials, exactly the shape tracker-import's
 * INITIALS_RE already recognizes. Anything else is direction-unknown and sets
 * neither timestamp: an entry typed "Rl sent ..." (a real typo in the export)
 * still counts as activity via last_activity_at, and under-claiming a touch is
 * safer than telling the Monday view the firm replied when it may not have.
 */
export function touchDirectionOf(text: string): TouchDirection {
  const opener = openerOf(text);
  if (!opener) return null;
  if (INBOUND_OPENERS.has(opener.toUpperCase())) return "inbound";
  return /^[A-Z]{2,3}$/.test(opener) ? "outbound" : null;
}

/** A dated note's day as an instant. The sheet records days, not clock times. */
function atStartOfUtcDay(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export type TouchTimestamps = {
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  lastActivityAt: string | null;
};

/**
 * Latest dated entry overall, and the latest in each direction.
 *
 * Entries whose date was written in the future are SKIPPED here, even though
 * splitNoteEntries clamps them to the import date and keeps them. A clamped
 * date is not evidence of when — the export really does contain "2.3.36" —
 * and feeding it in would date a lead's last touch to today, which is exactly
 * how a stale row reaches the top of the Monday list as "hot". The note itself
 * is still imported, flagged `date_suspect`; only its date is disbelieved.
 */
export function touchTimestampsFrom(notes: readonly NoteEntry[]): TouchTimestamps {
  const touches: TouchTimestamps = {
    lastOutboundAt: null,
    lastInboundAt: null,
    lastActivityAt: null,
  };
  for (const note of notes) {
    if (!note.date || note.dateSuspect) continue;
    const at = atStartOfUtcDay(note.date);
    touches.lastActivityAt = latest(touches.lastActivityAt, at);
    const direction = touchDirectionOf(note.text);
    if (direction === "inbound") touches.lastInboundAt = latest(touches.lastInboundAt, at);
    if (direction === "outbound") touches.lastOutboundAt = latest(touches.lastOutboundAt, at);
  }
  return touches;
}

// ── priority → temperature (blueprint §5 rule 7) ─────────────────────────────

function temperatureFromPriority(priority: string | null): Temperature | null {
  const p = priority?.trim().toLowerCase();
  if (p === "high") return "hot";
  if (p === "low") return "cold";
  return null;
}

// ── assigned-to initials (blueprint §5 rule 6) ───────────────────────────────

/**
 * Initials, but only when the whole cell is initials.
 *
 * The September export has two rows whose Assigned To cell holds an entire
 * sentence ("DO (through RB's email) sent PNC info ..."). Reading the leading
 * "DO" out of prose would assign a lead on the strength of a mis-pasted note,
 * so anything that is not a bare 2–3 letter token is left unparsed — the raw
 * cell is carried through and lands in the plan's report for a human to fix.
 */
export function assignedInitialsOf(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  return /^[A-Za-z]{2,3}$/.test(t) ? t.toUpperCase() : null;
}

// ── one row ──────────────────────────────────────────────────────────────────

export type ParsedIntakeRow =
  | { row: IntakeSheetRow }
  | { refusal: IntakeRowRefusal }
  | { blank: true };

/**
 * Normalize one worksheet row into an intake lead, or refuse it.
 *
 * Refusal, never approximation: a status the tenant's pipeline does not name
 * is reported rather than parked in the first stage (the stage-map rule), and
 * a client row is reported by name rather than quietly imported as a lead.
 */
export function parseIntakeRow(
  sheetRow: Record<string, unknown>,
  opts: ParseIntakeRowOptions,
): ParsedIntakeRow {
  const statusText = cell(sheetRow, "Status");
  // ~940 trailing blank rows follow the real data; they are not problems.
  if (!statusText) return { blank: true };

  const stageCode = stageCodeOf(statusText);
  if (!stageCode) {
    return { refusal: { row: opts.rowNumber, reason: "no stage code in status", statusText } };
  }

  const numericCode = Number.parseInt(stageCode, 10);
  if (!Number.isFinite(numericCode)) {
    return { refusal: { row: opts.rowNumber, reason: "no stage code in status", statusText } };
  }
  if (numericCode > MAX_INTAKE_STAGE_CODE) {
    return {
      refusal: {
        row: opts.rowNumber,
        reason: "client, not intake — use import-tracker",
        statusText,
      },
    };
  }

  const resolution = resolveStage(statusText, opts.stages);
  if (!resolution.ok) {
    return { refusal: { row: opts.rowNumber, reason: resolution.reason, statusText } };
  }

  // Owner is under the header `0`; the column headed "Trademark Owner" is
  // blank on every row. Only the FIRST blank-header column may arrive as ''
  // (see recordsFromSheetRows) — later spacer columns must not win.
  const ownerName = cell(sheetRow, "0", "Trademark Owner", "", "Owner", "Client");
  if (!ownerName) {
    return {
      refusal: {
        row: opts.rowNumber,
        reason: "no owner name — cannot key the intake row",
        statusText,
      },
    };
  }

  const markText = cell(sheetRow, "Trademark Name", "Mark");
  const sheetKey = sheetKeyFor({ ownerName, markText, stageCode });
  const { firstName, lastName, parenthetical } = splitOwnerName(ownerName);

  const rawSource = opts.sourceOverride?.trim() || cell(sheetRow, "Source");
  const referral = classifyReferralSource(rawSource);

  // Description holds the dated log, Notes the side remarks; one log, in that
  // order, exactly as the tracker importer reads the same two cells.
  const logText = [cell(sheetRow, "Description"), cell(sheetRow, "Notes")]
    .filter(Boolean)
    .join(" ");
  const notes = splitNoteEntries(logText || null, opts.now);
  const touches = touchTimestampsFrom(notes);

  const assignedRaw = cell(sheetRow, "Assigned To");

  return {
    row: {
      row: opts.rowNumber,
      sheetKey,
      ownerName,
      firstName,
      lastName,
      // A parenthetical is a nickname or a brand; it becomes the business name
      // only when no real business column filled it (this sheet has none).
      businessName: cell(sheetRow, "Business", "Business Name", "Company") ?? parenthetical,
      markText,
      statusText,
      stageCode,
      stageId: resolution.stage.id,
      stageName: resolution.stage.name,
      referralSource: referral.source,
      referralDetail: referral.detail,
      referralRecognized: referral.recognized,
      temperature: temperatureFromPriority(cell(sheetRow, "Priority")),
      assignedRaw,
      assignedInitials: assignedInitialsOf(assignedRaw),
      email: placeholderEmailFor(sheetKey),
      // The sheet carries no addresses at all, so every row is a placeholder
      // today. Kept as a flag rather than assumed, so an export that DOES have
      // an Email column only needs the read added here.
      emailIsPlaceholder: true,
      practiceArea: SHEET_PRACTICE_AREA,
      ...touches,
      notes,
    },
  };
}

// ── the whole sheet ──────────────────────────────────────────────────────────

/**
 * Parse every data row.
 *
 * Rows that key the same (same owner, mark and status code) are merged rather
 * than duplicated: later rows win on scalars and their log entries are unioned
 * on sourceHash, because the export occasionally repeats a row and losing the
 * second copy's notes would lose real history (the tracker importer's rule).
 */
export function parseIntakeSheet(
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: { now: Date; stages: readonly StageRef[]; sourceOverride?: string | null },
): IntakeParseResult {
  const byKey = new Map<string, IntakeSheetRow>();
  const refused: IntakeRowRefusal[] = [];
  let blankRows = 0;

  rows.forEach((sheetRow, i) => {
    const parsed = parseIntakeRow(sheetRow, {
      now: opts.now,
      // +2: worksheet rows are 1-based and row 1 is the header.
      rowNumber: i + 2,
      stages: opts.stages,
      sourceOverride: opts.sourceOverride,
    });
    if ("blank" in parsed) {
      blankRows += 1;
      return;
    }
    if ("refusal" in parsed) {
      refused.push(parsed.refusal);
      return;
    }

    const existing = byKey.get(parsed.row.sheetKey);
    if (!existing) {
      byKey.set(parsed.row.sheetKey, parsed.row);
      return;
    }
    const seen = new Set(existing.notes.map((n) => n.sourceHash));
    const notes = [...existing.notes, ...parsed.row.notes.filter((n) => !seen.has(n.sourceHash))];
    byKey.set(parsed.row.sheetKey, { ...parsed.row, notes, ...touchTimestampsFrom(notes) });
  });

  return { rows: [...byKey.values()], refused, blankRows, rowsRead: rows.length };
}
