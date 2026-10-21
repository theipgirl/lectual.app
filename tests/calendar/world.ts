import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sealToken } from "@/lib/mailbox/crypto";
import { fakeAdmin, type Filter, type Recorded } from "../mailbox/fake-db";

/**
 * A recording stand-in for everything the mailbox + calendar sync touches: the
 * service-role database, Microsoft's token endpoint, Graph mail and Graph
 * calendarView. No network, no real database.
 */

export const root = randomBytes(32);
export const NOW = Date.parse("2026-10-21T12:00:00Z");
export const WINDOW_FROM = "2026-10-14T12:00:00.000Z";
export const WINDOW_TO = "2026-11-20T12:00:00.000Z";
export const ORG = "11111111-1111-1111-1111-111111111111";
export const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
export const SCOPES_WITH_CALENDAR = ["openid", "email", "offline_access", "User.Read", "Mail.Read", "Mail.ReadWrite", "Calendars.Read"];
export const SCOPES_MAIL_ONLY = ["openid", "email", "offline_access", "User.Read", "Mail.Read", "Mail.ReadWrite"];

export type Conn = Record<string, unknown> & { id: string; org_id: string };

export function conn(id: string, over: Record<string, unknown> = {}): Conn {
  return {
    id,
    org_id: ORG,
    provider: "microsoft",
    email: `${id}@firm.example`,
    status: "active",
    access_token_enc: sealToken(root, `access-${id}`),
    refresh_token_enc: sealToken(root, `refresh-${id}`),
    token_expires_at: "2026-10-21T13:00:00Z", // still fresh: no refresh unless a test wants one
    sync_cursor: null,
    matched_count: 0,
    scopes: SCOPES_WITH_CALENDAR,
    ...over,
  };
}

export type StoredEvent = Record<string, unknown> & { org_id: string; source: string; external_id: string | null };

export type Page = { value?: unknown[]; nextLink?: string; status?: number };

export type World = {
  connections: Conn[];
  leads?: Record<string, Array<{ id: string; email: string | null }>>;
  /** calendarView pages by access token; a function gets (page index, url). */
  calendar?: Record<string, Page[] | ((page: number, url: string) => Page)>;
  /** Pre-existing rows in crm_calendar_event. */
  stored?: StoredEvent[];
  mailStatus?: number;
  tokenResponse?: { status: number; body: unknown };
  /** Make a calendar statement fail. */
  upsertError?: { code?: string; message: string };
  refuseCalendarRun?: boolean;
  throwOnCalendar?: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function applyFilters(rows: StoredEvent[], filters: Filter[]): StoredEvent[] {
  return rows.filter((row) =>
    filters.every((f) => {
      const v = row[f.column];
      if (f.op === "eq") return v === f.value;
      if (f.op === "in") return (f.value as unknown[]).includes(v);
      if (f.op === "gte") return typeof v === "string" && v >= (f.value as string);
      if (f.op === "lt") return typeof v === "string" && v < (f.value as string);
      return true;
    }),
  );
}

export function build(world: World) {
  const stored: StoredEvent[] = [...(world.stored ?? [])];
  const runs: Array<Record<string, unknown>> = [];
  const { client, log } = fakeAdmin((q: Recorded) => {
    if (q.table === "crm_org" && q.action === "select") {
      const orgs = [...new Set(world.connections.map((c) => c.org_id))];
      return { data: orgs.map((id) => ({ id })), error: null };
    }
    if (q.table === "mailbox_connection" && q.action === "select") return { data: world.connections, error: null };
    if (q.table === "crm_lead" && q.action === "select") {
      const org = q.filters.find((f) => f.column === "org_id")?.value as string;
      return { data: (world.leads?.[org] ?? []).map((l) => ({ ...l, first_name: "", last_name: "", business_name: null, mark_text: null, assigned_to: null, last_outbound_at: null, last_inbound_at: null })), error: null };
    }
    if (q.table === "agent_run" && q.action === "insert") {
      const values = q.values as Record<string, unknown>;
      if (values.agent === "calendar-sync" && world.refuseCalendarRun) {
        return { data: null, error: { code: "23514", message: 'new row for relation "agent_run" violates check constraint "agent_run_agent"' } };
      }
      runs.push(values);
      return { data: [{ id: `run-${runs.length}` }], error: null };
    }
    if (q.table === "crm_calendar_event") {
      if (q.action === "insert") {
        if (world.upsertError) return { data: null, error: world.upsertError };
        for (const row of q.values as StoredEvent[]) {
          const at = stored.findIndex((s) => s.org_id === row.org_id && s.source === row.source && s.external_id === row.external_id);
          if (at >= 0) stored[at] = { ...stored[at], ...row };
          else stored.push({ ...row });
        }
        return { data: null, error: null };
      }
      if (q.action === "select") return { data: applyFilters(stored, q.filters).map((s) => ({ external_id: s.external_id })), error: null };
      if (q.action === "delete") {
        const doomed = new Set(applyFilters(stored, q.filters));
        for (let i = stored.length - 1; i >= 0; i -= 1) if (doomed.has(stored[i])) stored.splice(i, 1);
        return { data: null, error: null };
      }
    }
    return undefined;
  });

  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const tokenCalls: URLSearchParams[] = [];
  const calendarCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  const pageCounters = new Map<string, number>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    if (url.includes("login.microsoftonline.com") && url.endsWith("/token")) {
      tokenCalls.push(new URLSearchParams(init?.body as URLSearchParams));
      const r = world.tokenResponse ?? { status: 200, body: { access_token: "access-refreshed", refresh_token: "refresh-rotated", expires_in: 3600 } };
      return json(r.body, r.status);
    }
    if (url.includes("/me/mailFolders/")) {
      if ((world.mailStatus ?? 200) !== 200) return json({}, world.mailStatus);
      return json({ value: [], "@odata.deltaLink": `${url.split("?")[0]}?$deltatoken=1` });
    }
    if (url.includes("/me/calendarView")) {
      calendarCalls.push({ url, headers });
      if (world.throwOnCalendar) throw new Error("network down");
      const token = (headers.authorization ?? "").replace(/^Bearer /, "");
      const source = world.calendar?.[token];
      const n = pageCounters.get(token) ?? 0;
      pageCounters.set(token, n + 1);
      const page: Page = typeof source === "function" ? source(n, url) : (source?.[n] ?? { value: [] });
      if (page.status && page.status !== 200) return json({ error: "boom" }, page.status);
      return json({ value: page.value ?? [], ...(page.nextLink ? { "@odata.nextLink": page.nextLink } : {}) });
    }
    throw new Error(`unrouted ${url}`);
  }) as typeof fetch;

  return {
    admin: client as unknown as SupabaseClient,
    log,
    runs,
    stored,
    calls,
    calendarCalls,
    tokenCalls,
    fetchImpl,
    deps: {
      admin: client as unknown as SupabaseClient,
      root,
      credentials: () => ({ clientId: "cid", clientSecret: "secret" }),
      fetchImpl,
      now: () => NOW,
    },
  };
}

export const upserts = (log: Recorded[]) => log.filter((q) => q.table === "crm_calendar_event" && q.upsert);
export const deletes = (log: Recorded[]) => log.filter((q) => q.table === "crm_calendar_event" && q.action === "delete");
export const eventRows = (log: Recorded[]) => upserts(log).flatMap((q) => q.values as Array<Record<string, unknown>>);
