import { describeActivity } from "@/components/leads/describe";
import { civilDateIn } from "./build";
import { shortDate } from "./format";

/** Pure rules for the detail panel. No database, no server imports. */

export const NOTE_CLIP = 200;
export const ACTIVITY_LIMIT = 8;

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

export type ActivityIn = { id: string; type: string; actor_type: string | null; created_at: string; payload: unknown };
export type ActivityLine = { id: string; title: string; note: string | null; when: string };

/** The last few timeline rows: a title for each, and the note text (clipped) for a plain note only. */
export function activityLines(rows: readonly ActivityIn[], timeZone: string, today: string): ActivityLine[] {
  return rows.slice(0, ACTIVITY_LIMIT).map((r) => {
    const d = describeActivity(r, { timeZone });
    return {
      id: r.id,
      title: d.title,
      note: r.type === "note" && d.detail ? clipNote(d.detail) : null,
      when: shortDate(civilDateIn(r.created_at, timeZone), today),
    };
  });
}
