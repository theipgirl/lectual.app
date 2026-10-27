/**
 * "Move to..." for several Intake cards at once. The logic of one request, with every dependency passed in so the
 * rules are tested without a database: the server action (`bulkMoveStageAction`) supplies the real ones.
 *
 * What it guarantees, whatever the browser sent:
 *   - the caller may move stages (`CAN_MOVE_STAGE`, resolved now, never cached), else nothing is read or written
 *   - at most BULK_MOVE_MAX leads per request: more is refused outright and nothing is written
 *   - the destination is re-read from the firm's own stages (scoped client) and a `won` stage is refused: a move
 *     there runs the matter handoff and stops the lead's sequences, which is one lead at a time, on purpose
 *   - every lead is re-read through the scoped client, so a lead from another firm is simply "not found"
 *   - each lead moves through `moveLeadStage` (which logs a `stage_changed` row for it), one after another, and a
 *     lead that fails is reported by itself: the others still move, and nothing is rolled back (the timeline is append-only)
 *   - a lead already in the stage is skipped and counted, not rewritten
 * Nothing is sent and no queue item is created.
 */

export const BULK_MOVE_MAX = 200;

export const BULK_MESSAGES = {
  noLeads: "Select at least one lead first.",
  noStage: "Choose a stage to move them to.",
  tooMany: `Select at most ${BULK_MOVE_MAX} leads at a time.`,
  forbidden: "You don't have permission to move leads between stages. Ask an attorney, admin or intake lead.",
  stageMissing: "That stage couldn't be found.",
  stageWon: "That stage opens a matter, so leads can't be moved there in bulk. Open the lead and move it from there.",
  unreadable: "Couldn't read these leads. Nothing was moved.",
  leadMissing: "This lead couldn't be found.",
} as const;

export type BulkMoveFailure = { leadId: string; error: string };

export type BulkMoveResult =
  | { ok: false; error: string }
  | { ok: true; stageId: string; moved: string[]; skipped: string[]; failed: BulkMoveFailure[] };

export type BulkMoveDeps = {
  /** The caller's allowed to move stages, re-checked for this request. */
  canMove: () => Promise<boolean>;
  /** The destination, read through the scoped client. Null = not this firm's. Throws when unreadable. */
  readStage: (stageId: string) => Promise<{ id: string; category: string } | null>;
  /** The leads that exist and are this firm's, with where they are now. Throws when unreadable. */
  readLeads: (leadIds: string[]) => Promise<Array<{ id: string; current_stage_id: string }>>;
  /** One lead's move (role-gated again, logged). Throws on refusal; the message is turned into a sentence by `explain`. */
  move: (leadId: string, stageId: string) => Promise<void>;
  explain: (err: unknown) => string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids of a request, de-duplicated and in the order given. A non-array, or an entry that is not an id, is refused. */
export function parseLeadIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !UUID.test(value)) return null;
    const id = value.toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

const READ_CHUNK = 100;

export async function runBulkMove(input: { leadIds: unknown; stageId: unknown }, deps: BulkMoveDeps): Promise<BulkMoveResult> {
  const leadIds = parseLeadIds(input.leadIds);
  if (!leadIds || leadIds.length === 0) return { ok: false, error: BULK_MESSAGES.noLeads };
  if (leadIds.length > BULK_MOVE_MAX) return { ok: false, error: BULK_MESSAGES.tooMany };
  if (typeof input.stageId !== "string" || !UUID.test(input.stageId)) return { ok: false, error: BULK_MESSAGES.noStage };
  const stageId = input.stageId.toLowerCase();

  if (!(await deps.canMove().catch(() => false))) return { ok: false, error: BULK_MESSAGES.forbidden };

  let stage: { id: string; category: string } | null;
  try {
    stage = await deps.readStage(stageId);
  } catch {
    return { ok: false, error: BULK_MESSAGES.unreadable };
  }
  if (!stage) return { ok: false, error: BULK_MESSAGES.stageMissing };
  if (stage.category === "won") return { ok: false, error: BULK_MESSAGES.stageWon };

  const current = new Map<string, string>();
  try {
    for (let i = 0; i < leadIds.length; i += READ_CHUNK) {
      for (const lead of await deps.readLeads(leadIds.slice(i, i + READ_CHUNK))) current.set(lead.id.toLowerCase(), lead.current_stage_id);
    }
  } catch {
    return { ok: false, error: BULK_MESSAGES.unreadable };
  }

  const moved: string[] = [];
  const skipped: string[] = [];
  const failed: BulkMoveFailure[] = [];
  for (const leadId of leadIds) {
    const from = current.get(leadId);
    if (from === undefined) {
      failed.push({ leadId, error: BULK_MESSAGES.leadMissing });
      continue;
    }
    if (from === stage.id) {
      skipped.push(leadId);
      continue;
    }
    try {
      await deps.move(leadId, stage.id);
      moved.push(leadId);
    } catch (err) {
      failed.push({ leadId, error: deps.explain(err) });
    }
  }
  return { ok: true, stageId: stage.id, moved, skipped, failed };
}

/** The sentence under the board after a request. Counts only; the per-lead reasons are on the cards. */
export function bulkMoveSummary(stageLabel: string, result: Extract<BulkMoveResult, { ok: true }>): string {
  const plural = (n: number) => `${n} lead${n === 1 ? "" : "s"}`;
  const parts = [`Moved ${plural(result.moved.length)} to ${stageLabel}.`];
  if (result.skipped.length > 0) parts.push(`${plural(result.skipped.length)} already there.`);
  if (result.failed.length > 0) parts.push(`${plural(result.failed.length)} couldn't be moved; the reason is on each card.`);
  return parts.join(" ");
}
