// Ported from lectual src/app/(firm)/dashboard/matters/_components/labels.ts,
// without MATTER_TYPE_TONE (the old TagBadge palette has no place in this design).
import type { Matter } from "@/lib/matters";
import { formatDay } from "@/lib/ui/dates";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { BLANK } from "@/lib/ui/words";

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

export function fmtMatterDate(iso: string, tz: string = DEFAULT_TIME_ZONE): string {
  return formatDay(iso, { tz }) ?? BLANK;
}
