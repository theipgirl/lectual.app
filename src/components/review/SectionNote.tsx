import { NOT_TRACKED, NOTES_PRESENT, type SheetSectionId } from "@/lib/review/sheet-columns";
import { CUSTOM_COLUMNS_NOT_ON, NOT_TRACKED_NOTES_SENTENCE, notTrackedNote } from "@/lib/ui/words";

/**
 * ONE quiet line above a section naming the spreadsheet columns Lectual has no home for. Not a warning, and never an empty column.
 * When the firm's custom columns aren't switched on yet (the tables aren't there), the same line says so: never an alert.
 */
export function SectionNote({ section, customNotOn = false }: { section: SheetSectionId; customNotOn?: boolean }) {
  return (
    <p className="lx-note rv-sheet-note" data-section-note={section}>
      {notTrackedNote(NOT_TRACKED[section])}
      {section === "trademarks" && NOTES_PRESENT ? ` ${NOT_TRACKED_NOTES_SENTENCE}` : ""}
      {customNotOn ? ` ${CUSTOM_COLUMNS_NOT_ON}` : ""}
    </p>
  );
}
