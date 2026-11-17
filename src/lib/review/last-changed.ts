import { AGENT_ACTOR } from "@/lib/stage-keeper/moves";
import { civilDateIn } from "./build";
import { shortDate } from "./format";
import {
  CHANGED_BY_ASSISTANT,
  CHANGED_BY_AUTOMATION,
  CHANGED_BY_LAWMATICS_SYNC,
  UPDATED_AUTOMATICALLY,
  CAME_IN_THROUGH_A_FORM,
  OPENED_WHEN_CLIENT_SIGNED,
  changedAutomaticallyLine,
  A_TEAMMATE,
  NOT_CHANGED_SINCE_IMPORT,
  NO_CHANGES_LAST_YEAR,
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

/** The hired-matter sync's stamp (the Stage Keeper's is `AGENT_ACTOR`, defined once in src/lib/stage-keeper/moves.ts). */
const LAWMATICS_SYNC_STAMP = "lawmatics-sync";
/**
 * `payload.source` values the code writes on SYSTEM rows, so a system row is credited to what really did it, never to "Lectual".
 * Only the Lawmatics lead import writes a row at all (a `lead_created` for a lead filed in a stand-in stage); the other imports
 * (sheet, matters) write NO activity row, so those records read "No changes in the last year" until something is done to them.
 */
const IMPORT_SOURCE = "lawmatics_import";
const FORM_SOURCE = "Intake form";
const SIGNED_SOURCE = "quote_accepted";

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
  | { kind: "form" }
  | { kind: "signed" }
  | { kind: "stage-keeper" }
  | { kind: "lawmatics-sync" }
  | { kind: "import" }
  | { kind: "automation" }
  | { kind: "assistant" }
  | { kind: "system" };

/** `date` is the firm-zone civil day (YYYY-MM-DD); `at` is the instant (ms), only for choosing the newer of two. */
export type LastChange = { date: string; at: number; actor: ChangeActor };

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Who a change row is credited to. A stamp beats the actor type. */
export function actorOf(row: Pick<ChangeRowIn, "type" | "actor_type" | "actor_id" | "actor" | "source">): ChangeActor {
  if (row.actor === AGENT_ACTOR) return { kind: "stage-keeper" };
  if (row.actor === LAWMATICS_SYNC_STAMP || row.source === LAWMATICS_SYNC_STAMP) return { kind: "lawmatics-sync" };
  if (row.actor_type === "system") {
    if (row.type === "lead_created" && row.source === IMPORT_SOURCE) return { kind: "import" };
    if (row.type === "lead_created" && row.source === FORM_SOURCE) return { kind: "form" };
    if (row.type === "matter_opened" && row.source === SIGNED_SOURCE) return { kind: "signed" };
  }
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

/** The change window: the read asks for the last 12 months only. */
export const CHANGE_WINDOW_MONTHS = 12;
export function changeWindowStart(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - CHANGE_WINDOW_MONTHS);
  return d.toISOString();
}

/**
 * The newest change per record key (`matter:<id>` / `lead:<id>`). A row that carries BOTH ids counts under both. A row of any other type,
 * or with no readable date, is ignored. Future dates are ignored.
 */
export function pickLastChanges(rows: readonly ChangeRowIn[], timeZone: string, now: Date = new Date()): Map<string, LastChange> {
  const best = new Map<string, { at: number; row: ChangeRowIn }>();
  for (const r of rows) {
    if (!(CHANGE_TYPES as readonly string[]).includes(r.type)) continue;
    const at = ms(r.created_at);
    if (!Number.isFinite(at) || at > now.getTime()) continue;
    const keys = [r.matter_id ? `matter:${r.matter_id}` : null, r.lead_id ? `lead:${r.lead_id}` : null];
    for (const key of keys) {
      if (!key) continue;
      const cur = best.get(key);
      if (!cur || at > cur.at) best.set(key, { at, row: r });
    }
  }
  return new Map([...best].map(([k, { at, row }]) => [k, { date: civilDateIn(row.created_at, timeZone), at, actor: actorOf(row) }]));
}

/**
 * What a review row shows: a matter also takes the changes filed on its LEAD (a quote or note made before the matter opened), the newer one
 * winning, as the proposal-expiry read does. `null` = the read worked and the window holds nothing.
 */
export function lastChangeFor(changes: ReadonlyMap<string, LastChange>, kind: "matter" | "lead", id: string, leadId?: string | null): LastChange | null {
  const own = changes.get(`${kind}:${id}`) ?? null;
  const viaLead = kind === "matter" && leadId ? changes.get(`lead:${leadId}`) ?? null : null;
  if (own && viaLead) return viaLead.at > own.at ? viaLead : own;
  return own ?? viaLead;
}

/** The change as it may be drawn when the member directory could not be read: a person's name is unknown, so no line (never "a teammate"). */
export function withoutPeople(change: LastChange | null): LastChange | null | undefined {
  return change && change.actor.kind === "person" ? undefined : change;
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
  if (change === null) return NO_CHANGES_LAST_YEAR;
  const when = shortDate(change.date, today);
  switch (change.actor.kind) {
    case "import":
      return NOT_CHANGED_SINCE_IMPORT;
    case "stage-keeper":
      return changedAutomaticallyLine(when);
    case "lawmatics-sync":
      return changedByLine(CHANGED_BY_LAWMATICS_SYNC, when);
    case "automation":
      return changedByLine(CHANGED_BY_AUTOMATION, when);
    case "assistant":
      return changedByLine(CHANGED_BY_ASSISTANT, when);
    case "form":
      return `${CAME_IN_THROUGH_A_FORM} · ${when}`;
    case "signed":
      return `${OPENED_WHEN_CLIENT_SIGNED} · ${when}`;
    case "system":
      return `${UPDATED_AUTOMATICALLY} · ${when}`;
    case "person": {
      if (!names) return null; // the directory could not be read: no line rather than a guess
      const first = change.actor.userId ? firstNameOf(names.get(change.actor.userId)) : null;
      return changedByLine(first ?? A_TEAMMATE, when);
    }
  }
}
