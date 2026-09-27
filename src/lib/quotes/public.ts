import "server-only";

import { createHash } from "node:crypto";

import { getAdminClient } from "@/lib/db/admin";
import {
  DEFAULT_CURRENCY,
  fullProjectCost,
  lineAmountCents,
  quoteReadiness,
  quoteTotals,
  type QuoteLineInput,
} from "./pricing";
import { effectiveQuoteStatus } from "./status";

/**
 * The `/q/[token]` read and write path — the ONLY service-role code in the
 * quote engine, and the only place in this app where a database call is made
 * on behalf of a caller who has no session at all.
 *
 * ── WHY THIS FILE IS ALLOWED A SERVICE-ROLE CLIENT, AND NOTHING ELSE IS ─────
 * Every other quote surface reads through `getScopedClient()`, so RLS —
 * `org_id = current_org_id()` from the JWT — is the real boundary. On
 * `/q/[token]` there is no JWT: `current_org_id()` is null for an anonymous
 * caller, so every policy on `crm_quote` evaluates false and a scoped client
 * returns nothing. That is correct and useless: the client the firm sent a
 * link to must be able to read their own proposal.
 *
 * So RLS cannot be the boundary here. **The token is the entire boundary**, and
 * every rule below exists because of that one fact:
 *
 *  1. The token is 32 bytes of server-side randomness (`store.ts`'s
 *     `generatePublicToken`, floored at 43 chars by `crm_quote_token_len`).
 *     It is never logged, never interpolated into an error message, and never
 *     put in a redirect target.
 *  2. Every read is an EXPLICIT COLUMN ALLOWLIST, never `select('*')` with the
 *     private fields deleted afterwards — a column added by a later migration
 *     joins a `*` automatically, and can never join a list somebody had to type.
 *  3. The row is found by EXACT `public_token` match and nothing else. No
 *     embedded selects, nothing that can walk from this row to another. The
 *     firm's name is a separate single-row lookup keyed on the org id read off
 *     the quote.
 *  4. EVERY WRITE IS FENCED BY `id` AND `org_id` READ FROM THAT ROW — never
 *     taken from the caller. This is the one legitimate use of the service-role
 *     client AGENTS.md allows: a write that stamps the org the row already has.
 *  5. An unknown token is NOT FOUND, and so is a draft, and so is a token of
 *     the wrong shape. A message that told them apart would be an oracle.
 *
 * ── THE WRITES, ALL OF THEM ─────────────────────────────────────────────────
 *   READING THE PAGE       1. one `viewed` event, deduped to one per window.
 *   TICKING BOXES          2. `crm_quote_line.selected` (two set-based updates)
 *                          3. one `selection_changed` event.
 *   SIGNING                4. one conditional update on `crm_quote` that
 *                             cannot fire twice, and 5. one `accepted` event.
 *   DECLINING              6. one conditional update on `crm_quote`, and
 *                          7. one `declined` event.
 * Nothing else. No delete, no write to any other table.
 *
 * ── lectual.app PORT ────────────────────────────────────────────────────────
 * From `lectual` (branch claude/lectual-firm-dashboard-prd-f3loev), minus what
 * is not in both databases: the readable `/proposal/<slug>/<token>` link
 * (0070), client line requests (0071/0073), card payments, the firm logo, and
 * the `quote_accepted` activity row (0062's enum value — `crm_quote_event`
 * already records the acceptance). `declinePublicQuote` is new: the source had
 * no client-side decline.
 *
 * ── THREE-STATE, NOT TWO ────────────────────────────────────────────────────
 * `readPublicQuote` returns `ok` / `not_found` / `unconfigured` / `unavailable`
 * and never a bare null: a database we could not reach, rendered as
 * `notFound()`, tells a client that the proposal they were sent does not exist.
 *
 * ── THE `db` PARAMETER ──────────────────────────────────────────────────────
 * Every exported function takes an optional client. Production never passes
 * one; the seam exists so `tests/quotes/public.test.ts` can drive the
 * double-accept race against a fake.
 */

/* ────────────────────── the untyped client shape ──────────────────────────
 * `crm_quote` and friends are not in the GENERATED `Database` type: 0068 has
 * not been applied to any project (this branch writes SQL for a human to run,
 * per AGENTS.md), so there is nothing to regenerate types from and
 * `.from("crm_quote")` cannot type-check against `SupabaseClient<Database>`.
 *
 * `store.ts` solves this for the scoped client with a `QuotesDbClient` cast and
 * its own narrow interface; this file declares a separate one rather than
 * importing that one, for two reasons. The methods differ — the acceptance
 * guard needs `.is()` and `.or()`, which the scoped-write surface has no use
 * for — and, more to the point, the two clients must not become
 * interchangeable at the type level. A `QuotesDbClient` that a service-role
 * connection also satisfies is one accidental argument away from a public-route
 * client being handed to a scoped-write function, and nothing would complain.
 */

export type PublicDbError = { code?: string; message?: string } | null;
export type PublicDbResult<T = unknown> = { data: T; error: PublicDbError };

export interface PublicDbQuery<T = unknown> extends PromiseLike<PublicDbResult<T>> {
  select(columns: string): PublicDbQuery<T>;
  update(patch: Record<string, unknown>): PublicDbQuery<T>;
  insert(rows: unknown): PublicDbQuery<T>;
  eq(column: string, value: unknown): PublicDbQuery<T>;
  in(column: string, values: readonly unknown[]): PublicDbQuery<T>;
  is(column: string, value: null): PublicDbQuery<T>;
  or(filter: string): PublicDbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): PublicDbQuery<T>;
  limit(count: number): PublicDbQuery<T>;
  maybeSingle(): PromiseLike<PublicDbResult<T>>;
}

export interface PublicQuotesDb {
  from(table: string): PublicDbQuery;
}

/**
 * The service-role connection, built fresh per call and never cached in a
 * module-level singleton — a cached admin client outlives the request that
 * justified it, and this is the one client in the app whose reach is every
 * tenant's data at once.
 *
 * Throws when `SUPABASE_SERVICE_ROLE_KEY` is absent (env.ts validates lazily on
 * first read). Callers turn that into `unconfigured` rather than a 500: a
 * preview deployment without the key should say it cannot load the page, not
 * crash on a stack trace that names the missing variable.
 */
function publicQuotesDb(db?: PublicQuotesDb): PublicQuotesDb {
  return db ?? (getAdminClient() as unknown as PublicQuotesDb);
}

/* ─────────────────────────── column allowlists ──────────────────────────── */

/**
 * Every column of `crm_quote` this route may read.
 *
 * `id` and `org_id` ARE read — a write needs to name its row — but neither ever
 * reaches `PublicQuoteView`. They live on `PublicQuoteHandle`, which the page
 * keeps server-side and never passes to a client component.
 *
 * Not here, deliberately: `matter_id`, `lead_id`, `contact_id`, `created_by`,
 * `public_token` (the caller already has it), and `accepted_ip` /
 * `accepted_user_agent` / `accepted_by_email` (captured FOR the firm's e-sign
 * audit; echoing them back to whoever holds the link is a gift to the wrong
 * holder of it).
 */
export const PUBLIC_QUOTE_COLUMNS = [
  "id",
  "org_id",
  "title",
  "status",
  "currency",
  "intro_body",
  "terms_body",
  "expires_at",
  "sent_at",
  "accepted_at",
  "declined_at",
  "withdrawn_at",
  "accepted_by_name",
  "accepted_snapshot",
] as const;

/**
 * Every column of `crm_quote_line` this route may read.
 *
 * `org_id` and `quote_id` are omitted because they are already known — the
 * query filters on both — and `source_service_item_id` because it is the id of
 * a row in the firm's private service library. It is documented as analytics
 * only with no read path following it; a public page is the last place that
 * should be the first.
 */
export const PUBLIC_QUOTE_LINE_COLUMNS = [
  "id",
  "kind",
  "charge_at",
  "selection",
  "tier_group",
  "selected",
  "label",
  "description",
  "quantity",
  "unit_amount_cents",
  "sort_index",
] as const;

/** The firm's display identity, and nothing else. */
export const PUBLIC_ORG_COLUMNS = ["name"] as const;

const QUOTE_SELECT = PUBLIC_QUOTE_COLUMNS.join(", ");
const LINE_SELECT = PUBLIC_QUOTE_LINE_COLUMNS.join(", ");
const ORG_SELECT = PUBLIC_ORG_COLUMNS.join(", ");

/* ─────────────────────────── payload shapes ─────────────────────────────── */

/** A line as the client sees it. Structurally a `QuoteLineInput`, so it can be
 * handed straight to `pricing.ts` in a client component. */
export type PublicQuoteLine = {
  id: string;
  kind: string;
  charge_at: string;
  selection: string;
  tier_group: string | null;
  selected: boolean;
  label: string;
  description: string | null;
  /** `quantity` and `unit_amount_cents` are typed as loosely as the wire
   * actually is: `unit_amount_cents` is a `bigint`, and PostgREST hands an int8
   * back as a JSON number or a quoted numeral depending on configuration. They
   * are passed to `pricing.ts` — whose `intCents` is deliberately wire-tolerant
   * and refuses anything that is not an integer literal — and never used in
   * arithmetic anywhere else. Typing them `number` here would be a cast that
   * makes `"4750" * 2` look safe. */
  quantity: number | string;
  unit_amount_cents: number | string;
  sort_index: number;
};

export type PublicQuoteFirm = {
  name: string;
};

/**
 * THE CLIENT-FACING PAYLOAD. Everything in here is serialised into the HTML the
 * browser receives, so this type is the security contract, not a convenience:
 * anything added to it is published to whoever holds the link.
 *
 * There is no `id`, no `orgId`, no `token`. The page already has the token from
 * the URL and passes it back to the server actions; putting it in props as well
 * would put it in the RSC payload twice for no gain.
 */
export type PublicQuoteView = {
  title: string;
  /** The EFFECTIVE status (`effectiveQuoteStatus`), so an expired quote reads
   * as expired even when a job never wrote the status back. Never
   * `crm_quote.status` raw. */
  status: string;
  currency: string;
  introBody: string | null;
  termsBody: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  /** The client's own typed signature, echoed on their receipt. The email, IP
   * and user agent captured alongside it are audit fields for the firm and are
   * not read back here. */
  acceptedByName: string | null;
  lines: PublicQuoteLine[];
  /**
   * A digest of THE WHOLE AGREEMENT as rendered here — the lines as priced AND
   * the engagement terms they are priced under. See
   * `quoteAgreementFingerprint`.
   *
   * The FIELD is still called `linesFingerprint` because that is the wire name
   * on `AcceptInput` in `lectual`; what it covers is whatever
   * `quoteAgreementFingerprint` covers — read that, not this name.
   *
   * It is in the client payload so the page can hand it straight back with the
   * signature, which is the only way the server can tell whether the figures
   * the client read are still the firm's figures. Computed here rather than in
   * the browser deliberately: one implementation, on the server, over the exact
   * rows that produced the amounts on screen — a second one in the client
   * component could drift from this one and start disagreeing about what
   * "unchanged" means.
   *
   * Publishing it leaks nothing: every field it is derived from is already in
   * `lines` above.
   */
  linesFingerprint: string;
  /** §5's frozen record — present only once accepted, and then it, not `lines`,
   * is what the receipt renders. */
  acceptedSnapshot: QuoteAcceptedSnapshot | null;
  firm: PublicQuoteFirm;
};

/**
 * The server-side half of a resolved token: the ids and raw state the write
 * paths need. Never passed to a client component, never spread into
 * `PublicQuoteView`.
 */
export type PublicQuoteHandle = {
  quoteId: string;
  orgId: string;
  /** The STORED status, not the effective one — the conditional acceptance
   * update matches on what the row actually says. */
  storedStatus: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  currency: string;
};

export type PublicQuoteRead =
  | { status: "ok"; view: PublicQuoteView; handle: PublicQuoteHandle }
  | { status: "not_found" }
  | { status: "unconfigured" }
  | { status: "unavailable" };

/* ─────────────────────────── token hygiene ──────────────────────────────── */

/**
 * The shape a real token has: unpadded base64url, at least the 43 characters 32
 * random bytes produce, and capped so a multi-kilobyte URL never becomes a
 * database round trip.
 *
 * Checked BEFORE any query, for two reasons. It makes token-guessing traffic
 * free to refuse, and it keeps every character that reaches PostgREST's filter
 * parser inside `[A-Za-z0-9_-]` — a value containing a comma, a parenthesis or
 * a dot is exactly the sort of thing that changes how a filter string is read,
 * and a public route is where a caller gets to choose that value.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,512}$/;

export function isWellFormedPublicToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/* ─────────────────────────── error classification ───────────────────────── */

/**
 * Whether a PostgREST error means "no such row" rather than "the read failed".
 *
 * Branching on `code`, never on message text — the mistake `loadCalendarEvents`
 * was written to avoid. `PGRST116` is "no rows returned for a single-row
 * request"; `maybeSingle()` already reports that as `data: null` with no error,
 * so it is handled defensively rather than expected.
 */
function isNoRowsError(error: PublicDbError): boolean {
  return error?.code === "PGRST116";
}

/* ─────────────────────────── the read ───────────────────────────────────── */

/**
 * Resolve a token to a quote, or say precisely which kind of nothing happened.
 *
 * `now` is passed in rather than sampled here so a test can pin an instant and
 * so the page evaluates expiry against the same instant it renders with — the
 * discipline `status.ts` sets for every time-dependent function in this engine.
 *
 * A `draft` quote resolves to `not_found`. Its token exists (it is minted at
 * creation) but the firm has not sent it, and rendering an unfinished proposal
 * to whoever finds the link would publish a document the firm has not decided
 * to publish. It answers identically to an unknown token, on purpose: a draft
 * that said "not sent yet" would confirm to a caller that their guessed token
 * named a real quote.
 */
export async function readPublicQuote(
  token: string,
  now: Date,
  db?: PublicQuotesDb,
): Promise<PublicQuoteRead> {
  if (!isWellFormedPublicToken(token)) return { status: "not_found" };

  let client: PublicQuotesDb;
  try {
    client = publicQuotesDb(db);
  } catch {
    // env.ts throws when SUPABASE_SERVICE_ROLE_KEY is missing. Nothing about
    // the failure is repeated to the caller — the message names the variable.
    return { status: "unconfigured" };
  }

  try {
    const { data: quoteRow, error } = await client
      .from("crm_quote")
      .select(QUOTE_SELECT)
      // EXACT match on the credential, and the only filter. Nothing else the
      // caller sent is a lookup key.
      .eq("public_token", token)
      .maybeSingle();

    if (error && !isNoRowsError(error)) return { status: "unavailable" };
    if (!quoteRow) return { status: "not_found" };

    const quote = quoteRow as Record<string, unknown>;
    const quoteId = typeof quote.id === "string" ? quote.id : null;
    const orgId = typeof quote.org_id === "string" ? quote.org_id : null;
    // A row that came back without its own keys is not a quote we can safely
    // render or write against; treat it as unreadable rather than guess.
    if (!quoteId || !orgId) return { status: "unavailable" };

    const storedStatus = typeof quote.status === "string" ? quote.status : "draft";
    const expiresAt = asNullableString(quote.expires_at);
    const status = effectiveQuoteStatus({ status: storedStatus, expires_at: expiresAt }, now);

    if (storedStatus === "draft") return { status: "not_found" };

    // Two independent lookups keyed on ids we already hold. No embedding, no
    // `!inner`, nothing that can traverse to a row the token did not name.
    const [linesResult, orgResult] = await Promise.all([
      client
        .from("crm_quote_line")
        .select(LINE_SELECT)
        .eq("quote_id", quoteId)
        // Redundant against the composite FK (a line cannot belong to a quote
        // in another org), and kept anyway: one indexed predicate, and a
        // mis-migrated row could not widen this read even if the constraint
        // were ever dropped.
        .eq("org_id", orgId)
        .order("sort_index", { ascending: true }),
      client.from("crm_org").select(ORG_SELECT).eq("id", orgId).maybeSingle(),
    ]);

    if (linesResult.error && !isNoRowsError(linesResult.error)) return { status: "unavailable" };
    if (orgResult.error && !isNoRowsError(orgResult.error)) return { status: "unavailable" };
    const lines = normalizeLines(linesResult.data);

    const firmName = readString((orgResult.data as Record<string, unknown> | null)?.name);
    if (!firmName) {
      // A quote with no firm behind it cannot be presented honestly — the
      // client is being asked to sign an agreement with someone. Refusing to
      // render is the correct failure; inventing "Your firm" is not.
      return { status: "unavailable" };
    }

    const view: PublicQuoteView = {
      title: readString(quote.title) ?? "Proposal",
      status,
      currency: readString(quote.currency) ?? DEFAULT_CURRENCY,
      introBody: asNullableString(quote.intro_body),
      termsBody: asNullableString(quote.terms_body),
      expiresAt,
      acceptedAt: asNullableString(quote.accepted_at),
      acceptedByName: asNullableString(quote.accepted_by_name),
      lines,
      linesFingerprint: quoteAgreementFingerprint({
        lines,
        termsBody: asNullableString(quote.terms_body),
      }),
      acceptedSnapshot: redactSnapshotForClient(parseAcceptedSnapshot(quote.accepted_snapshot)),
      firm: { name: firmName },
    };

    return {
      status: "ok",
      view,
      handle: {
        quoteId,
        orgId,
        storedStatus,
        expiresAt,
        acceptedAt: view.acceptedAt,
        currency: view.currency,
      },
    };
  } catch {
    // Network failure, DNS, a thrown env read — anything at all. It is never
    // `not_found`: the difference between "this quote does not exist" and "we
    // could not check" is the whole reason this function is three-state.
    return { status: "unavailable" };
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Pass a numeric wire value through UNCHANGED when it is a number or a string,
 * so `pricing.ts` gets to make the judgement about whether it is readable —
 * `intCents` reports an unreadable amount as a blocker, and a coercion here
 * would turn that blocker into a silently cheaper quote. `fallback` covers only
 * the case where the column came back null or absent.
 */
function wireNumber(value: unknown, fallback: number): number | string {
  return typeof value === "number" || typeof value === "string" ? value : fallback;
}

/**
 * Coerce the line rows into the shape the page and `pricing.ts` expect.
 *
 * `unit_amount_cents` is a `bigint` column, and PostgREST hands an int8 back as
 * a JSON number or a quoted numeral depending on configuration. It is left as
 * whichever arrived — `pricing.ts`'s `intCents` is deliberately wire-tolerant
 * and refuses anything that is not an integer literal, and re-parsing here
 * would either duplicate that judgement or, worse, quietly disagree with it.
 */
function normalizeLines(data: unknown): PublicQuoteLine[] {
  if (!Array.isArray(data)) return [];
  const lines: PublicQuoteLine[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = readString(row.id);
    if (!id) continue;
    lines.push({
      id,
      kind: readString(row.kind) ?? "",
      charge_at: readString(row.charge_at) ?? "",
      selection: readString(row.selection) ?? "included",
      tier_group: asNullableString(row.tier_group),
      selected: row.selected !== false,
      label: readString(row.label) ?? "",
      description: asNullableString(row.description),
      quantity: wireNumber(row.quantity, 1),
      unit_amount_cents: wireNumber(row.unit_amount_cents, 0),
      sort_index: typeof row.sort_index === "number" ? row.sort_index : 0,
    });
  }
  return lines;
}

/* ──────────────────── the priced offer, as it was read ──────────────────── */

/**
 * A digest of THE PRICED OFFER: which lines exist, what each costs, how many of
 * it, and when it is charged.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 * The client reads a page, types their name, and signs. Between those two
 * instants a staff member can edit the very lines they are looking at, and
 * nothing about the SELECTION they post back says so — validating line ids
 * catches a line that was added or deleted and is blind to one that was
 * re-priced, because the id is the same id. Before this existed, a client who
 * read "Due today $2,500.00" could be told nothing at all while `$4,750.00` was
 * frozen into `accepted_snapshot` as the amount they had agreed to. §5's frozen
 * record is only worth freezing if it records what someone actually saw.
 *
 * So the page carries this value back with the signature and
 * `acceptPublicQuote` recomputes it from a fresh read: equal means the offer on
 * screen is still the offer, different means it is not and the signature is
 * refused rather than repriced.
 *
 * ── WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT ─────────────────────────────
 * Every field that decides what money appears on the page and when it is due:
 * the line's identity, its `kind` and `charge_at` (which bucket it lands in —
 * a line moved from filing to signing changes "Due today" without changing a
 * single amount), its `selection` and `tier_group` (whether it is a choice at
 * all, and which choice), and the two numbers that multiply into its amount.
 *
 * NOT `selected`: the client's own ticking changes it constantly, and their
 * choice travels separately as `selectedLineIds` and is validated on its own
 * terms. A fingerprint that moved when the client ticked a box would refuse
 * every acceptance that involved a choice.
 *
 * NOT `label`, `description` or `sort_index`: fixing a typo or reordering the
 * list changes nothing about what is owed, and refusing a signature over it
 * would train firms to expect spurious refusals — which is how a real one
 * starts getting clicked through.
 *
 * `quantity` and `unit_amount_cents` are normalised through `pricing.ts`'s own
 * reader rather than stringified raw, for the reason `buildAcceptedSnapshot`
 * does the same: an int8 arrives as `250000` or as `"250000"` depending on
 * PostgREST configuration, and a fingerprint that told those apart would refuse
 * every acceptance in the deployment where the wire format happened to differ
 * between two reads.
 *
 * Sorted, so the digest is over a SET of priced lines and not over the order
 * they came back in. Truncated to 128 bits, which is far more than a staleness
 * check needs — this is a comparison against the firm's own current rows, not a
 * credential, and it authenticates nobody.
 */
export function quoteLinesFingerprint(lines: readonly PublicQuoteLine[]): string {
  const canonical = lines
    .map((line) =>
      [
        line.id,
        line.kind,
        line.charge_at,
        line.selection,
        (line.tier_group ?? "").trim(),
        lineAmountCents({ quantity: line.quantity, unit_amount_cents: 1 }),
        lineAmountCents({ quantity: 1, unit_amount_cents: line.unit_amount_cents }),
      ].join("\u001f"),
    )
    .sort()
    .join("\u001e");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * THE WHOLE AGREEMENT: the priced lines AND the engagement terms they are
 * priced under.
 *
 * ── WHY THE TERMS HAD TO JOIN THE DIGEST ────────────────────────────────────
 * `terms_body` stopped being a footnote the moment it became the engagement
 * letter. The client page presents ONE document — lines, terms, one typed
 * signature — and `accepted_snapshot.quote.terms_body` freezes the terms as
 * signed. A fingerprint over the lines alone left the other half of that
 * document editable while the client had it open: staff could rewrite the fee
 * agreement between the render and the signature, every line id would still
 * resolve, every amount would still match, and the client would have signed
 * terms they never read. That is the defect that was just closed for prices, in
 * this same file, and it is worse for legal terms than for a number — a wrong
 * number is arguable, a term the client never saw is a term they never agreed
 * to.
 *
 * ── WHY THE TERMS ARE COMPARED BYTE FOR BYTE, AND THE LINES ARE NOT ─────────
 * `quoteLinesFingerprint` deliberately EXCLUDES `label`, `description` and
 * `sort_index`: fixing a typo in a line label changes nothing about what is
 * owed, and refusing a signature over it would train firms to expect spurious
 * refusals. The opposite is true here. In `terms_body` the text IS the thing
 * being agreed to, so there is no such thing as a cosmetic edit — a comma moved
 * in a fee clause is a different clause. Nothing is trimmed, normalised or
 * case-folded.
 *
 * Null and empty collide, and that is intended: both render as no terms at all,
 * so a client cannot tell them apart and neither should this.
 *
 * ── WHY IT IS A COMPOSITE AND NOT ONE HASH OVER BOTH ────────────────────────
 * `<lines>.<terms>` keeps the two halves separable, which is what lets the
 * accept path tell the client WHICH half moved — "the amounts changed" and "the
 * terms changed" are different sentences, and a client told the wrong one
 * re-reads the wrong part of the page. A single opaque digest would collapse
 * them into one message that is right half the time.
 */
export function quoteAgreementFingerprint(input: {
  lines: readonly PublicQuoteLine[];
  termsBody: string | null;
}): string {
  const terms = createHash("sha256")
    .update(input.termsBody ?? "")
    .digest("hex")
    .slice(0, 32);
  return `${quoteLinesFingerprint(input.lines)}.${terms}`;
}

/**
 * Which half of a submitted fingerprint no longer matches the current one.
 *
 * A value that is not a well-formed composite — an omitted field, a caller
 * posting whatever they like at this unauthenticated endpoint, a page cached
 * from before the terms joined the digest — reports BOTH halves stale. It is
 * refused either way; reporting both means the client is told to re-read the
 * whole document rather than pointed at one half of it on the strength of a
 * value we could not parse. There is no branch here that treats an unparseable
 * fingerprint as close enough.
 */
function fingerprintDrift(submitted: string, current: string): { lines: boolean; terms: boolean } {
  if (submitted === current) return { lines: false, terms: false };
  const sent = submitted.split(".");
  const now = current.split(".");
  if (sent.length !== 2 || now.length !== 2) return { lines: true, terms: true };
  return { lines: sent[0] !== now[0], terms: sent[1] !== now[1] };
}

/* ─────────────────────────── the snapshot (§5) ──────────────────────────── */

/**
 * Bumped when the SHAPE of the snapshot changes, so a reader can tell records
 * apart instead of inferring it from which keys happen to be present.
 *
 * 1, not `lectual`'s 2: v2 is v1 plus `line_requests` (0071), and this app
 * writes no line requests. A record this app writes is exactly a v1 record, so
 * it says so — a v2 stamp on a record with no `line_requests` key would claim
 * "the client asked for nothing" rather than "this record predates the
 * question".
 */
export const QUOTE_SNAPSHOT_VERSION = 1;

/**
 * Identifies the arithmetic that produced `totals`. Spec §5 asks the snapshot
 * to carry "the pricing-module version"; `pricing.ts` exports no such constant,
 * and this file is the only writer of a snapshot, so it lives here. Bump it
 * whenever `pricing.ts` changes what a given set of lines totals to — not when
 * it changes how it says so.
 */
export const QUOTE_PRICING_VERSION = "quotes/pricing.ts@1";

export type QuoteAcceptedSnapshotLine = {
  id: string;
  kind: string;
  charge_at: string;
  selection: string;
  tier_group: string | null;
  selected: boolean;
  label: string;
  description: string | null;
  quantity: number;
  unit_amount_cents: number;
  /** `quantity × unit_amount_cents`, frozen rather than recomputed on read, so
   * the record is arithmetic-independent: a later pricing change cannot alter
   * what a stored acceptance says the line came to. */
  amount_cents: number;
};

export type QuoteAcceptedSnapshot = {
  snapshot_version: number;
  pricing_version: string;
  accepted_at: string;
  currency: string;
  quote: {
    title: string;
    intro_body: string | null;
    /** The fee-agreement language AS SIGNED. Captured here rather than read
     * live afterwards for the same reason the amounts are. */
    terms_body: string | null;
    expires_at: string | null;
  };
  /** EVERY line, not just the selected ones — the record has to show what was
   * offered as well as what was chosen, or a declined add-on becomes invisible
   * and the quote reads as though it was never on the table. */
  lines: QuoteAcceptedSnapshotLine[];
  totals: {
    due_at_signing: number;
    due_at_filing: number;
    not_charged: number;
    /** Never labelled "total" anywhere, per §0 — it is not an amount due. */
    full_project_cost: number;
  };
  signature: {
    name: string;
    email: string;
  };
};

/** Pure: builds the frozen record. Exported so the shape can be tested without
 * a database, and so the accept path has exactly one way to produce one. */
export function buildAcceptedSnapshot(input: {
  view: Pick<PublicQuoteView, "title" | "introBody" | "termsBody" | "expiresAt" | "currency">;
  lines: readonly PublicQuoteLine[];
  acceptedAt: string;
  name: string;
  email: string;
}): QuoteAcceptedSnapshot {
  const totals = quoteTotals(input.lines as readonly QuoteLineInput[], input.view.currency);
  return {
    snapshot_version: QUOTE_SNAPSHOT_VERSION,
    pricing_version: QUOTE_PRICING_VERSION,
    accepted_at: input.acceptedAt,
    currency: totals.currency,
    quote: {
      title: input.view.title,
      intro_body: input.view.introBody,
      terms_body: input.view.termsBody,
      expires_at: input.view.expiresAt,
    },
    lines: input.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      charge_at: line.charge_at,
      selection: line.selection,
      tier_group: line.tier_group,
      selected: line.selected,
      label: line.label,
      description: line.description,
      // `quantity` and `unit_amount_cents` arrive wire-loose (see
      // PublicQuoteLine) and are frozen here as DEFINITE integers — a legal
      // record with a quoted numeral in it is a record someone has to parse
      // later, and whoever parses it might not parse it the way we did.
      //
      // Both go through pricing.ts's own arithmetic rather than a second
      // parser written here, precisely so the frozen line amounts cannot
      // disagree with the frozen totals computed beside them: `quantity` is
      // the line costed at one cent a unit, `unit_amount_cents` is a single
      // unit of it. One tolerant reader, one answer.
      quantity: lineAmountCents({ quantity: line.quantity, unit_amount_cents: 1 }),
      unit_amount_cents: lineAmountCents({
        quantity: 1,
        unit_amount_cents: line.unit_amount_cents,
      }),
      amount_cents: lineAmountCents(line as QuoteLineInput),
    })),
    totals: {
      due_at_signing: totals.dueAtSigning,
      due_at_filing: totals.dueAtFiling,
      not_charged: totals.notCharged,
      full_project_cost: fullProjectCost(totals),
    },
    signature: { name: input.name, email: input.email },
  };
}

/**
 * Read a stored snapshot back, or null.
 *
 * Tolerant on purpose, and null rather than a partial reconstruction: a receipt
 * built from a snapshot this build cannot parse would be a legal record
 * rendered on a guess. The receipt handles null by confirming the acceptance
 * and its date without the figures — which is true — instead of falling back to
 * the live lines, which is the exact substitution §5 exists to forbid.
 */
export function parseAcceptedSnapshot(value: unknown): QuoteAcceptedSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const totals = snapshot.totals as Record<string, unknown> | undefined;
  const quote = snapshot.quote as Record<string, unknown> | undefined;
  if (!totals || !quote || !Array.isArray(snapshot.lines)) return null;
  if (typeof totals.due_at_signing !== "number" || typeof totals.due_at_filing !== "number") {
    return null;
  }
  return value as QuoteAcceptedSnapshot;
}

/**
 * The snapshot, minus the signer's email address, for the client payload.
 *
 * The column allowlist deliberately does not read `accepted_by_email` back out
 * — a stored email echoed to whoever holds the link is a gift to the wrong
 * holder of it — and the snapshot carries the same address inside
 * `signature.email`. Leaving it there would route around the allowlist through
 * a jsonb column, which is precisely how an allowlist stops meaning anything.
 *
 * The STORED record is untouched: this redaction happens on the way out, to the
 * projection, not to `crm_quote.accepted_snapshot`. The firm's own surfaces read
 * that row through their scoped client and still see the whole signature block,
 * which is the point of capturing it.
 */
function redactSnapshotForClient(
  snapshot: QuoteAcceptedSnapshot | null,
): QuoteAcceptedSnapshot | null {
  if (!snapshot) return null;
  return { ...snapshot, signature: { ...snapshot.signature, email: "" } };
}

/* ─────────────────────────── the `viewed` event ─────────────────────────── */

/**
 * How long after a `viewed` event another one is not worth writing.
 *
 * Engagement tracking wants to know the client opened the proposal — twice, on
 * Tuesday and again on Friday, is a useful fact for the firm. What it does not
 * want is a row per render. This is an UNAUTHENTICATED endpoint that causes a
 * write, which makes it an amplification target with no rate limiter in front
 * of it: anyone holding the link can reload it in a loop. A five-minute window
 * bounds that to twelve rows an hour no matter how hard it is hit, and it
 * improves the audit trail rather than degrading it — "opened 4 times over 3
 * days" is the fact; "opened 900 times" is a page refresh.
 */
export const VIEW_EVENT_WINDOW_MS = 5 * 60 * 1000;

/**
 * A fixed vocabulary, so nothing an anonymous caller typed is ever stored.
 *
 * §3.4 permits "a coarse user-agent string" in the payload of the one event
 * type an anon request can cause. Storing the raw header would put attacker
 * controlled text into a jsonb column that staff surfaces render — the cheapest
 * possible stored-XSS vector, delivered by the one route with no login. Mapping
 * to one of six constants keeps the only fact the firm actually wanted (was
 * this opened on a phone?) and stores nothing else.
 */
export function coarseUserAgent(userAgent: string | null | undefined): string {
  if (typeof userAgent !== "string" || !userAgent.trim()) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/(bot|crawler|spider|preview|slurp|curl|wget|python-requests)/.test(ua)) return "bot";
  if (/(iphone|ipad|android|mobile)/.test(ua)) return "mobile";
  if (/(edg\/|edge)/.test(ua)) return "edge";
  if (/firefox/.test(ua)) return "firefox";
  if (/chrome|chromium|crios/.test(ua)) return "chrome";
  if (/safari/.test(ua)) return "safari";
  return "other";
}

/**
 * Record that the client opened the quote. Never throws, never reports.
 *
 * Swallowed because the audit row is not what the client came for: a
 * `crm_quote_event` insert that fails must not take down the page showing
 * someone the proposal they were sent. This is the same judgement
 * `logActivitySafe` makes, and the exposure is the same shape — a missing log
 * line, not a state change nobody can see.
 */
export async function recordQuoteViewed(
  handle: PublicQuoteHandle,
  userAgent: string | null | undefined,
  now: Date,
  db?: PublicQuotesDb,
): Promise<void> {
  try {
    const client = publicQuotesDb(db);
    const { data, error } = await client
      .from("crm_quote_event")
      .select("created_at")
      .eq("quote_id", handle.quoteId)
      .eq("org_id", handle.orgId)
      .eq("type", "viewed")
      .order("created_at", { ascending: false })
      .limit(1);

    // A failed read of the last view is not a reason to skip the write — but it
    // is also not a reason to write twice, and erring toward writing keeps the
    // firm's engagement record complete.
    if (!error && Array.isArray(data) && data[0]) {
      const last = (data[0] as Record<string, unknown>).created_at;
      const lastMs = typeof last === "string" ? Date.parse(last.replace(" ", "T")) : NaN;
      if (Number.isFinite(lastMs) && now.getTime() - lastMs < VIEW_EVENT_WINDOW_MS) return;
    }

    await client.from("crm_quote_event").insert({
      org_id: handle.orgId,
      quote_id: handle.quoteId,
      type: "viewed",
      actor: "client",
      payload: { ua: coarseUserAgent(userAgent) },
    });
  } catch {
    // Deliberately silent. Nothing is logged, because the only identifier in
    // scope worth logging is the token.
  }
}

/* ─────────────────────────── selection (§4.2) ───────────────────────────── */

export type SelectionRefusal =
  /** The quote is not `sent`, or has expired. */
  | "not_live"
  /** An id that is not one of this quote's own selectable lines. REJECTED, not
   *  filtered out — see `applySelection`. */
  | "unknown_line"
  /** Two options ticked in one mutually-exclusive package group. */
  | "invalid_tier"
  | "not_found"
  | "unconfigured"
  | "unavailable";

export type SelectionResult =
  | { ok: true; lines: PublicQuoteLine[] }
  | { ok: false; reason: SelectionRefusal };

/**
 * Which of a quote's lines the client is allowed to toggle at all.
 * `included` lines are always in the total and cannot be deselected (§4.2, and
 * `crm_quote_line_included_selected` enforces it in the database) — so they are
 * not merely ignored here, they are not part of the addressable set, and naming
 * one in a selection is as invalid as naming another quote's line.
 */
function isSelectable(line: PublicQuoteLine): boolean {
  return line.selection === "optional" || line.selection === "tier_option";
}

/**
 * Validate a client-submitted selection against THIS quote's own lines.
 *
 * Pure, exported, and separately tested, because it is the entire input
 * validation for one of the three writes an anonymous caller can cause.
 *
 * An unrecognised id is REJECTED rather than dropped. Dropping it would mean a
 * client whose form posted a stale id — because the firm edited the quote while
 * they had it open — silently gets a different selection than the one they
 * ticked, and then signs it. A refusal makes them reload and look.
 */
export function validateSelection(
  lines: readonly PublicQuoteLine[],
  requestedIds: readonly string[],
): { ok: true; select: string[]; deselect: string[] } | { ok: false; reason: SelectionRefusal } {
  const selectable = new Map(lines.filter(isSelectable).map((line) => [line.id, line]));
  const requested = new Set<string>();

  for (const id of requestedIds) {
    if (typeof id !== "string" || !selectable.has(id)) return { ok: false, reason: "unknown_line" };
    requested.add(id);
  }

  // At most one option per package group. Zero is fine — the client has not
  // chosen yet, and `quoteReadiness` is what blocks the accept button for that.
  const perGroup = new Map<string, number>();
  for (const id of requested) {
    const line = selectable.get(id);
    if (!line || line.selection !== "tier_option") continue;
    const group = (line.tier_group ?? "").trim();
    if (!group) return { ok: false, reason: "invalid_tier" };
    const count = (perGroup.get(group) ?? 0) + 1;
    if (count > 1) return { ok: false, reason: "invalid_tier" };
    perGroup.set(group, count);
  }

  const select: string[] = [];
  const deselect: string[] = [];
  for (const line of selectable.values()) {
    (requested.has(line.id) ? select : deselect).push(line.id);
  }
  return { ok: true, select, deselect };
}

/** Whether the validated selection is already exactly what the rows say. */
function isUnchangedSelection(
  lines: readonly PublicQuoteLine[],
  select: readonly string[],
): boolean {
  const current = lines.filter((line) => isSelectable(line) && line.selected).map((l) => l.id);
  if (current.length !== select.length) return false;
  const wanted = new Set(select);
  return current.every((id) => wanted.has(id));
}

/**
 * Persist a client's package/add-on choice.
 *
 * Resolves the quote from the TOKEN, never from an id the caller sent. A
 * `"use server"` function is its own POST entry point — it never renders a
 * layout and never inherits a page's checks — so everything this needs is
 * derived here, from the one credential the client legitimately holds.
 */
export async function applyPublicSelection(
  token: string,
  requestedIds: readonly string[],
  now: Date,
  db?: PublicQuotesDb,
): Promise<SelectionResult> {
  const read = await readPublicQuote(token, now, db);
  if (read.status !== "ok") return { ok: false, reason: read.status };
  if (read.view.status !== "sent") return { ok: false, reason: "not_live" };

  const validated = validateSelection(read.view.lines, requestedIds);
  if (!validated.ok) return { ok: false, reason: validated.reason };

  // A selection identical to the stored one writes NOTHING — no update, no
  // event. Two reasons, and both are about this being an unauthenticated write
  // endpoint. It is an amplification target: a loop re-posting the same
  // selection would otherwise append a `crm_quote_event` row per request, in a
  // table with an append-only trigger and no way to prune. And a
  // `selection_changed` row where nothing changed is worse audit data than no
  // row — the firm reads that timeline to see the client deliberating.
  if (isUnchangedSelection(read.view.lines, validated.select)) {
    return { ok: true, lines: read.view.lines };
  }

  try {
    const client = publicQuotesDb(db);
    const { quoteId, orgId } = read.handle;

    // Two set-based updates rather than one per line: fewer round trips, and
    // every predicate re-states the quote and org so a row outside this quote
    // cannot be reached even if an id slipped past validation above.
    if (validated.select.length > 0) {
      const { error } = await client
        .from("crm_quote_line")
        .update({ selected: true })
        .eq("quote_id", quoteId)
        .eq("org_id", orgId)
        .in("id", validated.select);
      if (error) return { ok: false, reason: "unavailable" };
    }
    if (validated.deselect.length > 0) {
      const { error } = await client
        .from("crm_quote_line")
        .update({ selected: false })
        .eq("quote_id", quoteId)
        .eq("org_id", orgId)
        .in("id", validated.deselect);
      if (error) return { ok: false, reason: "unavailable" };
    }

    // The payload holds ids of the firm's own rows — server-derived, never the
    // caller's text.
    //
    // The selection itself is already written; this event is its shadow, so a
    // failure here does not fail the call. It IS read, though: PostgREST
    // resolves with `error` rather than throwing, so an unchecked insert is an
    // audit row that goes missing without a line anywhere saying so.
    const { error: eventError } = await client.from("crm_quote_event").insert({
      org_id: orgId,
      quote_id: quoteId,
      type: "selection_changed",
      actor: "client",
      payload: { selected_line_ids: validated.select },
    });
    if (eventError) {
      console.error(`[quotes] failed to record selection_changed quote=${quoteId}`, eventError);
    }

    const lines = read.view.lines.map((line) =>
      isSelectable(line) ? { ...line, selected: validated.select.includes(line.id) } : line,
    );
    return { ok: true, lines };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/* ─────────────────────────── acceptance (§6.5) ──────────────────────────── */

export type AcceptRefusal =
  | "not_live"
  /** `quoteReadiness` says no — an unchosen package, or a data problem. */
  | "not_ready"
  | "invalid_name"
  | "invalid_email"
  | "unknown_line"
  /** THE FIGURES MOVED. The lines the client read are not the lines the firm
   *  now has — a line was re-priced, re-scheduled, or added — so this signature
   *  would be a signature over a document nobody put in front of them. Sibling
   *  to `unknown_line`, which catches the same interference when it shows up as
   *  an id that no longer exists rather than as an amount that changed. */
  | "quote_changed"
  /** THE TERMS MOVED. Same interference, the other half of the document: the
   *  engagement letter the client read is not the one the firm now has. Kept
   *  distinct from `quote_changed` so the page can tell them which half to
   *  re-read — being sent back to check the amounts when it was a fee clause
   *  that changed is how a client re-signs without noticing. */
  | "terms_changed"
  | "invalid_tier"
  /** THE RACE. Somebody — another tab, a double-submit, a second reader of the
   *  same forwarded email — accepted first, and the conditional update matched
   *  zero rows. Not an error: the quote IS accepted, just not by this request. */
  | "already_resolved"
  | "not_found"
  | "unconfigured"
  | "unavailable";

export type AcceptResult =
  | { ok: true; acceptedAt: string; snapshot: QuoteAcceptedSnapshot }
  | { ok: false; reason: AcceptRefusal; message?: string };

export type AcceptInput = {
  token: string;
  name: string;
  email: string;
  /** The selection as the client last saw it. Applied and validated before the
   * snapshot is frozen, so the choices that are signed are the choices that
   * were ticked. */
  selectedLineIds?: readonly string[];
  /**
   * `PublicQuoteView.linesFingerprint` from the render the client signed on —
   * the other half of "what is signed is what was on screen", and the half that
   * covers the PRICES AND THE ENGAGEMENT TERMS rather than the choices. (The
   * field name predates the terms joining the digest; see
   * `quoteAgreementFingerprint` for what it actually covers.)
   *
   * Required, with no "absent means skip the check" branch, because absent is
   * indistinguishable from a caller who would rather it were not checked: this
   * is an unauthenticated POST endpoint and anything optional here is optional
   * for whoever is posting. A missing value fails the comparison and refuses
   * exactly like a stale one; the page always sends the value it rendered with.
   */
  linesFingerprint: string;
  /** Audit only — an untrusted hint, see `parseInet`. */
  ip: string | null;
  userAgent: string | null;
};

/** A typed signature has to be a name someone could have typed. Bounds only —
 * this is not a place to be clever about what a person's name may contain. */
function normalizeSignatureName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 200 ? name : null;
}

/** Shape check only. An address that bounces is the firm's problem to chase;
 * an address that is not an address at all is a record that helps nobody. */
function normalizeSignatureEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (email.length < 3 || email.length > 320) return null;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) ? email : null;
}

/**
 * An IPv4 or IPv6 literal, or null.
 *
 * `crm_quote.accepted_ip` is `inet`, and Postgres REJECTS a malformed value —
 * so an unvalidated `x-forwarded-for` (which is a comma-separated list, and is
 * whatever the client chose to send) would not corrupt the audit trail, it
 * would make the acceptance fail outright. A client cannot sign because a proxy
 * header was shaped oddly is not a trade this route should make: unparseable
 * means null, and the acceptance still happens.
 *
 * Note what this value is and is not. It is an audit hint. It is not
 * authentication and it is not evidence of identity — anything upstream can set
 * the header — and nothing in this build may treat it as either.
 */
export function parseInet(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim() ?? "";
  if (!first) return null;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const v4 = ipv4.exec(first);
  if (v4) {
    return v4.slice(1).every((octet) => Number(octet) <= 255) ? first : null;
  }
  // Deliberately loose on IPv6: the shape is hex groups and colons, and
  // Postgres does the real parsing. Anything else is dropped.
  if (/^[0-9A-Fa-f:]+$/.test(first) && first.includes(":") && first.length <= 45) return first;
  return null;
}

/** The e-sign audit stores the raw header (it is evidence about the signing
 * session), bounded so a multi-kilobyte header cannot be used to bloat the row. */
function truncateUserAgent(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.slice(0, 400);
}

/**
 * Accept a quote. At most once, ever.
 *
 * ── THE RACE, AND HOW IT IS ACTUALLY CLOSED ─────────────────────────────────
 * Reading the status and then writing "accepted" is a check-then-act, and two
 * requests can both pass the check. This matters more here than almost anywhere
 * else in the product: a second acceptance would overwrite `accepted_snapshot`,
 * which is the frozen legal record of what someone signed.
 *
 * So the decision is not made in JavaScript. It is made by ONE statement:
 *
 *   update crm_quote set ... where id = $1 and org_id = $2
 *                          and status = 'sent' and accepted_at is null
 *                          and (expires_at is null or expires_at > $now)
 *
 * Postgres takes a row lock for the update; the second writer re-evaluates the
 * predicate against the row the first one just wrote, sees `status = 'accepted'`
 * and matches nothing. `.select("id")` makes PostgREST return the rows it
 * actually changed, so ZERO ROWS BACK IS THE SIGNAL — that is how this function
 * knows it lost, and it reports `already_resolved` rather than pretending to
 * have succeeded. The JS checks above the update are for a good error message;
 * this predicate is the guarantee.
 *
 * Expiry is inside the same predicate rather than only checked beforehand, so a
 * quote that expires between the read and the write cannot be signed.
 *
 * ── WHAT IS SIGNED IS WHAT WAS ON SCREEN ────────────────────────────────────
 * The race above is about two clients. This is about the FIRM: a staff member
 * editing the quote while the client has it open. Both halves of the document
 * are checked against what the client actually read — the ids they ticked, via
 * `validateSelection`, and the amounts AND ENGAGEMENT TERMS they were shown,
 * via `quoteAgreementFingerprint`. Ids alone were not enough: a re-priced line
 * keeps its id, so before the fingerprint existed the whole stale-quote guard
 * was silent about the one change that alters what the client owes — and the
 * terms, once the engagement letter started riding this signature, were that
 * same hole again for the wording rather than for the money.
 *
 * ── ORDERING: STATE FIRST, THEN THE EVENT ───────────────────────────────────
 * `store.ts` writes the event BEFORE a lifecycle transition, deliberately, so a
 * crash leaves an audit row with no state change rather than a silent state
 * change. This function inverts that, and the inversion is the point: until the
 * conditional update returns, nobody knows whether THIS request is the one that
 * accepted. An `accepted` event written first would record an acceptance that
 * the loser of the race never performed — a false entry in the audit trail is
 * worse than a missing one. The event write is therefore swallowed: the
 * acceptance is already durable, and telling a client their signature failed
 * when it did not is the one outcome worse than a missing log line.
 */
export async function acceptPublicQuote(
  input: AcceptInput,
  now: Date,
  db?: PublicQuotesDb,
): Promise<AcceptResult> {
  const name = normalizeSignatureName(input.name);
  if (!name) return { ok: false, reason: "invalid_name", message: "Type your full name to sign." };
  const email = normalizeSignatureEmail(input.email);
  if (!email) {
    return { ok: false, reason: "invalid_email", message: "Enter an email we can send a copy to." };
  }

  // LIVENESS IS CHECKED BEFORE THE SELECTION IS TOUCHED, and the order is not
  // cosmetic. A double-submit against an already-accepted quote must come back
  // `already_resolved` — the page turns that into the receipt — and if the
  // selection write ran first it would refuse with its own, blunter
  // `not_live`, which reads to the client as "reload and try again" on a quote
  // they have in fact already signed.
  const read = await readPublicQuote(input.token, now, db);
  if (read.status !== "ok") return { ok: false, reason: read.status };
  if (read.view.status !== "sent") {
    return read.view.status === "accepted"
      ? { ok: false, reason: "already_resolved" }
      : { ok: false, reason: "not_live" };
  }

  // ── NO REFUSAL IS DECIDED AFTER A WRITE IT COULD HAVE BEEN DECIDED BEFORE ─
  // The submitted selection is validated and PROJECTED IN MEMORY first, and
  // readiness is judged against that projection, so every refusal available
  // from the client's own submission leaves the stored rows exactly as it found
  // them.
  //
  // It is NOT true that nothing durable is written before any refusal, and the
  // heading here used to say so. `applyPublicSelection` below commits the
  // client's ticking, and two refusals follow it: its own failure, and the
  // second fingerprint comparison that catches a re-price landing mid-
  // acceptance. What survives such a refusal is the client's OWN selection,
  // saved exactly as the background `saveSelectionAction` would have saved it
  // while they were still reading — no signature, no snapshot, no acceptance,
  // and nothing the firm did not already see them choose. That is the write
  // order this section is actually defending, and the reason it matters is
  // below: it was once the other way round, and a bare POST could strip a
  // client's package while reporting an error.
  //
  // This ordering is a fix, not a preference. The selection used to be written
  // before `quoteReadiness` ran, with no transaction and nothing to roll it
  // back, so `accept({ selectedLineIds: [] })` — a bare POST at a `"use server"`
  // action, which never renders a page and never sees the form — cleared the
  // package the client had chosen and THEN returned "Choose a package." Anyone
  // holding the forwarded link could strip a client's selection while the call
  // reported an error, and the comment here claimed the opposite.
  let lines = read.view.lines;
  if (input.selectedLineIds) {
    const validated = validateSelection(read.view.lines, input.selectedLineIds);
    // Every SelectionRefusal is also an AcceptRefusal, so the reason survives
    // to the page verbatim rather than being flattened into "something failed".
    if (!validated.ok) return { ok: false, reason: validated.reason };
    lines = read.view.lines.map((line) =>
      isSelectable(line) ? { ...line, selected: validated.select.includes(line.id) } : line,
    );
  }

  // ── AND THE FIGURES MUST STILL BE THE FIGURES THE CLIENT READ ─────────────
  // Validating the selection catches a line that was DELETED while the client
  // had the page open, because its id stops resolving. It is blind to one that
  // was RE-PRICED, because the id is the same id — so a client who read "Due
  // today $2,500.00" could sign, be refused nothing, and have $4,750.00 frozen
  // into `accepted_snapshot` as the amount they had agreed to. That is the one
  // failure §5 exists to make impossible: a frozen legal record is only worth
  // freezing if it records what somebody actually saw.
  //
  // So the page sends back the fingerprint it rendered with and this recomputes
  // it from the read above — a fresh read of the firm's CURRENT lines, made
  // inside this request. Equal means the offer on screen is still the offer;
  // different means it is not, and the signature is refused rather than
  // silently applied to the new price.
  //
  // It sits after `validateSelection` so the more specific refusal keeps
  // winning: a line deleted out from under the client still reports
  // `unknown_line`, and only interference that the ids could not reveal reaches
  // here. And it sits before every write below, so a stale quote is refused
  // without leaving anything behind — see the block above.
  //
  // What this does NOT do is make the check atomic with the update. The
  // conditional update guards the QUOTE row (status, expiry, one acceptance);
  // the amounts live on `crm_quote_line`, so an edit landing between this
  // comparison and that statement is still possible, and closing that would
  // mean putting the amounts into the update's own predicate — a schema change,
  // and separate work. This shuts the window that is minutes wide: the one a
  // client actually sits in, reading a proposal and typing their name.
  //
  // AND IT COVERS THE ENGAGEMENT TERMS, not only the figures. `terms_body` is
  // the fee agreement the client is signing (0068), and it is frozen into the
  // snapshot alongside the amounts — so leaving it out of this comparison left
  // exactly the same hole for the LEGAL half of the document that the amounts
  // had for the money half: staff rewrite the terms, every line id still
  // resolves, every figure still matches, and the signature lands on wording
  // the client never saw. The two halves are reported separately because the
  // client has to be told which one to go back and read.
  const drift = fingerprintDrift(input.linesFingerprint, quoteAgreementFingerprint({
    lines,
    termsBody: read.view.termsBody,
  }));
  if (drift.lines) return { ok: false, reason: "quote_changed" };
  if (drift.terms) return { ok: false, reason: "terms_changed" };

  const readiness = quoteReadiness(lines as readonly QuoteLineInput[]);
  if (!readiness.ready) {
    return { ok: false, reason: "not_ready", message: readiness.message };
  }

  // Only now persist it, so the snapshot freezes what the client was looking at
  // rather than what the database happened to hold. Any refusal here still
  // refuses the whole acceptance — a signature over a selection we could not
  // save is a signature over something else.
  //
  // AND THEN CHECK THE PRICES AGAIN, because `applyPublicSelection` performs its
  // OWN read: the rows it hands back are not the rows fingerprinted above, they
  // are whatever the table held a moment later. A comment here used to claim the
  // opposite ("the updated lines come back from that call rather than being
  // re-read"), and that claim was the whole of the residual bug — a re-price
  // landing between the comparison above and that read was accepted and frozen
  // at the new amount, which is the original defect again in a narrower window.
  //
  // Re-comparing is sound precisely because the digest excludes `selected`: the
  // only thing this call is supposed to have changed is the client's own ticking,
  // so a digest that still matches proves nothing about the MONEY moved, while a
  // digest that differs means a real edit landed mid-acceptance.
  if (input.selectedLineIds) {
    const applied = await applyPublicSelection(input.token, input.selectedLineIds, now, db);
    if (!applied.ok) return { ok: false, reason: applied.reason };
    //
    // `termsBody` is carried through from the read above rather than re-read,
    // and the asymmetry is deliberate: the SNAPSHOT's terms also come from that
    // read, so what gets frozen is the wording the client's fingerprint already
    // matched. There is no window here for the lines' problem to recur — the
    // lines have to be re-checked because `applyPublicSelection` re-read THEM
    // and the snapshot is built from what it returned. Re-reading the terms
    // here would compare the snapshot's own value against a newer one and
    // refuse a signature over wording the client did read.
    if (
      quoteAgreementFingerprint({ lines: applied.lines, termsBody: read.view.termsBody }) !==
      input.linesFingerprint
    ) {
      return { ok: false, reason: "quote_changed" };
    }
    lines = applied.lines;
  }

  const acceptedAt = now.toISOString();
  const snapshot = buildAcceptedSnapshot({
    view: read.view,
    lines,
    acceptedAt,
    name,
    email,
  });

  try {
    const client = publicQuotesDb(db);
    const { quoteId, orgId } = read.handle;

    const { data, error } = await client
      .from("crm_quote")
      .update({
        status: "accepted",
        accepted_at: acceptedAt,
        accepted_by_name: name,
        accepted_by_email: email,
        accepted_ip: parseInet(input.ip),
        accepted_user_agent: truncateUserAgent(input.userAgent),
        accepted_snapshot: snapshot,
        updated_at: acceptedAt,
      })
      .eq("id", quoteId)
      .eq("org_id", orgId)
      .eq("status", "sent")
      .is("accepted_at", null)
      // `acceptedAt` is an ISO instant — no commas, no parentheses — so it
      // cannot alter how PostgREST parses this filter string.
      //
      // `gte`, not `gt`, and the difference is one millisecond that matters:
      // `isQuoteExpired` treats the boundary as EXCLUSIVE ("a client clicking
      // accept on the exact millisecond still gets in"), so `gt` here would
      // disagree with it for exactly that instant — the JS check would let the
      // signature through and the database would refuse it, reported to the
      // client as though somebody else had signed first.
      .or(`expires_at.is.null,expires_at.gte.${acceptedAt}`)
      .select("id");

    if (error) return { ok: false, reason: "unavailable" };
    if (!Array.isArray(data) || data.length === 0) {
      // Zero rows changed. Another request got there first, or the quote left
      // `sent` between the read and this statement. Either way this request did
      // NOT accept, and must not say it did.
      return { ok: false, reason: "already_resolved" };
    }

    try {
      // Read, not just awaited: PostgREST answers a refused insert with `error`
      // set instead of throwing, so the `catch` below never saw the ordinary
      // failure. A missing `accepted` event is not worth failing a signature
      // over — but it must not go missing quietly, because it is the quote
      // engine's own record of the moment the client signed.
      const { error: eventError } = await client.from("crm_quote_event").insert({
        org_id: orgId,
        quote_id: quoteId,
        type: "accepted",
        actor: "client",
        payload: {
          accepted_at: acceptedAt,
          due_at_signing_cents: snapshot.totals.due_at_signing,
          due_at_filing_cents: snapshot.totals.due_at_filing,
        },
      });
      if (eventError) {
        console.error(`[quotes] failed to record accepted event quote=${quoteId}`, eventError);
      }
    } catch (err) {
      // See the header: the acceptance is durable, the log line is not worth
      // failing it over.
      console.error(`[quotes] failed to record accepted event quote=${quoteId}`, err);
    }

    return { ok: true, acceptedAt, snapshot };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/* ─────────────────────────── declining ──────────────────────────────────── */

export type DeclineRefusal =
  /** Expired, withdrawn, or already declined. */
  | "not_live"
  /** Already signed. Declining an accepted quote is not a thing a link can do. */
  | "already_resolved"
  | "not_found"
  | "unconfigured"
  | "unavailable";

export type DeclineResult = { ok: true; declinedAt: string } | { ok: false; reason: DeclineRefusal };

/**
 * The client says no. New in lectual.app — the source route had no decline.
 *
 * `declined` is the CLIENT's fact and `withdrawn` is the firm's (status.ts),
 * and both are terminal: after this the page shows the state and nothing else,
 * and the firm sees a `declined` event on the builder.
 *
 * Built exactly like acceptance, because it has the same race. The decision is
 * one conditional UPDATE — `status = 'sent'`, not accepted, not expired — fenced
 * on the id and org read off the token's own row, and ZERO ROWS BACK means this
 * request did not decline. A client double-clicking "Decline" while another tab
 * signs cannot turn a signed agreement into a declined one: whichever statement
 * commits second matches nothing.
 *
 * Nothing the caller sends is stored — no reason text, nothing typed. A client
 * who wants to say why has the firm's email; a free-text field on the one
 * unauthenticated write route is a cost this does not need to carry.
 *
 * State first, then the event, and the event is swallowed — the same ordering
 * and reasoning as `acceptPublicQuote`: until the update returns nobody knows
 * whether this request is the one that declined.
 */
export async function declinePublicQuote(
  token: string,
  now: Date,
  db?: PublicQuotesDb,
): Promise<DeclineResult> {
  const read = await readPublicQuote(token, now, db);
  if (read.status !== "ok") return { ok: false, reason: read.status };
  if (read.view.status !== "sent") {
    return read.view.status === "accepted"
      ? { ok: false, reason: "already_resolved" }
      : { ok: false, reason: "not_live" };
  }

  const declinedAt = now.toISOString();
  try {
    const client = publicQuotesDb(db);
    const { quoteId, orgId } = read.handle;

    const { data, error } = await client
      .from("crm_quote")
      .update({ status: "declined", declined_at: declinedAt, updated_at: declinedAt })
      .eq("id", quoteId)
      .eq("org_id", orgId)
      .eq("status", "sent")
      .is("accepted_at", null)
      // Same boundary as the acceptance predicate — see the `gte` note there.
      .or(`expires_at.is.null,expires_at.gte.${declinedAt}`)
      .select("id");

    if (error) return { ok: false, reason: "unavailable" };
    if (!Array.isArray(data) || data.length === 0) {
      // Signed, withdrawn or expired between the read and this statement. This
      // request declined nothing and must not say it did.
      return { ok: false, reason: "not_live" };
    }

    const { error: eventError } = await client.from("crm_quote_event").insert({
      org_id: orgId,
      quote_id: quoteId,
      type: "declined",
      actor: "client",
      payload: { declined_at: declinedAt },
    });
    if (eventError) {
      console.error(`[quotes] failed to record declined event quote=${quoteId}`, eventError);
    }

    return { ok: true, declinedAt };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
