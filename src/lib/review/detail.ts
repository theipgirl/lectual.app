/** Pure rules for the review's record helpers (stage choices, note clipping). No database, no server imports. */

export const NOTE_CLIP = 200;

export type StageOption = { id: string; name: string };

/** A lead can be moved to any open, lost or nurture stage from the review. A `won` stage is never offered: that move runs the matter handoff. */
export function leadStageChoices(stages: readonly { id: string; name: string | null; category: string | null }[]): StageOption[] {
  return stages
    .filter((s): s is { id: string; name: string; category: string } => !!s.name && (s.category === "open" || s.category === "lost" || s.category === "nurture"))
    .map((s) => ({ id: s.id, name: s.name }));
}

export function clipNote(text: string, max = NOTE_CLIP): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
