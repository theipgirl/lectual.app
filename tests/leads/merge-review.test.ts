import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLeadMergeSupport } from "@/lib/leads/live";
import { loadClientLeads, loadStopFactsForPerson } from "@/lib/campaigns/stop-facts";
import { leadsForQuote } from "@/lib/campaigns/stop";
import { resolveBatch } from "@/lib/queue/resolve-batch";
import { checkDraftStaleness } from "@/lib/queue/stale";
import { loadOrgContext } from "@/lib/mailbox/sync";
import { buildLeadIndex, linkLead } from "@/lib/calendar/outlook-parse";
import { personIds } from "@/lib/campaigns/person";
import type { QueueItem } from "@/lib/queue/api";
import type { StopDb } from "@/lib/campaigns/stop-db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * M5 review fixes: the person behind a lead includes the leads merged into it (a merged lead's quote still stops the
 * keeper's nudges), and the address matchers FOLLOW a merged lead's old address to its keeper.
 */
const ORG = "org-1";
const K = "11111111-1111-4111-8111-111111111111"; // keeper
const L = "22222222-2222-4222-8222-222222222222"; // merged into K
const OTHER = "33333333-3333-4333-8333-333333333333"; // another live lead
type Row = Record<string, unknown>;

/** A small in-memory PostgREST: select / eq / in / is / not / lt / gte / order / range / limit / maybeSingle / insert. */
function memDb(tables: Record<string, Row[]>, opts: { noMergeColumn?: boolean } = {}) {
  const inserts: Array<{ table: string; rows: Row[] }> = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let cols = "*";
    let single = false;
    let insertRows: Row[] | null = null;
    const q: Record<string, unknown> = {
      select: (c = "*") => ((cols = c), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (v === null ? r[c] != null : r[c] !== v)), q),
      lt: () => q,
      gte: () => q,
      order: () => q,
      range: () => q,
      limit: () => q,
      ilike: () => q,
      update: () => q,
      insert: (rows: Row | Row[]) => ((insertRows = Array.isArray(rows) ? rows : [rows]), q),
      maybeSingle: () => ((single = true), q),
      single: () => ((single = true), q),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        if (insertRows) {
          inserts.push({ table, rows: insertRows });
          return Promise.resolve({ data: null, error: null }).then(ok, bad);
        }
        if (opts.noMergeColumn && table === "crm_lead" && /merged_into_id/.test(cols)) {
          return Promise.resolve({ data: null, error: { code: "42703", message: "no column" } }).then(ok, bad);
        }
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null, count: rows.length }).then(ok, bad);
      },
    };
    return q;
  };
  return { db: { from, rpc: async () => ({ data: ORG, error: null }) }, inserts };
}

const lead = (id: string, email: string, over: Row = {}): Row => ({ id, org_id: ORG, email, current_stage_id: "s-open", stage_entered_at: "2026-10-01T00:00:00Z", last_inbound_at: null, merged_into_id: null, ...over });
const world = (): Record<string, Row[]> => ({
  crm_lead: [lead(K, "keeper@x.com"), lead(L, "old@x.com", { merged_into_id: K }), lead(OTHER, "someone@x.com")],
  crm_stage: [{ id: "s-open", org_id: ORG, category: "open" }],
  crm_quote: [{ id: "q1", org_id: ORG, lead_id: L, accepted_at: "2026-11-01T10:00:00Z", status: "accepted", contact_id: null }],
  crm_payment: [],
  crm_matter: [],
  crm_meeting: [],
  crm_activity: [],
  crm_contact: [],
});

beforeEach(() => resetLeadMergeSupport());
afterEach(() => resetLeadMergeSupport());

describe("1. the person behind a lead includes the leads merged into it", () => {
  it("a quote accepted on a merged lead is a fact for its keeper", async () => {
    const { db } = memDb(world());
    const read = await loadStopFactsForPerson(db as unknown as StopDb, { leadId: K, orgId: ORG });
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.facts.signedAt).toBe("2026-11-01T10:00:00Z");
  });

  it("asking about the merged lead itself resolves to the same person", async () => {
    const { db } = memDb(world());
    const read = await loadStopFactsForPerson(db as unknown as StopDb, { leadId: L, orgId: ORG });
    if (read.status !== "ok") throw new Error(read.status);
    expect(read.facts.signedAt).toBe("2026-11-01T10:00:00Z");
  });

  it("loadClientLeads agrees: the keeper is a client, the unrelated lead is not", async () => {
    const { db } = memDb(world());
    const read = await loadClientLeads(db as unknown as StopDb, { leadIds: [K, OTHER], orgId: ORG });
    if (read.status !== "ok") throw new Error(read.status);
    expect(read.clients.has(K)).toBe(true);
    expect(read.clients.has(OTHER)).toBe(false);
  });

  it("before 0107 (no column) it is the old rule: the lead and its live same-address leads", async () => {
    const tables = world();
    tables.crm_lead = [lead(K, "keeper@x.com"), lead(OTHER, "keeper@x.com")];
    tables.crm_quote = [{ id: "q1", org_id: ORG, lead_id: OTHER, accepted_at: "2026-11-01T10:00:00Z" }];
    const { db } = memDb(tables, { noMergeColumn: true });
    const read = await loadStopFactsForPerson(db as unknown as StopDb, { leadId: K, orgId: ORG });
    if (read.status !== "ok") throw new Error(read.status);
    expect(read.facts.signedAt).toBe("2026-11-01T10:00:00Z");
  });

  it("personIds (pure): a merged lead never matches an address itself; its keeper does", () => {
    const known = new Map<string, Row>([
      [K, lead(K, "keeper@x.com")],
      [L, lead(L, "old@x.com", { merged_into_id: K })],
      [OTHER, lead(OTHER, "old@x.com")],
    ]);
    const v = (e: string | null) => (e ? [e] : []);
    expect(new Set(personIds(known.get(K)!, known, v))).toEqual(new Set([K, L]));
    expect(new Set(personIds(known.get(L)!, known, v))).toEqual(new Set([L, K, OTHER]));
  });
});

describe("2. a quote accepted on a merged lead stops the keeper's sequences", () => {
  it("adds the keeper (and leads at the merged lead's own address)", async () => {
    const { db } = memDb(world());
    const ids = await leadsForQuote(db as unknown as StopDb, { quoteId: "q1", orgId: ORG });
    expect(ids).toContain(K);
    expect(ids).toContain(L);
    expect(ids).not.toContain(OTHER);
  });
});

describe("3. an approval to a merged lead's old address warns and links to the keeper", () => {
  const item = (recipient: string): QueueItem => ({ id: "item-1", type: "CLIENT_EMAIL", status: "pending", recipient, matter_id: null, created_at: "2026-10-15T00:00:00Z" }) as unknown as QueueItem;

  it("resolveBatch follows the old address to the keeper", async () => {
    const { db } = memDb(world());
    const out = await resolveBatch(db as unknown as StopDb, [item("old@x.com")]);
    expect(out.get("item-1")?.leadIds).toEqual([K]);
  });

  it("the stale check links to the keeper and sees the merged lead's signature", async () => {
    const { db } = memDb(world());
    const check = await checkDraftStaleness(item("old@x.com"), db as unknown as StopDb);
    expect(check.status).toBe("stale");
    if (check.status === "stale") expect(check.leadIds).toEqual([K]);
  });
});

describe("4. mail and calendar follow a merged lead's old address", () => {
  it("loadOrgContext lists the keeper under both addresses, its own row first", async () => {
    const { db } = memDb({ ...world(), crm_matter_contact: [], crm_org_member: [] });
    const ctx = await loadOrgContext(db as unknown as SupabaseClient, ORG);
    expect(ctx.leads.map((l) => [l.id, l.email])).toEqual([
      [K, "keeper@x.com"],
      [OTHER, "someone@x.com"],
      [K, "old@x.com"],
    ]);
  });

  it("the calendar link: two addresses of one keeper are one lead; one address on two live leads is still ambiguous", async () => {
    const { db } = memDb({ ...world(), crm_matter_contact: [], crm_org_member: [] });
    const ctx = await loadOrgContext(db as unknown as SupabaseClient, ORG);
    const index = buildLeadIndex(ctx.leads);
    expect(linkLead(["keeper@x.com", "old@x.com"], index)).toBe(K);
    expect(linkLead(["old@x.com"], index)).toBe(K);
    const shared = buildLeadIndex([...ctx.leads, { id: OTHER, email: "old@x.com" }]);
    expect(linkLead(["old@x.com"], shared)).toBeNull();
  });
});

describe("9. automation rules act on the keeper, never on a merged lead", () => {
  it("apply_tag for a merged lead's event files the tag on the keeper", async () => {
    const { db, inserts } = memDb({
      ...world(),
      crm_automation_rule: [{ id: "r1", org_id: ORG, trigger_type: "stage_changed", active: true, dry_run: false, conditions: {}, actions: [{ type: "apply_tag", tagId: "t1" }] }],
      crm_lead_tag: [],
    });
    vi.resetModules();
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => db }));
    const { runRules } = await import("@/lib/automation/engine");
    await runRules("stage_changed", { leadId: L, stageId: "s-open" });
    const tag = inserts.find((i) => i.table === "crm_lead_tag");
    expect(tag?.rows[0]).toMatchObject({ lead_id: K, tag_id: "t1" });
    vi.doUnmock("@/lib/db/scoped-client");
  });
});

describe("7. the mailbox apply never writes a merged lead", () => {
  it("its lead update carries the live filter (a merged lead matches no row)", async () => {
    const { applyRun, planActivities } = await import("@/lib/mailbox/apply");
    const { buildEmailEvidence } = await import("@/lib/intake/email-match");
    const { fakeAdmin } = await import("../mailbox/fake-db");
    const { client, log } = fakeAdmin((q) => {
      if (q.table === "crm_activity" && q.action === "select") return { data: [], error: null };
      if (q.table === "crm_activity" && q.action === "insert") return { data: (q.values as Array<{ payload: unknown }>).map((v, i) => ({ id: `a${i}`, payload: v.payload })), error: null };
      return undefined;
    });
    const leads = [{ id: K, firstName: "Ana", lastName: "Tester", businessName: null, email: "keeper@x.com", markText: null, stageName: null, assignedTo: null, lastOutboundAt: null, lastInboundAt: null }];
    const at = "2026-11-02T09:00:00Z";
    const messages = [{ id: "m1", conversationId: "c1", mailbox: "intake@firm.example", folder: "inbox", direction: "inbound", at, from: { name: null, address: "keeper@x.com" }, to: [{ name: null, address: "intake@firm.example" }], cc: [], subject: "Hello", preview: "hi", webLink: null }] as never;
    const report = buildEmailEvidence({ messages, leads, directory: [] });
    const planned = planActivities({ report, messages, matterFor: () => null, connectionId: "conn-1" });
    await applyRun(client as unknown as SupabaseClient, { orgId: ORG, report, planned, memberRoles: new Map() });
    const update = log.find((q) => q.table === "crm_lead" && q.action === "update");
    expect(update?.filters).toContainEqual({ op: "is", column: "merged_into_id", value: null });
  });
});
