// Ported from lectual src/app/(firm)/dashboard/matters/_components/labels.ts,
// without MATTER_TYPE_TONE (the old TagBadge palette has no place in this design).
import type { Matter } from "@/lib/matters";

/** Short badge wording for crm_matter_type. The create form uses MATTER_TYPE_LABELS. */
export const MATTER_TYPE_LABEL: Record<Matter["type"], string> = {
  TM: "Trademark",
  PATENT: "Patent",
  CR: "Copyright",
  BL: "Business law",
  EL: "Entertainment law",
  SO: "Signature offer",
  LIT: "Litigation",
};

export function fmtMatterDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
