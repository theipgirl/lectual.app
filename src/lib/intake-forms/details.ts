import { isValidSlug } from "./slug";

/**
 * An intake's own details (lectual 0093): what staff call it, its link name,
 * and the source tag its leads carry. Pure, so the editor and the server
 * check the same rules; the server's check is the one that counts.
 *
 *   name        "UGW 2026 booth"  — 1–120 characters, staff-facing only.
 *   slug        "ugw-2026"        — the link: <origin>/i/<slug>. Same shape as
 *                                    0079's check. Renaming keeps the old one
 *                                    working (crm_intake_form_slug_alias).
 *   sourceTag   "UGW 2026"        — optional, 1–80 characters. Stamped on every
 *                                    lead from this intake so the firm can see
 *                                    where leads came from; the Lawmatics tag.
 */

export const DETAIL_LIMITS = { name: 120, sourceTag: 80 } as const;

export type IntakeDetails = { name: string; slug: string; sourceTag: string | null };

export type DetailsCheck = { ok: true; value: IntakeDetails } | { ok: false; errors: string[] };

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function validateIntakeDetails(raw: unknown): DetailsCheck {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: string[] = [];
  const name = clean(r.name);
  const slug = clean(r.slug).toLowerCase();
  const tag = clean(r.sourceTag);
  if (!name) errors.push("Give this intake a name.");
  else if (name.length > DETAIL_LIMITS.name) errors.push(`Keep the name under ${DETAIL_LIMITS.name} characters.`);
  if (!isValidSlug(slug)) {
    errors.push("The link name needs 3–60 lowercase letters, numbers or hyphens, starting and ending with a letter or number.");
  }
  if (tag.length > DETAIL_LIMITS.sourceTag) errors.push(`Keep the source tag under ${DETAIL_LIMITS.sourceTag} characters.`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, slug, sourceTag: tag || null } };
}

/** "Copy of UGW 2026 booth", trimmed to fit. */
export function copyName(name: string): string {
  const out = `Copy of ${name.trim() || "intake"}`;
  return out.length > DETAIL_LIMITS.name ? out.slice(0, DETAIL_LIMITS.name).trimEnd() : out;
}

/**
 * Where a lead from this intake says it came from: the source tag when there
 * is one, else the intake's name. Shown on the lead (`referral_detail`).
 */
export function leadSourceLabel(name: string, sourceTag: string | null): string {
  return (sourceTag ?? "").trim() || name.trim() || "Intake";
}
