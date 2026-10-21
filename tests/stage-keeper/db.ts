import { vi } from "vitest";
import type { Recorded } from "../mailbox/fake-db";
import { agentCtx, fakeLlm, NOW } from "../agents/helpers";
import type { Autonomy } from "../../src/lib/agents/types";
import { FIRM, L, ORG, OTHER_ORG, SENTINEL, S, daysAgo, daysAhead } from "./fixtures";

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A stateful stand-in for the service-role client: it really filters, updates and inserts. */
export type KeeperDb = {
  tables: Record<string, Row[]>;
  /** Make a statement fail: return an error for it, or undefined to let it through. */
  refuse?: (q: Recorded) => { message: string; code?: string } | undefined;
  /** Runs just before every write is applied: lets a test play a person who moves the lead first. */
  beforeWrite?: (q: Recorded, db: KeeperDb) => void;
};

function valueAt(row: Row, column: string): unknown {
  const [col, key] = column.split("->>");
  if (key === undefined) return row[col];
  const inner = row[col];
  return inner && typeof inner === "object" ? inner[key] : undefined;
}

function matches(row: Row, q: Recorded): boolean {
  return q.filters.every((f) => {
    const v = valueAt(row, f.column);
    switch (f.op) {
      case "eq":
        return v === f.value || (v !== undefined && v !== null && typeof f.value === "string" && String(v) === f.value);
      case "in":
        return (f.value as unknown[]).includes(v);
      case "not":
        return v !== null && v !== undefined;
      case "is":
        return f.value === null ? v === null || v === undefined : v === f.value;
      case "gte":
        return v !== null && v !== undefined && (v as string) >= (f.value as string);
      case "lt":
        return v !== null && v !== undefined && (v as string) < (f.value as string);
      case "contains":
        return Array.isArray(v) && (f.value as unknown[]).every((x) => v.includes(x));
      default:
        throw new Error(`keeper fake: unsupported filter ${f.op}`);
    }
  });
}

export function keeperHandler(db: KeeperDb, now: () => number = () => NOW) {
  let seq = 0;
  return (q: Recorded) => {
    const refusal = db.refuse?.(q);
    if (refusal) return { data: null, error: refusal };
    if (q.action !== "select") db.beforeWrite?.(q, db);
    const rows = (db.tables[q.table] ??= []);
    if (q.action === "select") {
      let hit = rows.filter((r) => matches(r, q));
      if (q.order) {
        const { column, ascending } = q.order;
        hit = [...hit].sort((a, b) => {
          const x = String(valueAt(a, column) ?? "");
          const y = String(valueAt(b, column) ?? "");
          return ascending ? x.localeCompare(y) : y.localeCompare(x);
        });
      }
      if (q.limit !== undefined) hit = hit.slice(0, q.limit);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (q.action === "insert") {
      const incoming = ([] as Row[]).concat(q.values as Row | Row[]);
      const stored = incoming.map((r) => ({ id: `${q.table}-new-${++seq}`, created_at: new Date(now()).toISOString(), ...r }));
      rows.push(...stored);
      return { data: stored.map((r) => ({ ...r })), error: null };
    }
    if (q.action === "update") {
      const hit = rows.filter((r) => matches(r, q));
      for (const r of hit) Object.assign(r, q.values as Row);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    const keep = rows.filter((r) => !matches(r, q));
    const removed = rows.length - keep.length;
    db.tables[q.table] = keep;
    return { data: Array(removed).fill({}), error: null };
  };
}

// ── row builders ─────────────────────────────────────────────────────────────

export const lead = (id: string, stageId: string, over: Row = {}): Row => ({
  id,
  org_id: ORG,
  current_stage_id: stageId,
  stage_entered_at: daysAgo(10),
  last_activity_at: daysAgo(10),
  lane: null,
  lane_set_by: null,
  lane_set_at: null,
  ...over,
});

export const stageRows = (org = ORG): Row[] => FIRM.map((s) => ({ id: s.id, org_id: org, name: s.name, category: s.category, order_index: s.orderIndex }));

let mailSeq = 0;
/** A message the mailbox sync filed on a lead. The body-ish fields are the sentinel: the agent must never copy them. */
export const mail = (leadId: string, type: string, over: { direction?: "inbound" | "outbound"; at?: string; subject?: string; sensitive?: boolean; id?: string } = {}): Row => {
  const direction = over.direction ?? "outbound";
  const at = over.at ?? daysAgo(2);
  return {
    id: over.id ?? `mail-row-${++mailSeq}`,
    org_id: ORG,
    lead_id: leadId,
    matter_id: null,
    type: direction === "outbound" ? "email_sent" : "email_received",
    actor_type: "system",
    created_at: at,
    payload: {
      source: "mailbox-sync",
      message_id: over.id ? `msg-${over.id}` : `msg-${mailSeq}`,
      conversation_id: "conv-1",
      at,
      direction,
      type,
      from: `${SENTINEL}@sender.test`,
      to: [`${SENTINEL}@recipient.test`],
      subject: over.subject ?? `Subject ${mailSeq}`,
      mailbox: `${SENTINEL}@box.test`,
      web_link: `https://outlook.test/${SENTINEL}`,
      body: SENTINEL,
      preview: SENTINEL,
      basis: "email",
      confidence: 1,
      sensitive: over.sensitive ?? false,
      connection_id: "conn-1",
    },
  };
};

export const messageIdOf = (row: Row): string => row.payload.message_id as string;

let eventSeq = 0;
export const event = (leadId: string | null, over: Row = {}): Row => ({
  id: `event-${++eventSeq}`,
  org_id: ORG,
  source: "outlook",
  is_consult: true,
  lead_id: leadId,
  title: "Strategy session",
  starts_at: daysAhead(3),
  ends_at: daysAhead(3).replace("12:00", "13:00"),
  location: SENTINEL,
  organizer_email: `${SENTINEL}@org.test`,
  attendee_emails: [`${SENTINEL}@guest.test`],
  ...over,
});

export const personMove = (leadId: string, daysBack: number, over: Row = {}): Row => ({
  id: `person-move-${leadId.slice(-2)}-${daysBack}`,
  org_id: ORG,
  lead_id: leadId,
  type: "stage_changed",
  actor_type: "user",
  created_at: daysAgo(daysBack),
  payload: { from_stage_id: S.newPnc, to_stage_id: S.pnc, from_stage: "New PNC", to_stage: "Potential New Client" },
  ...over,
});

// ── the world ────────────────────────────────────────────────────────────────

export type WorldInit = {
  stages?: Row[];
  leads?: Row[];
  activity?: Row[];
  events?: Row[];
  brain?: Row[];
  extra?: Record<string, Row[]>;
  refuse?: KeeperDb["refuse"];
  beforeWrite?: KeeperDb["beforeWrite"];
};

export function keeperWorld(init: WorldInit = {}) {
  const db: KeeperDb = {
    tables: {
      crm_stage: init.stages ?? stageRows(),
      crm_lead: init.leads ?? [],
      crm_activity: init.activity ?? [],
      crm_calendar_event: init.events ?? [],
      crm_firm_brain_entry: init.brain ?? [],
      ...(init.extra ?? {}),
    },
    refuse: init.refuse,
    beforeWrite: init.beforeWrite,
  };
  const handler = keeperHandler(db);
  /** A fresh context over the SAME data, so a second run sees what the first wrote. */
  function ctx(autonomy: Autonomy = "act", queue = true) {
    const { llm, calls } = fakeLlm({});
    return { ...agentCtx(handler, { autonomy, llm, queue }), llmCalls: calls };
  }
  return { db, ctx, handler, rows: (t: string) => db.tables[t] ?? [], vi };
}

export const agentRows = (rows: Row[]) => rows.filter((r) => r.type === "stage_changed" && r.payload?.actor === "agent:stage-keeper");
export const suggestionRows = (rows: Row[]) => rows.filter((r) => r.type === "ai_insight" && r.payload?.source === "stage-keeper");

export { L, ORG, OTHER_ORG, S, FIRM, SENTINEL };
