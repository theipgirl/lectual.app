import "server-only";
import { randomBytes } from "node:crypto";
import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import {
  DEFAULT_CURRENCY,
  isQuoteChargeAt,
  isQuoteLineKind,
  isQuoteLineSelection,
} from "./pricing";
import { normalizePackageName, offerProblems, readOffer } from "./packages";
import {
  assertQuoteTransition,
  effectiveQuoteStatus,
  isQuoteEditable,
  type QuoteStatus,
} from "./status";
import {
  assertIdsMatchSet,
  assertIncludedIsSelected,
  assertLineAmountSign,
  assertLineKindChargeAt,
  assertTierGroupShape,
  QUOTE_STAFF_WRITE_ROLES,
  serviceItemToLineFields,
  findDuplicateLibraryLine,
  type QuoteEventActor,
  type QuoteEventRow,
  type QuoteEventType,
  type QuoteLineRow,
  type QuoteRow,
  type ServiceItemApplyOverrides,
  type ServiceItemRow,
} from "./types";

/**
 * The quote engine's scoped-client CRUD and mutations — the data layer spec
 * `docs/specs/2026-09-09-quote-engine.md` describes, minus the public-token
 * route (§6, a service-role exception this file deliberately does not carry)
 * and the LawPay adapter (§7, its own slice).
 *
 * ── EVERY READ AND WRITE GOES THROUGH THE CALLER'S OWN SCOPED CLIENT ───────
 * No service-role client anywhere below. `getScopedClient()` is called fresh
 * in every exported function (never hoisted/cached across calls, matching
 * `requireMatterWriteRole`'s convention) so every query and mutation carries
 * the caller's `active_org_id` JWT claim and RLS is always the real boundary.
 * `org_id` on every INSERT is read off a PARENT ROW through that same scoped
 * client (a quote's own row for a line; `current_org_id()` for a new quote)
 * — never taken from caller input, same discipline as
 * `src/lib/matters/matters.ts#createMatter` and `#createContact`.
 *
 * ── lectual.app PORT ────────────────────────────────────────────────────────
 * Ported without the pieces whose schema is not in both databases: the
 * readable `public_slug` (0070), client line requests and their promotion
 * (0071/0073), and manual payments (`crm_payment` is there, but this app has no
 * payments surface, so nothing writes it). `updateQuoteDetails` is new here:
 * the source builder could only set title/intro/expiry at creation.
 *
 * ── THE `QuotesDbClient` CAST ───────────────────────────────────────────────
 * See types.ts's header: the quote engine was written against a narrow
 * structural client rather than the generated `Database` type, and the port
 * keeps it that way so the code stays identical to `lectual`'s. `quotesDb()` casts the SAME connection to a
 * narrow structural interface, once, the way
 * `src/lib/automation/engine-client.ts` does for the drip engine. The typed
 * `supabase` client (from `getScopedClient()` directly) is still used
 * alongside it for `.rpc("current_org_id"|"current_org_role")` and
 * `.auth.getUser()`, which ARE already in the generated types and need no
 * cast — only `.from(...)` on the six new tables goes through `db`.
 *
 * ── EVENT / STATE-CHANGE ORDERING (this run's write requirement) ──────────
 * "Do the event write and the state change in one RPC or one transaction
 * where the schema allows it; if you cannot, order them so a crash leaves
 * the audit trail complete rather than the state changed silently."
 *
 * 0068 defines no RPC for a quote transition (unlike 0066's
 * `move_matter_stage`), and the PostgREST client has no ad-hoc multi-table
 * transaction — so every mutation below that has to choose an order chose
 * one of these two, on purpose, never by default:
 *
 *  1. LIFECYCLE TRANSITIONS (`sendQuote`, `withdrawQuote`): EVENT FIRST, then
 *     the state change (`transitionQuote` below), and the event write is NOT
 *     swallowed — if it fails, the whole operation aborts before the status
 *     ever moves. A crash between the two writes leaves a `crm_quote_event`
 *     row describing an attempt with no matching status change yet: visible,
 *     reconcilable, and — critically — NOT what the instruction calls "the
 *     state changed silently" (an `accepted`/`withdrawn` quote, immutable
 *     from that instant on, with zero record of when or by whom). That
 *     failure is the one this ordering exists to make impossible, because on
 *     THIS table the status change is the harder one to notice went wrong:
 *     the row still renders, it just quietly stopped being editable and
 *     nobody knows why.
 *  2. ORDINARY LINE EDITS (`addQuoteLine`, `updateQuoteLine`, `deleteQuoteLine`,
 *     `reorderQuoteLines`, `applyServiceItem`) that also log a supplementary
 *     `revised` event when the quote is already `sent`: MUTATE FIRST, THEN
 *     LOG, and the log is swallowed (`writeQuoteEventSafe`) exactly like
 *     `logActivitySafe` (`src/lib/matters/activity.ts`). These are not
 *     lifecycle "state changes" in the sense the instruction means — the
 *     line edit itself is the record (same reasoning `logActivitySafe`'s own
 *     doc comment gives for `updateMatterIpFields`), and a firm correcting a
 *     typo must never be blocked by a broken audit table. `createQuote` is
 *     the one further exception: its 'created' event necessarily comes AFTER
 *     the row (crm_quote_event.quote_id is a composite FK into crm_quote —
 *     an event cannot reference a row that doesn't exist yet), and is also
 *     swallowed, because the exposure is a still-`draft`, never-sent quote
 *     with a missing 'created' log line — not a legal document silently
 *     going immutable.
 */

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/* ─────────────────────────── the untyped client shape ────────────────────── */

export type QuotesDbError = { code?: string; message?: string } | null;
export type QuotesDbResult<T = unknown> = { data: T; error: QuotesDbError };

export interface QuotesDbQuery<T = unknown> extends PromiseLike<QuotesDbResult<T>> {
  select(columns?: string): QuotesDbQuery<T>;
  insert(rows: unknown): QuotesDbQuery<T>;
  update(patch: unknown): QuotesDbQuery<T>;
  delete(): QuotesDbQuery<T>;
  eq(column: string, value: unknown): QuotesDbQuery<T>;
  in(column: string, values: readonly unknown[]): QuotesDbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): QuotesDbQuery<T>;
  limit(count: number): QuotesDbQuery<T>;
  single(): PromiseLike<QuotesDbResult<T>>;
  maybeSingle(): PromiseLike<QuotesDbResult<T>>;
}

export interface QuotesDbClient {
  from(table: string): QuotesDbQuery;
}

/** The caller's own RLS-scoped client, seen through the quote engine's
 * table shape. Still the SAME connection — the cast changes the type only. */
export function quotesDb(supabase: ScopedClient): QuotesDbClient {
  return supabase as unknown as QuotesDbClient;
}

/* ─────────────────────────── role gate ───────────────────────────────────── */

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the caller's role via `current_org_role()` (same JWT-claim-backed
 * RPC RLS policies use) and requires it be in QUOTE_STAFF_WRITE_ROLES.
 * Mirrors `requireMatterWriteRole` exactly. Re-checked on every call.
 */
export async function requireQuoteWriteRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !QUOTE_STAFF_WRITE_ROLES.includes(data)) {
    throw new Error("You don't have permission to write quotes.");
  }
  return data;
}

/* ─────────────────────────── public token ────────────────────────────────── */

/**
 * §6.1: ">=32 bytes from crypto.randomBytes(32).toString('base64url')".
 * Generated server-side, here only — this file is the entire write surface
 * for `crm_quote.public_token`. 32 random bytes as unpadded base64url is
 * exactly 43 characters, matching `crm_quote_token_len`'s floor.
 */
export function generatePublicToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Shape check for a caller-supplied primary key (`AddQuoteLineInput.id`).
 * Postgres would refuse a non-uuid anyway; this refuses it with a sentence. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─────────────────────────── internal helpers ─────────────────────────────
 * Shared by several exported mutations below; not exported themselves.
 */

/** Fetches a quote's editability-relevant columns and throws if the quote
 * doesn't exist, isn't visible under RLS, or (per status.ts's
 * expiry-aware `effectiveQuoteStatus`) can no longer be edited — an
 * `accepted`/`declined`/`withdrawn` quote, or a `sent` one whose
 * `expires_at` has passed even though the stored status hasn't caught up
 * yet. This is the layer spec §4.1 requires: "an accepted quote is
 * immutable — no line edits... Illegal transitions throw." */
async function loadEditableQuote(
  db: QuotesDbClient,
  quoteId: string,
): Promise<Pick<QuoteRow, "id" | "org_id" | "status">> {
  const { data, error } = await db
    .from("crm_quote")
    .select("id, org_id, status, expires_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Quote not found.");
  const quote = data as Pick<QuoteRow, "id" | "org_id" | "status" | "expires_at">;

  const effective = effectiveQuoteStatus(quote, new Date());
  if (!isQuoteEditable(effective)) {
    throw new Error(`This quote is ${effective} and its lines can no longer be edited.`);
  }
  return { id: quote.id, org_id: quote.org_id, status: quote.status };
}

/** Fetches just enough of a quote to drive a lifecycle transition. Does NOT
 * apply the expiry-aware editability check above — `assertQuoteTransition`
 * (status.ts) is itself the gate here, and it already refuses `sent ->
 * sent`/any terminal-state re-entry, which is the transition table's job,
 * not this function's. */
async function fetchQuoteForTransition(
  db: QuotesDbClient,
  quoteId: string,
): Promise<Pick<QuoteRow, "id" | "org_id" | "status">> {
  const { data, error } = await db
    .from("crm_quote")
    .select("id, org_id, status")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Quote not found.");
  return data as Pick<QuoteRow, "id" | "org_id" | "status">;
}

/** THROWING event write — used only by `transitionQuote`. See the file
 * header: for a lifecycle transition the event must land before the status
 * does, and a failure here must abort the whole transition rather than be
 * swallowed. */
async function writeQuoteEvent(
  db: QuotesDbClient,
  args: {
    orgId: string;
    quoteId: string;
    type: QuoteEventType;
    actor: QuoteEventActor;
    actorUserId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from("crm_quote_event").insert({
    org_id: args.orgId,
    quote_id: args.quoteId,
    type: args.type,
    actor: args.actor,
    actor_user_id: args.actorUserId ?? null,
    payload: args.payload ?? {},
  });
  if (error) throw error;
}

/** SWALLOWED event write for supplementary logging (a `revised` note on an
 * ordinary line edit, a `created` note on a brand-new draft). Mirrors
 * `logActivitySafe` (src/lib/matters/activity.ts) exactly: the mutation this
 * accompanies has already succeeded, the event is not the record, and a
 * broken audit table must never roll a successful edit back or block it. */
async function writeQuoteEventSafe(
  db: QuotesDbClient,
  supabase: ScopedClient,
  quoteId: string,
  orgId: string,
  type: QuoteEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await writeQuoteEvent(db, { orgId, quoteId, type, actor: "firm", actorUserId: user?.id ?? null, payload });
  } catch (err) {
    console.error(`[quotes] failed to record '${type}' event for quote=${quoteId}:`, err);
  }
}

/** The single implementation every lifecycle transition (`sendQuote`,
 * `withdrawQuote`) goes through: validates the move against status.ts's
 * table (throws on an illegal one — a no-op included, per §4.1: re-sending a
 * `sent` quote is a new event on an unchanged status, not "already there,
 * fine"), writes the event FIRST, then the status change. See the file
 * header for why this order and not the reverse. */
async function transitionQuote(args: {
  db: QuotesDbClient;
  supabase: ScopedClient;
  quote: Pick<QuoteRow, "id" | "org_id" | "status">;
  to: QuoteStatus;
  eventType: QuoteEventType;
  quoteUpdate: Record<string, unknown>;
  eventPayload?: Record<string, unknown>;
}): Promise<QuoteRow> {
  const { db, supabase, quote, to, eventType, quoteUpdate, eventPayload } = args;

  assertQuoteTransition(quote.status, to);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  await writeQuoteEvent(db, {
    orgId: quote.org_id,
    quoteId: quote.id,
    type: eventType,
    actor: "firm",
    actorUserId: user?.id ?? null,
    payload: eventPayload ?? {},
  });

  const { data, error } = await db
    .from("crm_quote")
    .update({ ...quoteUpdate, status: to, updated_at: new Date().toISOString() })
    .eq("id", quote.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as QuoteRow;
}

async function nextLineSortIndex(db: QuotesDbClient, quoteId: string): Promise<number> {
  const { data, error } = await db
    .from("crm_quote_line")
    .select("sort_index")
    .eq("quote_id", quoteId)
    .order("sort_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const row = data as { sort_index: number } | null;
  return (row?.sort_index ?? -1) + 1;
}

/* ─────────────────────────── reads ───────────────────────────────────────── */

/** Every line on a quote, sort order. RLS scopes to the caller's org. */
export async function listQuoteLines(quoteId: string): Promise<QuoteLineRow[]> {
  const supabase = await getScopedClient();
  const db = quotesDb(supabase);
  const { data, error } = await db
    .from("crm_quote_line")
    .select("*")
    .eq("quote_id", quoteId)
    .order("sort_index", { ascending: true });
  if (error) throw error;
  return (data as QuoteLineRow[] | null) ?? [];
}

/** A quote's engagement/audit timeline, newest first. RLS scopes to the
 * caller's org. Not three-state (see load.ts) — this is a plain
 * same-database list, the same shape as `activityForMatter`. */
export async function listQuoteEvents(quoteId: string): Promise<QuoteEventRow[]> {
  const supabase = await getScopedClient();
  const db = quotesDb(supabase);
  const { data, error } = await db
    .from("crm_quote_event")
    .select("*")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as QuoteEventRow[] | null) ?? [];
}

/* ─────────────────────────── quote CRUD ──────────────────────────────────── */

export type CreateQuoteInput = {
  title: string;
  matterId?: string | null;
  leadId?: string | null;
  contactId?: string | null;
  introBody?: string | null;
  termsBody?: string | null;
  /** ISO instant. */
  expiresAt?: string | null;
  /** v1 is USD-only (spec §2); anything else is refused at write time. */
  currency?: string;
};

/** Creates a DRAFT quote. Staff-gated. `org_id` is always the caller's active
 * org (never taken from input); `public_token` is generated here, the only
 * place it ever is. */
export async function createQuote(input: CreateQuoteInput): Promise<QuoteRow> {
  const title = input.title?.trim();
  if (!title || title.length > 300) {
    throw new Error("A quote needs a title of 1-300 characters.");
  }
  const currency = (input.currency ?? DEFAULT_CURRENCY).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`'${input.currency}' isn't a valid currency code.`);
  }
  if (currency !== DEFAULT_CURRENCY) {
    // §2: v1 renders USD only; mixed-currency quotes are rejected at write
    // time rather than accepted and silently mis-totalled downstream.
    throw new Error("Lectual quotes are USD-only in this release.");
  }

  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");
  if (orgError) throw orgError;
  if (!orgId) throw new Error("No active organization for the current session.");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ROW FIRST, event second — the one deliberate exception to this file's
  // event-before-mutation rule (see the header): crm_quote_event.quote_id is
  // a composite FK into crm_quote, so an event literally cannot exist before
  // the row it describes does. The exposure is small and bounded: a crash
  // here leaves a real but still-DRAFT quote (never sent, never seen by a
  // client, never accepted) with no 'created' log line — not a legal
  // document whose status moved with no record of it.
  const row = {
    org_id: orgId,
    matter_id: input.matterId ?? null,
    lead_id: input.leadId ?? null,
    contact_id: input.contactId ?? null,
    title,
    status: "draft",
    currency,
    intro_body: input.introBody ?? null,
    terms_body: input.termsBody ?? null,
    expires_at: input.expiresAt ?? null,
    // Minted HERE, at creation, not at send: the column is NOT NULL with a
    // 43-character floor (`crm_quote_token_len`), so a draft cannot exist
    // without one. That is safe because the public route answers a DRAFT's
    // token exactly like an unknown one (`readPublicQuote` → not_found); the
    // link starts working at `sendQuote`, which is what the builder shows.
    public_token: generatePublicToken(),
    created_by: user?.id ?? null,
  };

  const { data, error } = await db.from("crm_quote").insert(row).select("*").single();

  if (error) throw error;
  const quote = data as QuoteRow;

  await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "created", {});

  return quote;
}

/** Transitions a DRAFT quote to SENT. Staff-gated. Does not require
 * `quoteReadiness` (pricing.ts) — sending a proposal with an unmade package
 * choice is the normal case; it's the CLIENT'S job to make that choice, and
 * `quoteReadiness` gates ACCEPTANCE, not sending.
 *
 * It DOES refuse an offer that cannot be signed as built (packages.ts's
 * `offerProblems` marked `blocksSending`): no lines, packages with none
 * offered, a package switched half on. Sending those would put a link in a
 * client's hands that shows them the wrong deal or no deal. */
export async function sendQuote(quoteId: string): Promise<QuoteRow> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const quote = await fetchQuoteForTransition(db, quoteId);
  if (quote.status === "draft") {
    const { data: lineData, error: lineError } = await db
      .from("crm_quote_line")
      .select("id, kind, charge_at, selection, tier_group, selected, label, quantity, unit_amount_cents")
      .eq("quote_id", quoteId)
      .order("sort_index", { ascending: true });
    if (lineError) throw lineError;
    const blocking = offerProblems((lineData as QuoteLineRow[] | null) ?? []).find((p) => p.blocksSending);
    if (blocking) throw new Error(blocking.message);
  }
  return transitionQuote({
    db,
    supabase,
    quote,
    to: "sent",
    eventType: "sent",
    quoteUpdate: { sent_at: new Date().toISOString() },
  });
}

/** The FIRM withdraws a live quote. Staff-gated. Distinct from `declined`
 * (the client's action, written by the public-token route) — §4.1: "they
 * are different facts and are not collapsed." */
export async function withdrawQuote(quoteId: string, note?: string): Promise<QuoteRow> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const quote = await fetchQuoteForTransition(db, quoteId);
  return transitionQuote({
    db,
    supabase,
    quote,
    to: "withdrawn",
    eventType: "withdrawn",
    quoteUpdate: { withdrawn_at: new Date().toISOString() },
    eventPayload: note ? { note } : {},
  });
}

export type UpdateQuoteDetailsInput = {
  title: string;
  introBody: string | null;
  /** ISO instant, or null for "never expires". */
  expiresAt: string | null;
};

/**
 * Edits a quote's header — title, intro and expiry. Staff-gated.
 *
 * New in lectual.app: the source builder could only set these at creation.
 * Written with the same guard `writeTermsBody` (the builder's actions) uses,
 * because the intro and the expiry are on the page the client signs: the
 * status the editability check read is carried into the UPDATE's own
 * predicate, and ZERO ROWS BACK IS THE LOSS SIGNAL. A client acceptance
 * committing between the read and the write makes this match nothing, instead
 * of rewriting the header of a quote that was just signed.
 *
 * `accepted_snapshot` freezes title/intro/expiry at signature, so even a write
 * that raced past this would not change what was signed; the guard is what
 * keeps the firm's own page from disagreeing with the signed copy.
 */
export async function updateQuoteDetails(quoteId: string, input: UpdateQuoteDetailsInput): Promise<void> {
  const title = input.title?.trim();
  if (!title || title.length > 300) {
    throw new Error("A quote needs a title of 1-300 characters.");
  }

  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const quote = await loadEditableQuote(db, quoteId);

  const { data, error } = await db
    .from("crm_quote")
    .update({
      title,
      intro_body: input.introBody,
      expires_at: input.expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", quoteId)
    .eq("status", quote.status)
    .select("id");
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      "This quote changed while you were editing it — nothing was saved. Reload the quote to see its current state.",
    );
  }

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", { change: "details_updated" });
  }
}

/* ─────────────────────────── quote lines ─────────────────────────────────── */

export type AddQuoteLineInput = {
  kind: string;
  chargeAt: string;
  /** Defaults to 'included'. */
  selection?: string;
  tierGroup?: string | null;
  /** Ignored (forced true) when selection is 'included'; defaults to false
   * for 'optional'/'tier_option' when omitted — an add-on starts unticked. */
  selected?: boolean;
  label: string;
  description?: string | null;
  /** Defaults to 1. */
  quantity?: number;
  unitAmountCents: number;
  sourceServiceItemId?: string | null;
  /** The id the new row must be created under, when a caller has to know it
   * before the insert. Nothing in this app passes one today (in `lectual` it
   * is the line-request promotion path); kept so the insert shape is the
   * source's. A colliding id is refused by the PK, never overwrites. */
  id?: string;
};

/** Adds a line to a DRAFT or SENT quote (never an accepted/terminal one —
 * see loadEditableQuote). Staff-gated. `org_id` comes from the quote row,
 * never from the caller. */
export async function addQuoteLine(quoteId: string, input: AddQuoteLineInput): Promise<QuoteLineRow> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const quote = await loadEditableQuote(db, quoteId);

  if (!isQuoteLineKind(input.kind)) throw new Error(`'${input.kind}' isn't a valid line kind.`);
  if (!isQuoteChargeAt(input.chargeAt)) throw new Error(`'${input.chargeAt}' isn't a valid charge schedule.`);
  const selection =
    input.selection !== undefined && isQuoteLineSelection(input.selection) ? input.selection : "included";
  if (input.selection !== undefined && !isQuoteLineSelection(input.selection)) {
    throw new Error(`'${input.selection}' isn't a valid selection.`);
  }
  const label = input.label?.trim();
  if (!label || label.length > 300) throw new Error("A line needs a label of 1-300 characters.");

  assertLineKindChargeAt(input.kind, input.chargeAt);
  assertLineAmountSign(input.kind, input.unitAmountCents);
  assertTierGroupShape(selection, input.tierGroup);

  const selected = selection === "included" ? true : (input.selected ?? false);
  assertIncludedIsSelected(selection, selected);

  const quantity =
    typeof input.quantity === "number" && Number.isSafeInteger(input.quantity) && input.quantity > 0
      ? input.quantity
      : 1;

  const sortIndex = await nextLineSortIndex(db, quoteId);

  if (input.id !== undefined && !UUID_PATTERN.test(input.id)) {
    // Never silently ignored: a caller that passed an id needs the row to carry
    // it (see `id` above), so a malformed one is a bug to surface, not a
    // default to fall back to.
    throw new Error("A line id must be a uuid.");
  }

  const { data, error } = await db
    .from("crm_quote_line")
    .insert({
      ...(input.id === undefined ? {} : { id: input.id }),
      org_id: quote.org_id,
      quote_id: quoteId,
      kind: input.kind,
      charge_at: input.chargeAt,
      selection,
      tier_group: selection === "tier_option" ? input.tierGroup!.trim() : null,
      selected,
      label,
      description: input.description ?? null,
      quantity,
      unit_amount_cents: input.unitAmountCents,
      source_service_item_id: input.sourceServiceItemId ?? null,
      sort_index: sortIndex,
    })
    .select("*")
    .single();
  if (error) throw error;
  const line = data as QuoteLineRow;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
      change: "line_added",
      line_id: line.id,
      label,
    });
  }

  return line;
}

export type UpdateQuoteLineInput = Partial<{
  kind: string;
  chargeAt: string;
  selection: string;
  tierGroup: string | null;
  selected: boolean;
  label: string;
  description: string | null;
  quantity: number;
  unitAmountCents: number;
}>;

/** Edits one line. Staff-gated. Cross-field constraints (gov-fee/signing,
 * discount sign, tier-group shape, included-selected) are validated against
 * the line's RESULTING shape — the patch merged onto the stored row — so a
 * caller that only sends `{ chargeAt: 'signing' }` against an existing
 * government_fee line is refused exactly as if they'd sent the kind too. */
export async function updateQuoteLine(lineId: string, patch: UpdateQuoteLineInput): Promise<QuoteLineRow> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const { data: existing, error: fetchError } = await db
    .from("crm_quote_line")
    .select("*")
    .eq("id", lineId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) throw new Error("That line isn't in your firm.");
  const line = existing as QuoteLineRow;

  const quote = await loadEditableQuote(db, line.quote_id);

  if (patch.kind !== undefined && !isQuoteLineKind(patch.kind)) {
    throw new Error(`'${patch.kind}' isn't a valid line kind.`);
  }
  if (patch.chargeAt !== undefined && !isQuoteChargeAt(patch.chargeAt)) {
    throw new Error(`'${patch.chargeAt}' isn't a valid charge schedule.`);
  }
  if (patch.selection !== undefined && !isQuoteLineSelection(patch.selection)) {
    throw new Error(`'${patch.selection}' isn't a valid selection.`);
  }

  const merged = {
    kind: patch.kind ?? line.kind,
    charge_at: patch.chargeAt ?? line.charge_at,
    selection: patch.selection ?? line.selection,
    tier_group: patch.tierGroup !== undefined ? patch.tierGroup : line.tier_group,
    selected: patch.selected !== undefined ? patch.selected : line.selected,
    unit_amount_cents: patch.unitAmountCents !== undefined ? patch.unitAmountCents : line.unit_amount_cents,
  };
  assertLineKindChargeAt(merged.kind, merged.charge_at);
  assertLineAmountSign(merged.kind, merged.unit_amount_cents);
  assertTierGroupShape(merged.selection, merged.tier_group);
  assertIncludedIsSelected(merged.selection, merged.selected);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.chargeAt !== undefined) update.charge_at = patch.chargeAt;
  if (patch.selection !== undefined) update.selection = patch.selection;
  if (patch.tierGroup !== undefined) update.tier_group = patch.tierGroup;
  if (patch.selected !== undefined) update.selected = patch.selected;
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.quantity !== undefined) update.quantity = patch.quantity;
  if (patch.unitAmountCents !== undefined) update.unit_amount_cents = patch.unitAmountCents;

  const { data, error } = await db.from("crm_quote_line").update(update).eq("id", lineId).select("*").single();
  if (error) throw error;
  const updated = data as QuoteLineRow;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
      change: "line_updated",
      line_id: lineId,
    });
  }

  return updated;
}

/** Removes a line from a DRAFT or SENT quote. Staff-gated. */
export async function deleteQuoteLine(lineId: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const { data: existing, error: fetchError } = await db
    .from("crm_quote_line")
    .select("id, quote_id, label")
    .eq("id", lineId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) throw new Error("That line isn't in your firm.");
  const line = existing as Pick<QuoteLineRow, "id" | "quote_id" | "label">;

  const quote = await loadEditableQuote(db, line.quote_id);

  const { error } = await db.from("crm_quote_line").delete().eq("id", lineId);
  if (error) throw error;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
      change: "line_deleted",
      label: line.label,
    });
  }
}

/** Reassigns `sort_index` for every line on a quote to match `orderedLineIds`.
 * Staff-gated. Every id must belong to this quote and the set must be
 * complete (assertIdsMatchSet, types.ts) — a partial reorder is refused
 * rather than silently leaving stale sort_index values behind. */
export async function reorderQuoteLines(quoteId: string, orderedLineIds: string[]): Promise<QuoteLineRow[]> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const quote = await loadEditableQuote(db, quoteId);

  const { data: existing, error: listError } = await db
    .from("crm_quote_line")
    .select("id")
    .eq("quote_id", quoteId);
  if (listError) throw listError;
  const existingIds = ((existing as Array<{ id: string }> | null) ?? []).map((r) => r.id);

  assertIdsMatchSet(existingIds, orderedLineIds);

  await Promise.all(
    orderedLineIds.map(async (id, index) => {
      const { error } = await db
        .from("crm_quote_line")
        .update({ sort_index: index, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    }),
  );

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", { change: "lines_reordered" });
  }

  const { data: lines, error: reReadError } = await db
    .from("crm_quote_line")
    .select("*")
    .eq("quote_id", quoteId)
    .order("sort_index", { ascending: true });
  if (reReadError) throw reReadError;
  return (lines as QuoteLineRow[] | null) ?? [];
}

/** Applies a service-library item to a quote by COPYING its values (spec
 * §3.3) — never by referencing it. `source_service_item_id` is recorded for
 * analytics only; nothing downstream ever reads the library row again for
 * this line. Staff-gated (assembling a proposal from the library is ordinary
 * casework, distinct from `service-library.ts`'s admin gate on the library
 * itself). */
export async function applyServiceItem(
  quoteId: string,
  serviceItemId: string,
  overrides: ServiceItemApplyOverrides = {},
): Promise<QuoteLineRow> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const quote = await loadEditableQuote(db, quoteId);

  // Re-resolved through the CALLER'S OWN scoped client — same discipline as
  // linkMatterContact (src/lib/matters/contacts.ts): a service item id
  // belonging to another org is simply invisible under RLS, so this throws
  // "not found" rather than silently copying nothing or, worse, copying a
  // row the caller was never meant to see.
  const { data: item, error: itemError } = await db
    .from("crm_service_item")
    .select("*")
    .eq("id", serviceItemId)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) throw new Error("That service isn't in your firm's library.");

  const fields = serviceItemToLineFields(item as ServiceItemRow, overrides);
  assertLineKindChargeAt(fields.kind, fields.charge_at);
  assertLineAmountSign(fields.kind, fields.unit_amount_cents);
  assertTierGroupShape(fields.selection, fields.tier_group);
  assertIncludedIsSelected(fields.selection, fields.selected);

  // The same service added again: one line with a higher quantity, not two
  // identical rows on the client's page (findDuplicateLibraryLine).
  const { data: sameItemRows, error: sameItemError } = await db
    .from("crm_quote_line")
    .select("*")
    .eq("quote_id", quoteId)
    .eq("source_service_item_id", serviceItemId);
  if (sameItemError) throw sameItemError;
  const duplicate = findDuplicateLibraryLine((sameItemRows as QuoteLineRow[] | null) ?? [], fields);
  if (duplicate) {
    const quantity = Number(duplicate.quantity) + fields.quantity;
    const { data: bumped, error: bumpError } = await db
      .from("crm_quote_line")
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq("id", duplicate.id)
      .eq("quote_id", quoteId)
      .select("*")
      .single();
    if (bumpError) throw bumpError;
    if (quote.status === "sent") {
      await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
        change: "line_quantity_changed",
        source_service_item_id: serviceItemId,
        line_id: duplicate.id,
        quantity: String(quantity),
      });
    }
    return bumped as QuoteLineRow;
  }

  const sortIndex = await nextLineSortIndex(db, quoteId);

  const { data, error } = await db
    .from("crm_quote_line")
    .insert({ org_id: quote.org_id, quote_id: quoteId, ...fields, sort_index: sortIndex })
    .select("*")
    .single();
  if (error) throw error;
  const line = data as QuoteLineRow;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
      change: "service_item_applied",
      source_service_item_id: serviceItemId,
      line_id: line.id,
    });
  }

  return line;
}


/* ─────────────────────────── packages and add-ons ─────────────────────────
 * The design's builder, on the same table (see packages.ts for the mapping):
 * a package is every `tier_option` line sharing a `tier_group`, and its
 * "offered" switch is `selected` on all of those lines at once. Every function
 * below is staff-gated, refuses a quote that is no longer editable, writes
 * through the caller's own scoped client, and fences every multi-row write on
 * `quote_id` AND `tier_group` so it cannot reach another package's lines.
 */

/** Where a new line goes. */
export type LinePlacement =
  | { kind: "common" }
  | { kind: "package"; name: string }
  | { kind: "add_on" };

type PlacementFields = { selection: "included" | "optional" | "tier_option"; tierGroup: string | null; selected: boolean };

type OfferRow = Pick<QuoteLineRow, "id" | "selection" | "tier_group" | "selected" | "kind" | "charge_at" | "quantity" | "unit_amount_cents" | "label">;

async function readOfferRows(db: QuotesDbClient, quoteId: string): Promise<OfferRow[]> {
  const { data, error } = await db
    .from("crm_quote_line")
    .select("id, selection, tier_group, selected, kind, charge_at, quantity, unit_amount_cents, label")
    .eq("quote_id", quoteId)
    .order("sort_index", { ascending: true });
  if (error) throw error;
  return (data as OfferRow[] | null) ?? [];
}

/**
 * The selection fields a line gets from where it is placed. A line joining an
 * EXISTING package takes that package's switch, so a package is never left half
 * offered by an addition; a new package, and a new add-on, start offered.
 */
async function placementFields(db: QuotesDbClient, quoteId: string, placement: LinePlacement): Promise<PlacementFields> {
  if (placement.kind === "common") return { selection: "included", tierGroup: null, selected: true };
  if (placement.kind === "add_on") return { selection: "optional", tierGroup: null, selected: true };
  const name = normalizePackageName(placement.name);
  if (!name) throw new Error("A package needs a name of 1-120 characters.");
  const pkg = readOffer(await readOfferRows(db, quoteId)).packages.find((p) => p.name === name);
  return { selection: "tier_option", tierGroup: name, selected: pkg ? pkg.offered : true };
}

/** `addQuoteLine`, placed in a package, in every package, or as an add-on. */
export async function addLineTo(
  quoteId: string,
  input: Omit<AddQuoteLineInput, "selection" | "tierGroup" | "selected">,
  placement: LinePlacement,
): Promise<QuoteLineRow> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);
  await loadEditableQuote(db, quoteId);
  const fields = await placementFields(db, quoteId, placement);
  return addQuoteLine(quoteId, { ...input, ...fields });
}

/** `applyServiceItem` (a COPY of the library item), placed the same way. */
export async function applyServiceItemTo(quoteId: string, serviceItemId: string, placement: LinePlacement): Promise<QuoteLineRow> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);
  await loadEditableQuote(db, quoteId);
  const fields = await placementFields(db, quoteId, placement);
  return applyServiceItem(quoteId, serviceItemId, fields);
}

/**
 * Offer or withhold a whole package. Refuses to withhold the last offered
 * package — the design's own rule, and the reason: a quote with packages and
 * none offered shows the client nothing to choose.
 */
export async function setPackageOffered(quoteId: string, packageName: string, offered: boolean): Promise<void> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);
  const quote = await loadEditableQuote(db, quoteId);

  const name = normalizePackageName(packageName);
  const offer = readOffer(await readOfferRows(db, quoteId));
  const pkg = offer.packages.find((p) => p.name === name);
  if (!name || !pkg) throw new Error("That package isn't on this quote.");
  if (!offered && !offer.packages.some((p) => p.name !== name && p.offered)) {
    throw new Error("At least one package has to be offered.");
  }

  const { error } = await db
    .from("crm_quote_line")
    .update({ selected: offered, updated_at: new Date().toISOString() })
    .eq("quote_id", quoteId)
    .eq("selection", "tier_option")
    .eq("tier_group", name);
  if (error) throw error;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
      change: offered ? "package_offered" : "package_withheld",
      package: name,
    });
  }
}

/** Offer or withhold one add-on. Only an `optional` line has this switch. */
export async function setAddOnOffered(lineId: string, offered: boolean): Promise<void> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const { data, error: readError } = await db
    .from("crm_quote_line")
    .select("id, quote_id, selection, label")
    .eq("id", lineId)
    .maybeSingle();
  if (readError) throw readError;
  const line = data as Pick<QuoteLineRow, "id" | "quote_id" | "selection" | "label"> | null;
  if (!line) throw new Error("That line isn't in your firm.");
  if (line.selection !== "optional") throw new Error("Only an add-on can be offered on its own.");
  const quote = await loadEditableQuote(db, line.quote_id);

  const { error } = await db
    .from("crm_quote_line")
    .update({ selected: offered, updated_at: new Date().toISOString() })
    .eq("id", lineId)
    .eq("quote_id", line.quote_id);
  if (error) throw error;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
      change: offered ? "add_on_offered" : "add_on_withheld",
      label: line.label,
    });
  }
}

/** Rename a package — its lines' `tier_group`, together. */
export async function renamePackage(quoteId: string, from: string, to: string): Promise<string> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);
  const quote = await loadEditableQuote(db, quoteId);

  const source = normalizePackageName(from);
  const target = normalizePackageName(to);
  if (!source) throw new Error("That package isn't on this quote.");
  if (!target) throw new Error("A package needs a name of 1-120 characters.");
  if (source === target) return target;
  const offer = readOffer(await readOfferRows(db, quoteId));
  if (!offer.packages.some((p) => p.name === source)) throw new Error("That package isn't on this quote.");
  if (offer.packages.some((p) => p.name === target)) throw new Error(`There's already a package called “${target}”.`);

  const { error } = await db
    .from("crm_quote_line")
    .update({ tier_group: target, updated_at: new Date().toISOString() })
    .eq("quote_id", quoteId)
    .eq("selection", "tier_option")
    .eq("tier_group", source);
  if (error) throw error;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
      change: "package_renamed",
      from: source,
      package: target,
    });
  }
  return target;
}

/** Copy a package's lines into a new package — the fast way to build "Filing
 * only" out of "Full prosecution". The copy starts offered. */
export async function duplicatePackage(quoteId: string, from: string, to: string): Promise<string> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);
  const quote = await loadEditableQuote(db, quoteId);

  const source = normalizePackageName(from);
  const target = normalizePackageName(to);
  if (!source) throw new Error("That package isn't on this quote.");
  if (!target) throw new Error("A package needs a name of 1-120 characters.");
  const offer = readOffer(await readOfferRows(db, quoteId));
  if (offer.packages.some((p) => p.name === target)) throw new Error(`There's already a package called “${target}”.`);

  const { data, error: readError } = await db
    .from("crm_quote_line")
    .select("*")
    .eq("quote_id", quoteId)
    .eq("selection", "tier_option")
    .eq("tier_group", source)
    .order("sort_index", { ascending: true });
  if (readError) throw readError;
  const lines = (data as QuoteLineRow[] | null) ?? [];
  if (lines.length === 0) throw new Error("That package isn't on this quote.");

  const start = await nextLineSortIndex(db, quoteId);
  const { error } = await db.from("crm_quote_line").insert(
    lines.map((line, i) => ({
      org_id: quote.org_id,
      quote_id: quoteId,
      kind: line.kind,
      charge_at: line.charge_at,
      selection: "tier_option",
      tier_group: target,
      selected: true,
      label: line.label,
      description: line.description,
      quantity: line.quantity,
      unit_amount_cents: line.unit_amount_cents,
      source_service_item_id: line.source_service_item_id,
      sort_index: start + i,
    })),
  );
  if (error) throw error;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", {
      change: "package_added",
      from: source,
      package: target,
    });
  }
  return target;
}

/** Remove a package and every line in it. Refuses to remove the last offered
 * package while other (withheld) packages remain. */
export async function deletePackage(quoteId: string, packageName: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);
  const quote = await loadEditableQuote(db, quoteId);

  const name = normalizePackageName(packageName);
  const offer = readOffer(await readOfferRows(db, quoteId));
  const pkg = offer.packages.find((p) => p.name === name);
  if (!name || !pkg) throw new Error("That package isn't on this quote.");
  const others = offer.packages.filter((p) => p.name !== name);
  if (others.length > 0 && !others.some((p) => p.offered)) {
    throw new Error("At least one package has to be offered — switch another package on first.");
  }

  const { error } = await db
    .from("crm_quote_line")
    .delete()
    .eq("quote_id", quoteId)
    .eq("selection", "tier_option")
    .eq("tier_group", name);
  if (error) throw error;

  if (quote.status === "sent") {
    await writeQuoteEventSafe(db, supabase, quote.id, quote.org_id, "revised", { change: "package_removed", package: name });
  }
}
