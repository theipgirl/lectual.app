import { clientFact, earliest, latest, type StopDecision, type StopFacts } from "./stops";
import { rowsOf, str, type StopDb, type StopDbQuery } from "./stop-db";

/**
 * Reads everything recorded about ONE lead that can end a sequence (the
 * `StopFacts` that ./stops.ts reasons over): signed quotes, succeeded
 * payments, matters, a won stage, the newest inbound email, and the newest
 * imported meeting linked to the lead.
 *
 * TWO STATES WOULD BE A LIE, SO THERE ARE TWO PLUS A FAILURE. `ok` means every
 * read came back; `unavailable` means at least one did not, and the caller
 * must FAIL CLOSED — advance() drafts nothing, enrolling refuses, the
 * approval page asks for an explicit confirm. A failed payment read is never
 * "unpaid" (AGENTS.md); a failed quote read is never "unsigned".
 *
 * `orgId` fences every read when the caller holds the service-role client. A
 * scoped caller may omit it: RLS already limits every table to the active org.
 */

export type FactsRead = { status: "ok"; facts: StopFacts } | { status: "unavailable"; error: string };

class ReadFailed extends Error {}

type Row = Record<string, unknown>;

/**
 * One lead's `StopFacts` from the rows already read for it. The ONE place a row
 * becomes a fact, shared by the single-lead read and the batched client read
 * below, so the two cannot disagree about what counts as signed / paid / opened /
 * won.
 */
function factsFromRows(input: {
  lead: Row;
  stage: Row | null;
  quotes: readonly Row[];
  matters: readonly Row[];
  payments: readonly Row[];
  meetings: readonly Row[];
}): StopFacts {
  const { lead } = input;
  const won = input.stage?.category === "won";
  // Signed = accepted_at is set, whatever the status column says now. An
  // accepted quote is immutable, but a status-only filter would read a
  // signature as "unsigned" the day anything relabels that row.
  const signed = input.quotes.map((q) => str(q.accepted_at));
  const paid = input.payments.map((p) => str(p.occurred_at));
  const opened = input.matters.map((m) => str(m.created_at));
  return {
    signedAt: earliest(signed),
    paidAt: earliest(paid),
    matterOpenedAt: earliest(opened),
    wonAt: won ? (str(lead.stage_entered_at) ?? new Date(0).toISOString()) : null,
    lastInboundAt: str(lead.last_inbound_at),
    lastMeetingAt: latest(input.meetings.map((m) => str(m.started_at))),
    signedLatestAt: latest(signed),
    paidLatestAt: latest(paid),
    matterOpenedLatestAt: latest(opened),
  };
}

/** Several leads' facts as one person's: the earliest of the "since when" facts, the newest of the "latest" ones. */
function mergeFacts(all: readonly StopFacts[]): StopFacts {
  return {
    signedAt: earliest(all.map((f) => f.signedAt)),
    paidAt: earliest(all.map((f) => f.paidAt)),
    matterOpenedAt: earliest(all.map((f) => f.matterOpenedAt)),
    wonAt: earliest(all.map((f) => f.wonAt)),
    lastInboundAt: latest(all.map((f) => f.lastInboundAt)),
    lastMeetingAt: latest(all.map((f) => f.lastMeetingAt)),
    signedLatestAt: latest(all.map((f) => f.signedLatestAt ?? f.signedAt)),
    paidLatestAt: latest(all.map((f) => f.paidLatestAt ?? f.paidAt)),
    matterOpenedLatestAt: latest(all.map((f) => f.matterOpenedLatestAt ?? f.matterOpenedAt)),
  };
}

export async function loadStopFacts(db: StopDb, input: { leadId: string; orgId?: string | null }): Promise<FactsRead> {
  const { leadId } = input;
  const fence = (q: StopDbQuery): StopDbQuery => (input.orgId ? q.eq("org_id", input.orgId) : q);
  const read = async (q: PromiseLike<{ data: unknown; error: unknown }>, what: string) => {
    const { data, error } = await q;
    if (error) throw new ReadFailed(`${what} read failed`);
    return data;
  };

  try {
    const lead = (await read(
      fence(db.from("crm_lead").select("id, current_stage_id, stage_entered_at, last_inbound_at").eq("id", leadId)).maybeSingle(),
      "lead",
    )) as Record<string, unknown> | null;
    // A lead this caller cannot see is not "a lead with no facts".
    if (!lead) return { status: "unavailable", error: "lead not visible" };

    const stageId = str(lead.current_stage_id);
    const [stage, quotes, matters, meetings] = await Promise.all([
      stageId
        ? read(fence(db.from("crm_stage").select("id, category").eq("id", stageId)).maybeSingle(), "stage")
        : Promise.resolve(null),
      read(fence(db.from("crm_quote").select("id, accepted_at").eq("lead_id", leadId)), "quote"),
      read(fence(db.from("crm_matter").select("id, created_at").eq("lead_id", leadId)), "matter"),
      read(fence(db.from("crm_meeting").select("id, started_at").eq("lead_id", leadId)), "meeting"),
    ]);

    const quoteRows = rowsOf(quotes);
    const matterRows = rowsOf(matters);
    const quoteIds = quoteRows.map((q) => str(q.id)).filter((v): v is string => !!v);
    const matterIds = matterRows.map((m) => str(m.id)).filter((v): v is string => !!v);

    const payments: Record<string, unknown>[] = [];
    if (quoteIds.length > 0) {
      payments.push(
        ...rowsOf(
          await read(
            fence(db.from("crm_payment").select("id, occurred_at").eq("status", "succeeded").in("quote_id", quoteIds)),
            "payment",
          ),
        ),
      );
    }
    if (matterIds.length > 0) {
      payments.push(
        ...rowsOf(
          await read(
            fence(db.from("crm_payment").select("id, occurred_at").eq("status", "succeeded").in("matter_id", matterIds)),
            "payment",
          ),
        ),
      );
    }

    return {
      status: "ok",
      facts: factsFromRows({
        lead,
        stage: stage as Row | null,
        quotes: quoteRows,
        matters: matterRows,
        payments,
        meetings: rowsOf(meetings),
      }),
    };
  } catch (err) {
    return { status: "unavailable", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Facts for several leads at once (one person can be more than one lead row), merged. */
export async function loadStopFactsForLeads(
  db: StopDb,
  input: { leadIds: readonly string[]; orgId?: string | null },
): Promise<FactsRead> {
  const reads = await Promise.all(input.leadIds.map((leadId) => loadStopFacts(db, { leadId, orgId: input.orgId })));
  const failed = reads.find((r) => r.status !== "ok");
  if (failed) return failed;
  const all = reads.map((r) => (r as { status: "ok"; facts: StopFacts }).facts);
  return { status: "ok", facts: mergeFacts(all) };
}

/** Exact address variants (no LIKE pattern, so nothing in an address is a wildcard). */
function emailVariants(email: string | null): string[] {
  const e = email?.trim();
  if (!e || !e.includes("@") || e.toLowerCase().endsWith(".invalid")) return [];
  return [...new Set([e, e.toLowerCase()])];
}

/**
 * Facts for the PERSON behind one lead row: that lead plus every other lead
 * in the same firm with exactly the same address. One person is often two
 * lead rows (a form submission and an import, a second inquiry), and the
 * quote they signed or the payment they made can sit on the other row. The
 * signing path already stops every same-address lead; this is the same
 * reach for advance()'s guard and for enrolling, so a stop that failed to
 * write, or a fact recorded somewhere that never called the stop (lectual's
 * own dashboard, an import), still can't let the duplicate row be nudged.
 *
 * Fenced on the lead row's own org_id (read first, through whichever client
 * the caller holds), so a service-role caller can't reach across firms and a
 * scoped caller is bounded by RLS as well. A failed read is `unavailable`.
 */
export async function loadStopFactsForPerson(db: StopDb, input: { leadId: string; orgId?: string | null }): Promise<FactsRead> {
  try {
    const first = db.from("crm_lead").select("id, org_id, email").eq("id", input.leadId);
    const { data, error } = await (input.orgId ? first.eq("org_id", input.orgId) : first).maybeSingle();
    if (error) return { status: "unavailable", error: "lead read failed" };
    const lead = data as Record<string, unknown> | null;
    const orgId = str(lead?.org_id);
    if (!lead || !orgId) return { status: "unavailable", error: "lead not visible" };
    const ids = new Set<string>([input.leadId]);
    const emails = emailVariants(str(lead.email));
    if (emails.length > 0) {
      const { data: same, error: sameError } = await db.from("crm_lead").select("id").eq("org_id", orgId).in("email", emails);
      if (sameError) return { status: "unavailable", error: "lead read failed" };
      for (const row of rowsOf(same)) if (str(row.id)) ids.add(row.id as string);
    }
    return await loadStopFactsForLeads(db, { leadIds: [...ids], orgId });
  } catch (err) {
    return { status: "unavailable", error: err instanceof Error ? err.message : String(err) };
  }
}

/* ─────────────────────── which of many leads are clients ──────────────────── */

/**
 * `clients` maps a lead id to the client fact `enrollLead` would refuse it for.
 * A lead that is not in the map is not a client.
 */
export type ClientLeadsRead =
  | { status: "ok"; clients: Map<string, StopDecision> }
  | { status: "unavailable"; error: string };

/**
 * Ids per `.in()` list. A firm can have hundreds of leads and each id adds ~40
 * characters to the request URL, so the lists go out in slices. That is a handful
 * of reads however many leads there are, never one per lead.
 */
const IN_LIST_SIZE = 75;

function slices<T>(values: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += IN_LIST_SIZE) out.push(values.slice(i, i + IN_LIST_SIZE));
  return out;
}

/**
 * Which of `leadIds` are already clients — the answer `enrollLead` gives one lead
 * at a time, for a whole list in a fixed number of reads (the Campaigns enroll
 * picker: a lead who would be refused is not offered).
 *
 * It is not a second rule. Each lead's person (that lead plus every same-address
 * lead in its firm, exactly as `loadStopFactsForPerson` reaches them) is turned
 * into facts by the same `factsFromRows` and `mergeFacts`, and the verdict is the
 * same `clientFact`. A reply or a call is not a client fact, so the meeting and
 * inbound reads are skipped.
 *
 * A failed read is `unavailable`, never "no clients". A lead the caller cannot
 * see is simply absent from the map: it is not in anyone's picker either.
 */
export async function loadClientLeads(db: StopDb, input: { leadIds: readonly string[]; orgId?: string | null }): Promise<ClientLeadsRead> {
  const leadIds = [...new Set(input.leadIds)];
  if (leadIds.length === 0) return { status: "ok", clients: new Map() };
  const fence = (q: StopDbQuery): StopDbQuery => (input.orgId ? q.eq("org_id", input.orgId) : q);
  /** One table, one `.in()` per slice of `values`, the slices in parallel. */
  const readIn = async (table: string, columns: string, column: string, values: readonly string[], narrow?: (q: StopDbQuery) => StopDbQuery): Promise<Row[]> => {
    const parts = await Promise.all(
      slices(values).map(async (slice) => {
        let q = fence(db.from(table).select(columns)).in(column, slice);
        if (narrow) q = narrow(q);
        const { data, error } = await q;
        if (error) throw new ReadFailed(`${table} read failed`);
        return rowsOf(data);
      }),
    );
    return parts.flat();
  };

  try {
    const leadColumns = "id, org_id, email, current_stage_id, stage_entered_at";
    const asked = await readIn("crm_lead", leadColumns, "id", leadIds);
    const variantsOf = (row: Row) => emailVariants(str(row.email));
    const addresses = [...new Set(asked.flatMap(variantsOf))];
    const sameAddress = addresses.length > 0 ? await readIn("crm_lead", leadColumns, "email", addresses) : [];

    // Who is "the person" behind each asked lead: itself plus the same-org rows
    // whose address is one of its exact variants.
    const people = new Map<string, Row>();
    for (const row of [...asked, ...sameAddress]) if (str(row.id)) people.set(row.id as string, row);
    const personOf = new Map<string, string[]>();
    for (const lead of asked) {
      const mine = new Set(variantsOf(lead));
      const ids = new Set<string>([lead.id as string]);
      for (const other of sameAddress) {
        if (other.org_id === lead.org_id && typeof other.email === "string" && mine.has(other.email) && str(other.id)) ids.add(other.id as string);
      }
      personOf.set(lead.id as string, [...ids]);
    }

    const everyone = [...people.keys()];
    const stageIds = [...new Set([...people.values()].map((p) => str(p.current_stage_id)).filter((v): v is string => !!v))];
    const [stages, quotes, matters] = await Promise.all([
      stageIds.length > 0 ? readIn("crm_stage", "id, category", "id", stageIds) : Promise.resolve([] as Row[]),
      readIn("crm_quote", "id, lead_id, accepted_at", "lead_id", everyone),
      readIn("crm_matter", "id, lead_id, created_at", "lead_id", everyone),
    ]);
    const succeeded = (q: StopDbQuery) => q.eq("status", "succeeded");
    const quoteIds = quotes.map((q) => str(q.id)).filter((v): v is string => !!v);
    const matterIds = matters.map((m) => str(m.id)).filter((v): v is string => !!v);
    const [quotePayments, matterPayments] = await Promise.all([
      quoteIds.length > 0 ? readIn("crm_payment", "id, quote_id, matter_id, occurred_at", "quote_id", quoteIds, succeeded) : Promise.resolve([] as Row[]),
      matterIds.length > 0 ? readIn("crm_payment", "id, quote_id, matter_id, occurred_at", "matter_id", matterIds, succeeded) : Promise.resolve([] as Row[]),
    ]);

    // Group everything by the lead row it belongs to. A payment belongs to the
    // lead of its quote and to the lead of its matter, as `loadStopFacts` reads it.
    const stageById = new Map(stages.map((s) => [s.id as string, s]));
    const group = (rows: readonly Row[]) => {
      const by = new Map<string, Row[]>();
      for (const row of rows) {
        const key = str(row.lead_id);
        if (key) by.set(key, [...(by.get(key) ?? []), row]);
      }
      return by;
    };
    const quotesByLead = group(quotes);
    const mattersByLead = group(matters);
    const leadOfQuote = new Map(quotes.map((q) => [q.id as string, str(q.lead_id)]));
    const leadOfMatter = new Map(matters.map((m) => [m.id as string, str(m.lead_id)]));
    const paymentsByLead = new Map<string, Row[]>();
    const addPayment = (leadId: string | null | undefined, row: Row) => {
      if (leadId) paymentsByLead.set(leadId, [...(paymentsByLead.get(leadId) ?? []), row]);
    };
    for (const p of quotePayments) addPayment(leadOfQuote.get(p.quote_id as string), p);
    for (const p of matterPayments) addPayment(leadOfMatter.get(p.matter_id as string), p);

    const factsOf = new Map<string, StopFacts>();
    for (const [id, lead] of people) {
      factsOf.set(
        id,
        factsFromRows({
          lead,
          stage: stageById.get(str(lead.current_stage_id) ?? "") ?? null,
          quotes: quotesByLead.get(id) ?? [],
          matters: mattersByLead.get(id) ?? [],
          payments: paymentsByLead.get(id) ?? [],
          meetings: [],
        }),
      );
    }

    const clients = new Map<string, StopDecision>();
    for (const [leadId, ids] of personOf) {
      const verdict = clientFact(mergeFacts(ids.map((id) => factsOf.get(id) as StopFacts)));
      if (verdict) clients.set(leadId, verdict);
    }
    return { status: "ok", clients };
  } catch (err) {
    return { status: "unavailable", error: err instanceof Error ? err.message : String(err) };
  }
}
