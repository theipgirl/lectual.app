import type { SheetEntry } from "@/lib/intake/sheet-read";
import type { LawmaticsNote, RecordNotes } from "@/lib/lawmatics/notes";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";
import { MILESTONE_LABEL, classifyMail, classifyNote, opensMatter, stageForMilestone, type Milestone, type MilestoneMapping } from "./milestones";
import type { StoredMail } from "./email";
import type { MailHit } from "./mailbox-search";
import type { EvidenceItem, EvidenceVia, SourceName, StageOpt } from "./types";

/**
 * Turns what each source holds into dated evidence items. Pure. A note or a mail names a MILESTONE;
 * the milestone names a stage only through `stageForMilestone` (the firm's brain mapping first, then the
 * one defaults table), and only when the evidence has a date: an undated fact is cited, never acted on.
 * A date in the future is ignored for the same reason (a typo in a log must not look like news).
 */

type Ctx = { stages: readonly StageOpt[]; mapping: MilestoneMapping; now: Date };

function pastDate(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms <= now.getTime() ? new Date(ms).toISOString() : null;
}

function fromMilestone(
  source: SourceName,
  via: EvidenceVia,
  milestone: Milestone,
  date: string | null,
  ctx: Ctx,
  snippet?: string,
): EvidenceItem {
  const stage = date !== null ? stageForMilestone(milestone, ctx.stages, ctx.mapping) : null;
  return {
    source,
    via,
    milestone,
    label: MILESTONE_LABEL[milestone],
    date,
    stageId: stage?.id ?? null,
    ...(opensMatter(milestone) ? { matter: true } : {}),
    ...(snippet ? { snippet } : {}),
  };
}

/** The sheet row's notes. The row's status code is carried by its source signal, not here. */
export function sheetNoteEvidence(entry: SheetEntry | null | undefined, ctx: Ctx): EvidenceItem[] {
  if (!entry) return [];
  const out: EvidenceItem[] = [];
  for (const note of entry.notes ?? []) {
    const date = pastDate(note.date, ctx.now);
    for (const m of note.milestones) out.push(fromMilestone("sheet", "note", m, date, ctx, note.snippet));
  }
  return out;
}

/**
 * Lawmatics evidence beyond what the signal carries: its notes, and the milestone a stage NAME states
 * ("Proposal Sent", "Consult Completed"). The name is cited as read-only text: it is undated (the record's
 * updated time is not when the stage was entered) and so is never acted on, and it names no Lectual stage.
 */
export function lawmaticsEvidence(
  record: LawmaticsSourceRecord | null | undefined,
  notes: RecordNotes | undefined,
  stageIsUnmapped: boolean,
  ctx: Ctx,
): EvidenceItem[] {
  if (!record) return [];
  const out: EvidenceItem[] = [];
  if (stageIsUnmapped && record.stageName) {
    for (const m of classifyNote(record.stageName)) out.push(fromMilestone("lawmatics", "stage", m, null, ctx));
  }
  if (notes?.status === "ok") {
    for (const note of notes.notes as LawmaticsNote[]) {
      const date = pastDate(note.date, ctx.now);
      for (const m of note.milestones) out.push(fromMilestone("lawmatics", "note", m, date, ctx, note.snippet));
    }
  }
  return out;
}

/** Stored mail rows (the sync's own classification) and mailbox-search hits, as milestones by direction. */
export function mailEvidence(mail: readonly StoredMail[], hits: readonly MailHit[], ctx: Ctx): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const m of mail) {
    if (m.sensitive) continue;
    const date = pastDate(m.at, ctx.now);
    const milestones = classifyMail({ subject: m.subject ?? null, direction: m.direction ?? "received", storedType: m.type });
    for (const ms of milestones) out.push(fromMilestone("email", "mail", ms, date, ctx));
  }
  for (const h of hits) {
    const date = pastDate(h.at, ctx.now);
    for (const ms of classifyMail({ subject: h.subject, direction: h.direction })) out.push(fromMilestone("email", "mailbox", ms, date, ctx));
  }
  return out;
}

/**
 * One item per source, way of reading and milestone: the newest dated one, or an undated one when no
 * dated one exists. A person can have thirty "contacted" mails; the screen cites the latest.
 */
export function collapseEvidence(items: readonly EvidenceItem[]): EvidenceItem[] {
  const best = new Map<string, EvidenceItem>();
  const time = (i: EvidenceItem) => (i.date ? Date.parse(i.date) : Number.NEGATIVE_INFINITY);
  for (const item of items) {
    const key = `${item.source}|${item.via}|${item.milestone ?? item.label}`;
    const have = best.get(key);
    if (!have || time(item) > time(have)) best.set(key, item);
  }
  return [...best.values()];
}

/**
 * The newest dated fact across the sources, never in the future. `extra` is the dates of facts that are
 * touches but not milestones (the sheet's newest log date, every synced or searched mail).
 */
export function lastTouchOf(items: readonly EvidenceItem[], extra: ReadonlyArray<string | null | undefined>, now: Date): string | null {
  let best = Number.NEGATIVE_INFINITY;
  for (const iso of [...items.map((i) => i.date), ...extra]) {
    const ms = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(ms) && ms <= now.getTime() && ms > best) best = ms;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}
