/**
 * Lawmatics prospect → sanitized matters-import source record.
 *
 * A DELIBERATELY SMALLER sibling of ./normalize.ts's `normalizeProspect`: this
 * importer (src/lib/lawmatics/matters-import.ts) only ever reconciles an
 * EXISTING crm_matter row against a Lawmatics prospect — it never creates one,
 * and it needs none of the relationship-backed fields (stage, contact) that
 * normalizeProspect sideloads through `included`. Every value here is a flat
 * prospect attribute, so this module takes no `included` param at all.
 *
 * Same untrusted-input posture as normalize.ts: nothing is passed through raw.
 * Sanitization itself is NOT reimplemented — `cleanText`/`cleanTimestamp` are
 * imported from ./normalize.ts so the two importers can never drift on what
 * "sanitized" means.
 *
 * FLAGGED, UNVERIFIED: the exact Lawmatics attribute key for referral source
 * and notes is not confirmed against a live account — lawmatics-mcp's own
 * CLAUDE.md documents the verified `/prospects` shape (name, email, company,
 * stage, practice_area, dates) but says nothing about a referral-source or
 * notes field. The plausible flat-key spellings below are tried the same
 * defensive way `field()` already tries multiple spellings elsewhere in this
 * codebase; verify against a real payload before relying on either field.
 *
 * Pure module: no I/O. Unit-tested against fixtures.
 */

import { field, idOf, type Raw } from "./jsonapi";
import { cleanText, cleanTimestamp } from "./normalize";

// Same caps normalize.ts uses for the equivalent fields (id/name), plus a
// generous cap for notes — crm_matter.notes is an unbounded `text` column, but
// a hostile payload still shouldn't be able to bloat a row without limit.
const CAP = {
  id: 128,
  name: 240,
  referralSource: 200,
  notes: 8000,
} as const;

/**
 * One Lawmatics prospect, flattened and sanitized to just what the matters
 * importer needs. `null` everywhere means "Lawmatics didn't give us this",
 * never "empty".
 */
export type LawmaticsMatterSourceRecord = {
  lawmaticsId: string;
  /** Prospect/matter name as shown in Lawmatics — used for name-matching. */
  matterName: string | null;
  referralSource: string | null;
  notes: string | null;
  createdAt: string | null;
};

/** Sanitize a Lawmatics prospect for the matters importer. Flat attributes only. */
export function normalizeMatterProspect(rec: Raw): LawmaticsMatterSourceRecord | null {
  const id = cleanText(idOf(rec), CAP.id);
  if (!id) return null;

  return {
    lawmaticsId: id,
    matterName: cleanText(field(rec, "name", "matter_name", "title"), CAP.name),
    referralSource: cleanText(
      field(rec, "referral_source", "referralSource", "source", "lead_source"),
      CAP.referralSource,
    ),
    notes: cleanText(field(rec, "notes", "note", "description"), CAP.notes),
    createdAt: cleanTimestamp(field(rec, "created_at", "created")),
  };
}
