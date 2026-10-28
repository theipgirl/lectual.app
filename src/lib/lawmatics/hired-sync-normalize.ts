/**
 * Lawmatics prospect -> sanitized hired-sync candidate. Pure, untrusted-input posture as
 * ./normalize.ts: nothing is passed through raw.
 *
 * UNVERIFIED against a live account: the attribute keys `status`, `converted_date`, `case_title`,
 * `case_number` and the shape of `custom_fields` (array of {name|label, value}, or a name -> value
 * map) come from the public API reference. Several spellings are tried.
 */
import { bag, field, idOf, relatedId, nestedName, type Raw } from "./jsonapi";
import { cleanEmail, cleanText } from "./normalize";
import type { HiredProspect } from "./hired-sync-plan";

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One custom field's value by (case-insensitive) name. */
export function customFieldValue(rec: Raw, name: string): string | null {
  const want = name.trim().toLowerCase();
  const cf = bag(rec).custom_fields ?? rec.custom_fields;
  if (Array.isArray(cf)) {
    for (const entry of cf) {
      if (!isRaw(entry)) continue;
      const label = field(entry, "name", "label", "custom_field_name", "key");
      if (label?.trim().toLowerCase() === want) return cleanText(field(entry, "value", "values"), 500);
    }
  } else if (isRaw(cf)) {
    for (const [k, v] of Object.entries(cf)) {
      if (k.trim().toLowerCase() === want) return cleanText(isRaw(v) ? field(v, "value") : v, 500);
    }
  }
  return null;
}

function dateOnly(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  return m ? m[1] : null;
}

export function normalizeHiredProspect(rec: Raw, practiceAreas: Map<string, string>): HiredProspect | null {
  const id = cleanText(idOf(rec), 128);
  if (!id) return null;
  const paId = relatedId(rec, "practice_area") ?? cleanText(field(rec, "practice_area_id"), 128);
  const paName = cleanText(nestedName(rec, "practice_area") ?? field(rec, "practice_area_name") ?? (paId ? practiceAreas.get(paId) : null), 200);
  const first = cleanText(field(rec, "first_name"), 120);
  const last = cleanText(field(rec, "last_name"), 120);
  const name = cleanText(field(rec, "name", "full_name") ?? [first, last].filter(Boolean).join(" "), 200);
  return {
    lawmaticsId: id,
    name,
    email: cleanEmail(field(rec, "email", "email_address", "primary_email")),
    status: cleanText(field(rec, "status"), 60),
    convertedDate: dateOnly(field(rec, "converted_date", "converted_at")),
    caseNumber: cleanText(field(rec, "case_number"), 60),
    caseTitle: cleanText(field(rec, "case_title"), 200),
    trademarkName: customFieldValue(rec, "Name of Trademark"),
    practiceAreaField: customFieldValue(rec, "Practice Area"),
    practiceAreaName: paName,
  };
}
