import { civilDateIn } from "./build";
import { shortDate } from "./format";
import {
  CHANGED_BY_ASSISTANT,
  CHANGED_BY_AUTOMATION,
  CHANGED_BY_LAWMATICS_SYNC,
  CHANGED_BY_LECTUAL,
  CHANGED_BY_STAGE_KEEPER,
  A_TEAMMATE,
  NOT_CHANGED_SINCE_IMPORT,
  NO_CHANGES_RECORDED,
  changedByLine,
} from "@/lib/ui/words";

/**
 * "Last changed by / when" for a Weekly review row. Pure.
 *
 * Source: the newest `crm_activity` row of the record that is a CHANGE type. Only the type, the actor and the date are
 * used. `payload.actor` / `payload.source` are read ONLY to name a stamp (the Stage Keeper, the Lawmatics sync, an
 * import); no payload value, note text or address is ever kept or drawn.
 */
export const CHANGE_TYPES = [
  "stage_changed",
  "matter_updated",
  "matter_opened",
  "lead_created",
  "lead_updated",
  "lead_assigned",
  "task_created",
  "task_completed",
  "note",
  "voice_note",
] as const;

/** The columns the read selects (ids and the two stamp fields; no other payload key). */
export const CHANGE_SELECT = "lead_id, matter_id, type, actor_type, actor_id, created_at, actor:payload->>actor, source:payload->>source";

/** The Stage Keeper's stamp (`AGENT_ACTOR`, src/lib/stage-keeper/moves.ts) and the hired-matter sync's. */
const STAGE_KEEPER_STAMP = "agent:stage-keeper";
const LAWMATICS_SYNC_STAMP = "lawmatics-sync";
/** `payload.source` values the importers write on a record they created. */
const IMPORT_SOURCES = ["lawmatics_import", "sheet_import", "import"];
const CREATION_TYPES: readonly string[] = ["lead_created", "matter_opened"];

export type ChangeRowIn = {
  lead_id: string | null;
  matter_id: string | null;
  type: string;
  actor_type: string | null;
  actor_id: string | null;
  created_at: string;
  actor?: string | null;
  source?: string | null;
};

export type ChangeActor =
  | { kind: "person"; userId: string | null }
  | { kind: "stage-keeper" }
  | { kind: "lawmatics-sync" }
  | { kind: "import" }
  | { kind: "automation" }
  | { kind: "assistant" }
  | { kind: "system" };

/** `date` is the firm-zone civil day (YYYY-MM-DD). */
export type LastChange = { date: string; actor: ChangeActor };

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Who a change row is credited to. A stamp beats the actor type. */
export function actorOf(row: Pick<ChangeRowIn, "type" | "actor_type" | "actor_id" | "actor" | "source">): ChangeActor {
  if (row.actor === STAGE_KEEPER_STAMP) return { kind: "stage-keeper" };
  if (row.actor === LAWMATICS_SYNC_STAMP || row.source === LAWMATICS_SYNC_STAMP) return { kind: "lawmatics-sync" };
  if (row.actor_type === "system" && CREATION_TYPES.includes(row.type) && row.source && IMPORT_SOURCES.includes(row.source)) return { kind: "import" };
  switch (row.actor_type) {
    case "user":
      return { kind: "person", userId: row.actor_id };
    case "ai":
      return { kind: "assistant" };
    case "automation":
    case "pathset":
      return { kind: "automation" };
    default:
      return { kind: "system" };
  }
}

/** The newest change per record key (`matter:<id>` / `lead:<id>`); a row of any other type, or with no readable date, is ignored. Future dates are ignored. */
export function pickLastChanges(rows: readonly ChangeRowIn[], timeZone: string, now: Date = new Date()): Map<string, LastChange> {
  const best = new Map<string, { at: number; row: ChangeRowIn }>();
  for (const r of rows) {
    if (!(CHANGE_TYPES as readonly string[]).includes(r.type)) continue;
    const at = ms(r.created_at);
    if (!Number.isFinite(at) || at > now.getTime()) continue;
    const key = r.matter_id ? `matter:${r.matter_id}` : r.lead_id ? `lead:${r.lead_id}` : null;
    if (!key) continue;
    const cur = best.get(key);
    if (!cur || at > cur.at) best.set(key, { at, row: r });
  }
  return new Map([...best].map(([k, { row }]) => [k, { date: civilDateIn(row.created_at, timeZone), actor: actorOf(row) }]));
}

/** First word of a directory name, or null when it is an address (an email never reaches the page) or empty. */
export function firstNameOf(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n || n.includes("@")) return null;
  return n.split(/\s+/)[0] ?? null;
}

/**
 * The line a row draws, or `null` for NO line: `undefined` (the read failed) draws nothing, never "not changed". `null` is a read that
 * worked and found no change row.
 */
export function lastChangedText(
  change: LastChange | null | undefined,
  names: ReadonlyMap<string, string> | null,
  today: string,
): string | null {
  if (change === undefined) return null;
  if (change === null) return NO_CHANGES_RECORDED;
  const when = shortDate(change.date, today);
  switch (change.actor.kind) {
    case "import":
      return NOT_CHANGED_SINCE_IMPORT;
    case "stage-keeper":
      return changedByLine(CHANGED_BY_STAGE_KEEPER, when);
    case "lawmatics-sync":
      return changedByLine(CHANGED_BY_LAWMATICS_SYNC, when);
    case "automation":
      return changedByLine(CHANGED_BY_AUTOMATION, when);
    case "assistant":
      return changedByLine(CHANGED_BY_ASSISTANT, when);
    case "system":
      return changedByLine(CHANGED_BY_LECTUAL, when);
    case "person": {
      const first = change.actor.userId ? firstNameOf(names?.get(change.actor.userId)) : null;
      return changedByLine(first ?? A_TEAMMATE, when);
    }
  }
}
