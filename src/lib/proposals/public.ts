import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import { firmCivilDate } from "@/lib/quotes/firm-time";
import { resolveTimeZone } from "@/lib/org/profile-rules";
import { normalizeSelection, quoteHasItems, quoteProposal } from "./pricing";
import {
  isWellFormedProposalToken,
  type AcceptedSnapshot,
  type ProposalContent,
  type ProposalQuote,
  type ProposalStatus,
  type Selection,
} from "./types";
import { isCivilDate } from "./validate";

/**
 * The `/p/[token]` read and write path — the ONLY service-role code in the
 * proposals module, and the only place a call is made on behalf of a caller
 * with no session at all. Same reasoning, and the same rules, as
 * `src/lib/quotes/public.ts`:
 *
 * ── THE TOKEN IS THE ENTIRE BOUNDARY ────────────────────────────────────────
 * On `/p/[token]` there is no JWT, so RLS returns nothing and cannot be the
 * boundary. Everything below follows from that.
 *  1. The token is 32 bytes of server-side randomness (`store.ts`), never
 *     logged, never interpolated into an error, never put in a redirect.
 *  2. Every read is an EXPLICIT COLUMN ALLOWLIST. A column added by a later
 *     migration joins a `select('*')` automatically and can never join a list
 *     somebody had to type. The client's email, the lead and matter ids, the
 *     staff user ids and the token itself are not in the list.
 *  3. The proposal is found by EXACT `public_token` match with one `.eq`, and
 *     nothing else the caller sent is a lookup key. (A family's versions share
 *     one token, so that query returns the family; the live row is picked from
 *     it in code.) The firm's name is a separate single-row lookup on the org
 *     id read off the row.
 *  4. EVERY WRITE IS FENCED BY `id` AND `org_id` READ FROM THAT ROW, never from
 *     the caller: the one legitimate service-role write, stamping the org the
 *     row already has.
 *  5. An unknown token, a token of the wrong shape, and a family that has only
 *     drafts all answer `not_found` identically: a message that told them apart
 *     would be an oracle.
 *
 * ── WHAT THE CLIENT CAN CAUSE, ALL OF IT ────────────────────────────────────
 *   OPENING THE PAGE   one `viewed` event, deduped to one per window.
 *   TICKING BOXES      nothing. The pick lives on the client's page.
 *   ACCEPTING          one conditional update (`status = 'sent'` -> accepted,
 *                      with `accepted_selection` and `accepted_snapshot`) that
 *                      cannot fire twice, then a best-effort firm notice.
 * The `accepted` EVENT is written by the 0086 trigger in the same transaction
 * as the status change (it knows the actor), so it is not written here: a
 * second one would double every acceptance in the firm's log.
 *
 * ── THREE-STATE, NOT TWO ────────────────────────────────────────────────────
 * Reads return ok / closed / not_found / unconfigured / unavailable and never a
 * bare null: a database we could not reach, rendered as `notFound()`, tells a
 * client that the proposal they were sent does not exist.
 *
 * ── THE `db` PARAMETER ──────────────────────────────────────────────────────
 * Every exported function takes an optional client. Production never passes
 * one; the seam exists so a test can drive the double-accept race against a fake.
 */

/* ────────────────────── the untyped client shape ──────────────────────────
 * Separate from store.ts's scoped-client interface on purpose: the two clients
 * must not become interchangeable at the type level, or a service-role
 * connection could be handed to a scoped-write function by one wrong argument.
 */

export type PublicDbError = { code?: string; message?: string } | null;
export type PublicDbResult<T = unknown> = { data: T; error: PublicDbError };

export interface PublicDbQuery<T = unknown> extends PromiseLike<PublicDbResult<T>> {
  select(columns: string): PublicDbQuery<T>;
  update(patch: Record<string, unknown>): PublicDbQuery<T>;
  insert(rows: unknown): PublicDbQuery<T>;
  eq(column: string, value: unknown): PublicDbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): PublicDbQuery<T>;
  limit(count: number): PublicDbQuery<T>;
  maybeSingle(): PromiseLike<PublicDbResult<T>>;
}

export interface PublicProposalsDb {
  from(table: string): PublicDbQuery;
}

/**
 * The service-role connection, built fresh per call and never cached: a cached
 * admin client outlives the request that justified it. Throws when the key is
 * absent; callers turn that into `unconfigured` rather than a 500.
 */
function publicProposalsDb(db?: PublicProposalsDb): PublicProposalsDb {
  return db ?? (getAdminClient() as unknown as PublicProposalsDb);
}

/* ─────────────────────────── column allowlists ──────────────────────────── */

/**
 * Every column of `client_proposal` this route may read. `id`, `org_id` and
 * `family_id` are read because a write needs to name its row, but they live on
 * `PublicProposalHandle` and never reach `PublicProposalView`.
 *
 * Not here, deliberately: `public_token` (the caller already has it),
 * `client_email`, `lead_id`, `matter_id`, `created_by`, `updated_by`,
 * `approved_by`, `source`.
 */
export const PUBLIC_PROPOSAL_COLUMNS = [
  "id",
  "org_id",
  "family_id",
  "version",
  "title",
  "client_name",
  "status",
  "content",
  "expires_on",
  "pay_url",
  "sent_at",
  "accepted_at",
  "accepted_selection",
  "accepted_snapshot",
] as const;

/** The firm's display identity: its name, and the slug the page picks branding by. */
export const PUBLIC_ORG_COLUMNS = ["name", "slug"] as const;

/** From the firm's profile: only the clock its dates are shown on. */
export const PUBLIC_PROFILE_COLUMNS = ["time_zone"] as const;

const PROPOSAL_SELECT = PUBLIC_PROPOSAL_COLUMNS.join(", ");
const ORG_SELECT = PUBLIC_ORG_COLUMNS.join(", ");
const PROFILE_SELECT = PUBLIC_PROFILE_COLUMNS.join(", ");

/** A family rarely has more than a handful of versions; the cap bounds the read. */
const FAMILY_READ_LIMIT = 25;

/* ─────────────────────────── payload shapes ─────────────────────────────── */

export type PublicProposalFirm = {
  name: string;
  /** Picks the page's branding ("rpb-law" gets RPB's; everyone else a neutral look). */
  slug: string;
  /** The firm's own zone (Settings -> Firm profile): every date on the page is shown in it. */
  timeZone: string;
};

/**
 * THE CLIENT-FACING PAYLOAD. Everything here is serialised into the HTML the
 * browser receives, so this type is the security contract: anything added to it
 * is published to whoever holds the link. No ids, no token, no email.
 */
export type PublicProposalView = {
  /** `sent` while it can still be accepted, `accepted` once it has been. */
  status: "sent" | "accepted";
  version: number;
  title: string;
  clientName: string;
  content: ProposalContent;
  expiresOn: string | null;
  acceptedAt: string | null;
  acceptedSelection: Selection | null;
  /** The frozen quote the client agreed to, once accepted. */
  acceptedQuote: ProposalQuote | null;
  /** Only once accepted: before acceptance the link is handed out by `acceptPublicProposal`. */
  payUrl: string | null;
  firm: PublicProposalFirm;
};

/** The server-side half of a resolved token. Never passed to a client component. */
export type PublicProposalHandle = {
  proposalId: string;
  orgId: string;
  familyId: string;
  version: number;
  /** The STORED status: the conditional acceptance update matches on what the row says. */
  storedStatus: ProposalStatus;
};

export type PublicProposalClosedReason = "expired" | "withdrawn";

export type PublicProposalRead =
  | { status: "ok"; view: PublicProposalView; handle: PublicProposalHandle }
  | { status: "closed"; reason: PublicProposalClosedReason; firm: PublicProposalFirm }
  | { status: "not_found" }
  | { status: "unconfigured" }
  | { status: "unavailable" };

/* ─────────────────────────── pure helpers ───────────────────────────────── */

/**
 * Whether an offer has expired, by the FIRM's calendar. `expires_on` is a date,
 * not an instant: the offer is open through the end of that day in the firm's
 * zone, so a client opening the link on the evening of the last day still finds
 * it. Vercel runs UTC and the firm does not; comparing civil dates (not the
 * server's calendar fields) is what makes "October 26" mean October 26 in New
 * York. No expiry date means no expiry; an unreadable one is treated as none
 * (validation, not the client's page, is where that is reported).
 */
export function isProposalExpired(expiresOn: string | null | undefined, now: Date, timeZone: string): boolean {
  if (typeof expiresOn !== "string" || !isCivilDate(expiresOn)) return false;
  return firmCivilDate(now, resolveTimeZone(timeZone)) > expiresOn;
}

/**
 * From a family's rows (every version shares one token), pick what the client
 * sees: the sent or accepted version. A family whose only non-draft version was
 * withdrawn is `withdrawn`; anything else (drafts, approved-not-yet-sent) is
 * nothing at all.
 */
export function pickLiveRow<T extends Record<string, unknown>>(
  rows: readonly T[],
): { kind: "live"; row: T } | { kind: "withdrawn" } | { kind: "none" } {
  const live = rows.find((r) => r.status === "sent" || r.status === "accepted");
  if (live) return { kind: "live", row: live };
  if (rows.some((r) => r.status === "withdrawn")) return { kind: "withdrawn" };
  return { kind: "none" };
}

/** The frozen record of what was accepted. `quote` is recomputed here, never taken from the browser. */
export function buildAcceptedSnapshot(input: {
  version: number;
  content: ProposalContent;
  selection: Selection;
  quote: ProposalQuote;
  acceptedAt: string;
}): AcceptedSnapshot {
  return {
    schema: 1,
    version: input.version,
    content: input.content,
    selection: input.selection,
    quote: input.quote,
    accepted_at: input.acceptedAt,
  };
}

/* ─────────────────────────── the content allowlist ──────────────────────── */

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (source[k] !== undefined) out[k] = source[k];
  return out;
}

function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/**
 * `content` reduced to the keys `ProposalContent` defines, at every level.
 * The content column is jsonb that a person or an agent wrote, and the whole
 * of it is serialised into the client's HTML, so an extra key is published to
 * whoever holds the link. The static builder this replaces stripped the spec's
 * `private` block (matter id, client email) before rendering; an agent porting
 * a spec in that shape would otherwise carry it straight onto the page. This is
 * the column allowlist's rule applied inside the document. Values are not
 * coerced: pricing and validation already cope with odd ones.
 */
export function publicContent(raw: unknown): ProposalContent {
  const c = isObject(raw) ? raw : {};
  const out = pick(c, ["greeting", "recommendation", "office_action_note"]);
  out.client = pick(isObject(c.client) ? c.client : {}, ["first_name", "full_name", "company"]);
  out.pricing = pick(isObject(c.pricing) ? c.pricing : {}, [
    "package",
    "base_cents",
    "included_classes",
    "per_class_cents",
    "second_mark_discount_pct",
    "gov_per_class_cents",
  ]);
  out.names = objects(c.names).map((nm) => {
    const name = pick(nm, ["id", "name", "what", "note"]);
    if (isObject(nm.price_override)) name.price_override = pick(nm.price_override, ["base_cents", "per_class_cents"]);
    name.marks = objects(nm.marks).map((m) => pick(m, ["id", "kind", "desc", "preselected"]));
    name.classes = objects(nm.classes).map((cl) => pick(cl, ["id", "label", "preselected"]));
    return name;
  });
  out.adjustments = objects(c.adjustments).map((a) => pick(a, ["id", "label", "kind", "value"]));
  out.includes = objects(c.includes).map((r) => pick(r, ["label", "value", "included", "note", "highlight"]));
  return out as unknown as ProposalContent;
}

function isNoRowsError(error: PublicDbError): boolean {
  return error?.code === "PGRST116";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/* ─────────────────────────── the read ───────────────────────────────────── */

type RawRow = Record<string, unknown>;

/**
 * Resolve a token to the family's live proposal, or say precisely which kind of
 * nothing happened. `now` is passed in so a test can pin an instant and the
 * page judges expiry against the instant it renders with.
 *
 * Expired (the firm's calendar) and withdrawn read as `closed`, with the firm's
 * identity so the page can say who to contact. An ACCEPTED proposal never
 * reads as expired: the client's receipt does not stop existing on the expiry
 * date.
 */
export async function readPublicProposal(
  token: string,
  now: Date,
  db?: PublicProposalsDb,
): Promise<PublicProposalRead> {
  if (!isWellFormedProposalToken(token)) return { status: "not_found" };

  let client: PublicProposalsDb;
  try {
    client = publicProposalsDb(db);
  } catch {
    // env.ts throws when SUPABASE_SERVICE_ROLE_KEY is missing. Nothing about
    // the failure is repeated to the caller: the message names the variable.
    return { status: "unconfigured" };
  }

  try {
    const { data, error } = await client
      .from("client_proposal")
      .select(PROPOSAL_SELECT)
      // EXACT match on the credential, and the only filter.
      .eq("public_token", token)
      .order("version", { ascending: false })
      .limit(FAMILY_READ_LIMIT);
    if (error && !isNoRowsError(error)) return { status: "unavailable" };

    const rows = (Array.isArray(data) ? data : []).filter(isObject) as RawRow[];
    const picked = pickLiveRow(rows);
    if (picked.kind === "none") return { status: "not_found" };

    const anyRow = picked.kind === "live" ? picked.row : rows.find((r) => r.status === "withdrawn");
    const proposalId = readString(anyRow?.id);
    const orgId = readString(anyRow?.org_id);
    // A row that came back without its own keys is not one we can safely
    // render or write against; unreadable, not missing.
    if (!anyRow || !proposalId || !orgId) return { status: "unavailable" };

    const [orgResult, profileResult] = await Promise.all([
      client.from("crm_org").select(ORG_SELECT).eq("id", orgId).maybeSingle(),
      // A failed read of the zone is not a failed page: the default zone only
      // moves a date label.
      client.from("crm_org_profile").select(PROFILE_SELECT).eq("org_id", orgId).maybeSingle(),
    ]);
    if (orgResult.error && !isNoRowsError(orgResult.error)) return { status: "unavailable" };
    const org = isObject(orgResult.data) ? orgResult.data : null;
    const firmName = readString(org?.name);
    // A proposal with no firm behind it cannot be presented honestly.
    if (!firmName) return { status: "unavailable" };
    const firm: PublicProposalFirm = {
      name: firmName,
      slug: readString(org?.slug) ?? "",
      timeZone: resolveTimeZone(
        profileResult.error || !isObject(profileResult.data) ? null : readString(profileResult.data.time_zone),
      ),
    };

    if (picked.kind === "withdrawn") return { status: "closed", reason: "withdrawn", firm };

    const row = picked.row;
    const storedStatus = row.status === "accepted" ? "accepted" : "sent";
    const expiresOn = asNullableString(row.expires_on);
    if (storedStatus === "sent" && isProposalExpired(expiresOn, now, firm.timeZone)) {
      return { status: "closed", reason: "expired", firm };
    }
    if (!isObject(row.content)) return { status: "unavailable" };
    // Allowlisted, like the columns: this is what the browser receives, and
    // (on acceptance) what the snapshot records the client was shown.
    const content = publicContent(row.content);

    const snapshot = isObject(row.accepted_snapshot) ? (row.accepted_snapshot as unknown as AcceptedSnapshot) : null;
    const accepted = storedStatus === "accepted";

    const view: PublicProposalView = {
      status: storedStatus,
      version: typeof row.version === "number" ? row.version : 1,
      title: readString(row.title) ?? "Trademark Proposal",
      clientName: readString(row.client_name) ?? "",
      content: accepted && isObject(snapshot?.content) ? publicContent(snapshot.content) : content,
      expiresOn,
      acceptedAt: asNullableString(row.accepted_at),
      acceptedSelection: accepted && isObject(row.accepted_selection) ? (row.accepted_selection as Selection) : null,
      acceptedQuote: accepted ? snapshot?.quote ?? null : null,
      payUrl: accepted ? asNullableString(row.pay_url) : null,
      firm,
    };

    return {
      status: "ok",
      view,
      handle: {
        proposalId,
        orgId,
        familyId: readString(row.family_id) ?? proposalId,
        version: view.version,
        storedStatus,
      },
    };
  } catch {
    // Network failure, DNS, a thrown env read: never `not_found`. The
    // difference between "does not exist" and "we could not check" is the whole
    // reason this function is not two-state.
    return { status: "unavailable" };
  }
}

/* ─────────────────────────── the opening ─────────────────────────────────── */

/** One `viewed` event per window, so a refresh is not "opened 900 times". */
export const VIEW_EVENT_WINDOW_MS = 5 * 60 * 1000;

/**
 * A fixed vocabulary, so nothing an anonymous caller typed is ever stored: the
 * raw header would put attacker-controlled text in a jsonb column that staff
 * screens render. Keeps the one fact the firm wants (was this opened on a phone?).
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
 * Record that the client opened the proposal. Never throws, never reports: the
 * audit row is not what the client came for, and the only identifier in scope
 * worth logging is the token, so nothing is logged.
 */
export async function recordProposalViewed(
  handle: PublicProposalHandle,
  userAgent: string | null | undefined,
  now: Date,
  db?: PublicProposalsDb,
): Promise<void> {
  try {
    const client = publicProposalsDb(db);
    const { data, error } = await client
      .from("client_proposal_event")
      .select("created_at")
      .eq("proposal_id", handle.proposalId)
      .eq("org_id", handle.orgId)
      .eq("type", "viewed")
      .order("created_at", { ascending: false })
      .limit(1);

    // A failed read of the last view is not a reason to skip the write, and
    // erring toward writing keeps the firm's engagement record complete.
    if (!error && Array.isArray(data) && data[0]) {
      const last = (data[0] as Record<string, unknown>).created_at;
      const lastMs = typeof last === "string" ? Date.parse(last.replace(" ", "T")) : NaN;
      if (Number.isFinite(lastMs) && now.getTime() - lastMs < VIEW_EVENT_WINDOW_MS) return;
    }

    await client.from("client_proposal_event").insert({
      org_id: handle.orgId,
      proposal_id: handle.proposalId,
      family_id: handle.familyId,
      type: "viewed",
      actor: "client",
      payload: { ua: coarseUserAgent(userAgent), version: handle.version },
    });
  } catch {
    // Deliberately silent.
  }
}

/* ─────────────────────────── acceptance ─────────────────────────────────── */

export type AcceptRefusal =
  /** Unknown token, or nothing live to accept. */
  | "not_found"
  /** Expired on the firm's calendar, or withdrawn. */
  | "closed"
  /** Already accepted (this request lost the race, or the client double-clicked). */
  | "already_resolved"
  /** The selection has no brand name with both a mark and a class ticked. */
  | "nothing_selected"
  | "unconfigured"
  | "unavailable";

export type AcceptResult =
  | {
      ok: true;
      /** Where the client pays the legal fee. Open it in a new tab. */
      payUrl: string | null;
      acceptedAt: string;
      /** What the client agreed to, recomputed here from the stored content. */
      quote: ProposalQuote;
      /** Server-side only: never forward to the browser. */
      proposalId: string;
    }
  | { ok: false; reason: AcceptRefusal; message: string };

const REFUSAL_MESSAGE: Record<AcceptRefusal, string> = {
  not_found: "We couldn't find this proposal.",
  closed: "This proposal is no longer open. Please contact the firm.",
  already_resolved: "This proposal has already been accepted.",
  nothing_selected: "Choose at least one mark and one class to accept.",
  unconfigured: "This page isn't available right now. Please try again later.",
  unavailable: "We couldn't record your acceptance. Please try again.",
};

function refuse(reason: AcceptRefusal): AcceptResult {
  return { ok: false, reason, message: REFUSAL_MESSAGE[reason] };
}

/**
 * The client accepts. The price is RECOMPUTED here from the stored content and
 * the ticked boxes: nothing the browser says about money is read. The write is
 * one conditional update that matches only a row still `sent`, so a double
 * click, two tabs, or a staff withdrawal in between cannot produce two
 * acceptances or accept a proposal that is no longer on offer.
 *
 * `accepted_at` is stamped by the 0086 trigger (the service role may not set
 * it directly); the snapshot carries the instant this request ran, and the two
 * differ by milliseconds.
 */
export async function acceptPublicProposal(
  token: string,
  selection: unknown,
  now: Date,
  db?: PublicProposalsDb,
): Promise<AcceptResult> {
  const read = await readPublicProposal(token, now, db);
  if (read.status === "unconfigured") return refuse("unconfigured");
  if (read.status === "unavailable") return refuse("unavailable");
  if (read.status === "not_found") return refuse("not_found");
  if (read.status === "closed") return refuse("closed");
  if (read.handle.storedStatus !== "sent") return refuse("already_resolved");

  const { content } = read.view;
  const picked = normalizeSelection(content, selection);
  const quote = quoteProposal(content, picked);
  if (!quoteHasItems(quote)) return refuse("nothing_selected");

  const acceptedAt = now.toISOString();
  const snapshot = buildAcceptedSnapshot({
    version: read.handle.version,
    content,
    selection: picked,
    quote,
    acceptedAt,
  });

  try {
    const client = publicProposalsDb(db);
    const { proposalId, orgId } = read.handle;

    const { data, error } = await client
      .from("client_proposal")
      .update({
        status: "accepted",
        accepted_selection: picked,
        accepted_snapshot: snapshot,
      })
      .eq("id", proposalId)
      .eq("org_id", orgId)
      // The fence: only a row that is still on offer can be accepted.
      .eq("status", "sent")
      .select("id, pay_url");

    if (error) return refuse("unavailable");
    if (!Array.isArray(data) || data.length === 0) {
      // Zero rows changed. Another request got there first, or the proposal
      // left `sent` between the read and this statement. Either way this
      // request did NOT accept, and must not say it did.
      return refuse("already_resolved");
    }

    await notifyFirmOfAcceptance({ proposalId });

    const payUrl = asNullableString((data[0] as Record<string, unknown>).pay_url);
    return { ok: true, payUrl, acceptedAt, quote, proposalId };
  } catch {
    return refuse("unavailable");
  }
}

/**
 * TODO(notify): email the firm that a client accepted, to
 * `client_proposal_setting.notify_email`. lectual.app has no outbound email
 * client yet (`src/lib/env.ts` has no Resend key), and adding a deployment-wide
 * secret is a decision for the owner, not for this module. Until then this logs
 * the fact and nothing else: no client name, no amounts, no token. The
 * acceptance itself is already durable and visible (the trigger-written
 * `accepted` event, and the proposal's status).
 *
 * Best-effort by contract: it must never throw into the acceptance, and a
 * future implementation must keep that.
 */
export async function notifyFirmOfAcceptance(input: { proposalId: string }): Promise<void> {
  try {
    console.info(JSON.stringify({ event: "proposal_accepted", proposal_id: input.proposalId }));
  } catch {
    // Never let a notice break an acceptance.
  }
}
