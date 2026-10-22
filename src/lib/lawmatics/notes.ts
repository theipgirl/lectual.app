import "server-only";

import { classifyNote, snippetOf, type Milestone } from "@/lib/reconcile/milestones";
import type { LawmaticsClient } from "./client";
import { bag, field, relatedId, type Raw } from "./jsonapi";

/**
 * Lawmatics notes as EVIDENCE for the stage reconciliation screen. Read-only (the client has no write
 * method) and held in memory only: each note becomes a date, the milestones it names and a snippet of
 * at most 140 characters, handed to the screen. Nothing here writes a note body anywhere.
 *
 * NOT VERIFIED against a live Lawmatics account: the `/notes` filter parameters and the attribute
 * names below come from the public API reference. Lawmatics is known to ignore parameters silently,
 * so nothing trusts the filter: every note must itself name the record it belongs to (`notable_id`),
 * and a note that names a different record is dropped. A reply whose notes name no record at all cannot
 * be attributed to anyone, so that record's notes are reported as UNAVAILABLE, never as "no notes".
 *
 * Bounded per run (`MAX_RECORDS`, and a page cap per record) with a clear `truncated` state.
 */

export const NOTES_MAX_RECORDS = 150;
const NOTES_PAGE_SIZE = 50;
const NOTES_MAX_PAGES = 4;
const NOTES_MAX_PER_RECORD = 200;
const CONCURRENCY = 4;

export type NotableKind = "Prospect" | "Contact";
export type NotesTarget = { id: string; kind: NotableKind };

export type LawmaticsNote = { date: string | null; milestones: Milestone[]; snippet: string };

export type RecordNotes =
  | { status: "ok"; notes: LawmaticsNote[]; truncated: boolean }
  | { status: "unavailable"; reason: string };

export type NotesRead = {
  byRecord: Map<string, RecordNotes>;
  /** Records asked about beyond the per-run bound. They were not read. */
  skippedForLimit: number;
};

const FAILED = "Lawmatics notes couldn't be read for this record.";
const UNVERIFIED = "Lawmatics returned notes that don't say which record they belong to, so they can't be attributed.";

function noteDate(rec: Raw): string | null {
  const raw = field(rec, "created_at", "date", "updated_at", "created");
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function notableOf(rec: Raw): { id: string | null; kind: string | null } {
  const attrs = bag(rec);
  const id = field(rec, "notable_id") ?? relatedId(rec, "notable") ?? null;
  const type = typeof attrs.notable_type === "string" ? attrs.notable_type : field(rec, "notable_type");
  return { id, kind: type ? type.toLowerCase() : null };
}

/** One record's notes. Throws on a failed request; the caller turns that into a named state. */
async function readOne(client: LawmaticsClient, target: NotesTarget): Promise<RecordNotes> {
  const list = await client.listAll("/notes", {
    pageSize: NOTES_PAGE_SIZE,
    maxPages: NOTES_MAX_PAGES,
    maxRecords: NOTES_MAX_PER_RECORD,
    params: { "filter[notable_id]": target.id, "filter[notable_type]": target.kind },
  });

  let attributable = 0;
  const notes: LawmaticsNote[] = [];
  for (const rec of list.records) {
    const { id, kind } = notableOf(rec);
    if (id === null) continue;
    attributable += 1;
    if (id !== target.id) continue;
    if (kind !== null && kind !== target.kind.toLowerCase()) continue;
    const text = [field(rec, "name", "title"), field(rec, "body", "content", "text", "note")].filter(Boolean).join(" ");
    notes.push({ date: noteDate(rec), milestones: classifyNote(text), snippet: snippetOf(text) });
  }
  if (list.records.length > 0 && attributable === 0) return { status: "unavailable", reason: UNVERIFIED };
  return { status: "ok", notes, truncated: list.truncated };
}

/**
 * Notes for these records, in memory. A record whose read fails is `unavailable` with a fixed
 * sentence (no provider text); one beyond the bound is `unavailable` too and counted in `skippedForLimit`.
 */
export async function readLawmaticsNotes(
  client: LawmaticsClient,
  targets: readonly NotesTarget[],
  opts: { maxRecords?: number } = {},
): Promise<NotesRead> {
  const max = opts.maxRecords ?? NOTES_MAX_RECORDS;
  const unique = [...new Map(targets.map((t) => [t.id, t])).values()];
  const wanted = unique.slice(0, max);
  const byRecord = new Map<string, RecordNotes>();

  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const target = wanted[next++];
      try {
        byRecord.set(target.id, await readOne(client, target));
      } catch (err) {
        // A name only: the message can carry the provider's body.
        console.error("[reconcile] lawmatics notes read failed", err instanceof Error ? err.name : "error");
        byRecord.set(target.id, { status: "unavailable", reason: FAILED });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));

  for (const target of unique.slice(max)) {
    byRecord.set(target.id, { status: "unavailable", reason: "Not read: this preview reads the notes of the first " + max + " people only." });
  }
  return { byRecord, skippedForLimit: Math.max(0, unique.length - max) };
}
