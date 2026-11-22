import { NOT_TRACKED, NOTES_PRESENT, type SheetSectionId } from "@/lib/review/sheet-columns";
import { NOT_TRACKED_NOTES_SENTENCE, notTrackedNote } from "@/lib/ui/words";

/** ONE quiet line above a section naming the spreadsheet columns Lectual has no home for. Not a warning, and never an empty column. */
export function SectionNote({ section }: { section: SheetSectionId }) {
  return (
    <p className="lx-note rv-sheet-note" data-section-note={section}>
      {notTrackedNote(NOT_TRACKED[section])}
      {section === "trademarks" && NOTES_PRESENT ? ` ${NOT_TRACKED_NOTES_SENTENCE}` : ""}
    </p>
  );
}
