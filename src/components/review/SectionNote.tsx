import { NOTES_PRESENT, notTrackedFor, type CustomStateLike, type SheetSectionId } from "@/lib/review/sheet-columns";
import { CUSTOM_COLUMNS_NOT_ON, NOT_TRACKED_NOTES_SENTENCE, notTrackedNote } from "@/lib/ui/words";

/**
 * ONE quiet line above a section, never a warning and never an empty column. In order:
 *   1. the spreadsheet columns Lectual has no home for, minus any the firm has added as a live custom column here (CO3);
 *   2. the Notes sentence, where a Notes column is drawn;
 *   3. for the admin tier only (`adminTier`, from the page's re-resolved role): "not switched on yet" when the custom columns aren't
 *      there (CO4, no link). Nothing more when the read failed or wasn't made: the details note already names a failure. (Adding a
 *      column is an owner's, from a column's own menu on the List; there is no Settings page for it any more.)
 * With nothing to say there is no `<p>` at all.
 */
export function SectionNote({ section, customState = null, adminTier = false }: { section: SheetSectionId; customState?: CustomStateLike; adminTier?: boolean }) {
  const names = notTrackedFor(section, customState);
  const parts: string[] = [];
  if (names.length > 0) parts.push(notTrackedNote(names));
  if (section === "trademarks" && NOTES_PRESENT) parts.push(NOT_TRACKED_NOTES_SENTENCE);
  if (adminTier && customState?.status === "not-set-up") parts.push(CUSTOM_COLUMNS_NOT_ON);
  if (parts.length === 0) return null;
  return (
    <p className="lx-note rv-sheet-note" data-section-note={section}>
      {parts.join(" ")}
    </p>
  );
}
