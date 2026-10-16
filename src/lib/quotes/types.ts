/**
 * Shared quote-engine types — Row shapes for the 0068_quote_engine.sql tables
 * this app uses, the vocabularies that don't already live in pricing.ts /
 * status.ts, and a handful of PURE cross-field validators that mirror the
 * migration's own CHECK constraints so a bad write gets a readable refusal here
 * instead of a raw Postgres constraint-violation message.
 *
 * ── WHY THE ROW TYPES ARE STILL HAND-WRITTEN ────────────────────────────────
 * `src/lib/db/types.ts` now carries crm_quote / crm_quote_line /
 * crm_quote_event / crm_service_item, but the quote engine was written against
 * a narrow structural client (`quotesDb`, store.ts) rather than
 * `Database["public"]["Tables"]`, and keeping these shapes here keeps that code
 * unchanged from `lectual`. They are the same columns, in the migration's order.
 *
 * ── WHAT IS NOT HERE (lectual.app port) ─────────────────────────────────────
 * `lectual`'s branch also types `crm_payment`, `crm_org_payment_account`,
 * `crm_quote_line_request` (0071/0073) and `crm_quote.public_slug` (0070). This
 * app uses none of them: no payments UI, no client line requests, and the
 * client link is `/q/<public_token>` only. Their types were dropped with the
 * code, so nothing can reach for a column that is not in both databases.
 *
 * ── WHY THIS FILE STAYS PURE ────────────────────────────────────────────────
 * No `server-only`, no `getScopedClient`, no Node-only import (the public-token
 * generator lives in store.ts, behind "server-only", since a token must only
 * ever be minted server-side). A component that only needs to know what shape
 * a quote line is should never pull in the server-only DB client to get it.
 *
 * ── MONEY ───────────────────────────────────────────────────────────────────
 * Integer cents as plain `number`, never `bigint` and never a float.
 */

import type { Role } from "@/lib/auth/roles";
import type { QuoteChargeAt, QuoteLineKind, QuoteLineSelection } from "./pricing";

export type { QuoteChargeAt, QuoteLineKind, QuoteLineSelection } from "./pricing";
export type { QuoteStatus } from "./status";
import type { QuoteStatus } from "./status";

/* ─────────────────────────── role gates ──────────────────────────────────
 * Mirror the RLS policy role lists in 0068, verbatim. RLS is the real
 * boundary; these are the friendly app-layer refusal, same "never diverge
 * without updating both" discipline as MATTER_WRITE_ROLES
 * (src/lib/matters/matters.ts) and SETTINGS_ADMIN_ROLES
 * (src/lib/settings/admin.ts).
 */

/** crm_quote_insert_staff / crm_quote_update_staff / crm_quote_line_*_staff /
 * crm_payment_insert_staff — ordinary casework: writing a proposal, editing
 * its lines, and recording that a client paid are all things staff do. */
export const QUOTE_STAFF_WRITE_ROLES: Role[] = [
  "owner",
  "admin",
  "senior_admin",
  "intake",
  "paralegal",
  "law_clerk",
  "attorney",
  "clerk",
];

/** crm_service_item_{insert,update,delete}_admin — the firm's standard price
 * list is configuration, not casework (same tier as crm_stage_sequence /
 * crm_drip_sequence). */
export const QUOTE_LIBRARY_ADMIN_ROLES: Role[] = ["owner", "admin", "senior_admin"];

/* ─────────────────────────── new vocabularies ─────────────────────────────
 * crm_quote_status / crm_quote_line_kind / crm_quote_line_selection /
 * crm_quote_charge_at already live in pricing.ts/status.ts and are
 * re-exported above rather than redefined. What's left is the audit/payment
 * vocabulary those two modules have no reason to know about.
 */

/** crm_quote_event_type (0068 §3.4). */
export const QUOTE_EVENT_TYPES = [
  "created",
  "sent",
  "viewed",
  "selection_changed",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
  "revised",
  "payment_recorded",
] as const;
export type QuoteEventType = (typeof QUOTE_EVENT_TYPES)[number];
export function isQuoteEventType(value: unknown): value is QuoteEventType {
  return typeof value === "string" && (QUOTE_EVENT_TYPES as readonly string[]).includes(value);
}

/** crm_quote_event_actor. `client`/`system` rows come from the public-token
 * route's service-role client (a separate slice); this module only ever
 * writes `actor: 'firm'`. */
export const QUOTE_EVENT_ACTORS = ["firm", "client", "system"] as const;
export type QuoteEventActor = (typeof QUOTE_EVENT_ACTORS)[number];
export function isQuoteEventActor(value: unknown): value is QuoteEventActor {
  return typeof value === "string" && (QUOTE_EVENT_ACTORS as readonly string[]).includes(value);
}

/* ─────────────────────────── row shapes ──────────────────────────────────
 * Every column from 0068, in the migration's own order. `org_id` is present
 * on every row (denormalized per-table, per the tenant-isolation rule) even
 * though nothing in this module should ever read it for scoping — RLS does
 * that; org_id here exists only so a caller can populate a composite-FK
 * insert on a CHILD row (e.g. a quote line needs its quote's org_id).
 */

export type ServiceItemRow = {
  id: string;
  org_id: string;
  label: string;
  description: string | null;
  kind: QuoteLineKind;
  charge_at: QuoteChargeAt;
  unit_amount_cents: number;
  active: boolean;
  sort_index: number;
  created_at: string;
  updated_at: string;
};

export type QuoteRow = {
  id: string;
  org_id: string;
  matter_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  title: string;
  status: QuoteStatus;
  currency: string;
  intro_body: string | null;
  terms_body: string | null;
  /** timestamptz — an INSTANT. Compare with status.ts's isQuoteExpired, never
   * a civil-date comparison. */
  expires_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  withdrawn_at: string | null;
  /** The entire credential for the client proposal route (0068 §3.2 / spec
   * §6.1). Never log this value, never put it in an error message. */
  public_token: string;
  accepted_by_name: string | null;
  accepted_by_email: string | null;
  accepted_ip: string | null;
  accepted_user_agent: string | null;
  /** §5's frozen legal record. This module never writes it — acceptance is
   * the public-token route's exception (a service-role write, since an anon
   * caller has no RLS-visible org). Typed loosely because this module does
   * not own its shape; the accept-route slice does. */
  accepted_snapshot: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type QuoteLineRow = {
  id: string;
  org_id: string;
  quote_id: string;
  kind: QuoteLineKind;
  charge_at: QuoteChargeAt;
  selection: QuoteLineSelection;
  tier_group: string | null;
  selected: boolean;
  label: string;
  description: string | null;
  quantity: number;
  unit_amount_cents: number;
  /** Analytics only — see the migration's comment. Never used as a join key
   * by anything in this module. */
  source_service_item_id: string | null;
  sort_index: number;
  created_at: string;
  updated_at: string;
};

export type QuoteEventRow = {
  id: string;
  org_id: string;
  quote_id: string;
  type: QuoteEventType;
  actor: QuoteEventActor;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

/* ─────────────────────────── pure validators ──────────────────────────────
 * Mirror the 0068 CHECK constraints so a bad write is refused with a
 * readable message before it ever reaches Postgres, not only after. The DB
 * constraint is still the real boundary (belt and braces, same posture as
 * every RLS gate in this app) — these exist so `store.ts`/`service-library.ts`
 * don't have to parse a raw `crm_quote_line_gov_fee_not_at_signing` violation
 * message to explain to a caller what went wrong.
 */

export class QuoteLineConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteLineConstraintError";
  }
}

/**
 * §0 / `crm_quote_line_gov_fee_not_at_signing` (and the identical
 * `crm_service_item_gov_fee_not_at_signing`, since the rule is enforced on
 * the template as well as the instance). The USPTO rule, checked in the app
 * layer a second time before it ever reaches the database's own second line
 * of defence.
 */
export function assertLineKindChargeAt(kind: string, chargeAt: string): void {
  if (kind === "government_fee" && chargeAt === "signing") {
    throw new QuoteLineConstraintError(
      "A government filing fee can't be charged at signing — USPTO fees are always charged at filing.",
    );
  }
}

/**
 * `crm_quote_line_amount_sign` (and `crm_service_item_amount_sign`):
 * discounts are stored negative, everything else non-negative.
 */
export function assertLineAmountSign(kind: string, unitAmountCents: number): void {
  const isDiscount = kind === "discount";
  if (isDiscount && unitAmountCents > 0) {
    throw new QuoteLineConstraintError("A discount line must be stored as a negative amount.");
  }
  if (!isDiscount && unitAmountCents < 0) {
    throw new QuoteLineConstraintError("Only a discount line may be stored as a negative amount.");
  }
}

/**
 * `crm_quote_line_tier_group`: a tier option belongs to a group and nothing
 * else does.
 */
export function assertTierGroupShape(selection: string, tierGroup: string | null | undefined): void {
  const hasGroup = typeof tierGroup === "string" && tierGroup.trim().length > 0;
  if (selection === "tier_option" && !hasGroup) {
    throw new QuoteLineConstraintError("A package option needs a package group.");
  }
  if (selection !== "tier_option" && hasGroup) {
    throw new QuoteLineConstraintError("Only a package option may carry a package group.");
  }
}

/**
 * `crm_quote_line_included_selected`: an `included` line is always in the
 * total and can't be deselected. The DB constraint catches this too, but
 * only after the write — this is the failure §0's sibling rule calls out by
 * name: a deselected `included` line drops the firm's own fee out of the
 * signing charge and the quote still LOOKS complete.
 */
export function assertIncludedIsSelected(selection: string, selected: boolean): void {
  if (selection === "included" && !selected) {
    throw new QuoteLineConstraintError("An included line can't be deselected.");
  }
}

/**
 * Used by `reorderQuoteLines`: every id in the caller's proposed order must
 * be one of this quote's own line ids, and every one of this quote's line
 * ids must appear exactly once. Rejects a foreign id (same defence-in-depth
 * spirit as `linkMatterContact` re-resolving ids through the caller's own
 * client — src/lib/matters/contacts.ts) and rejects a PARTIAL reorder, which
 * would otherwise leave the omitted lines holding a stale `sort_index` that
 * could collide with the renumbered ones.
 */
export function assertIdsMatchSet(existingIds: readonly string[], requestedIds: readonly string[]): void {
  const requestedSet = new Set(requestedIds);
  if (requestedSet.size !== requestedIds.length) {
    throw new Error("A line id was listed more than once in the new order.");
  }
  const existingSet = new Set(existingIds);
  for (const id of requestedIds) {
    if (!existingSet.has(id)) {
      throw new Error(`Line ${id} does not belong to this quote.`);
    }
  }
  if (existingSet.size !== requestedSet.size) {
    throw new Error("The new order is missing one or more of this quote's existing lines.");
  }
}

/* ─────────────────────────── service-item copy ────────────────────────────
 * The pure half of "apply a service-library item to a quote by COPYING its
 * values" (spec §3.3 / this run's write requirements). `store.ts` reads the
 * service item row through the caller's own scoped client and hands it to
 * this function; everything about WHAT gets copied and how an override wins
 * lives here, where it can be unit-tested with no database.
 */

export type ServiceItemApplyOverrides = Partial<{
  unitAmountCents: number;
  label: string;
  description: string | null;
  /** Defaults to 'included' — same default the `selection` column itself
   * carries — not to whatever the library item implies, because a service
   * item has no selection concept of its own (§3.1: it carries only
   * defaults for kind/charge_at/price). */
  selection: string;
  tierGroup: string | null;
  selected: boolean;
  /** Rare, but the spec allows a per-quote override on price and doesn't rule
   * one out on schedule; always re-validated against `kind` below, so an
   * override can never reintroduce the §0 violation. */
  chargeAt: string;
  quantity: number;
}>;

export type QuoteLineCopyFields = {
  kind: QuoteLineKind;
  charge_at: QuoteChargeAt;
  selection: QuoteLineSelection;
  tier_group: string | null;
  selected: boolean;
  label: string;
  description: string | null;
  quantity: number;
  unit_amount_cents: number;
  source_service_item_id: string;
};

/**
 * `kind` is deliberately NOT overridable — copying a "legal fee" library item
 * as a "government fee" line is not a price override, it's picking the wrong
 * item, and allowing it here would blur what "copy" means. Every other field
 * on the library item has a caller-supplied override.
 */
export function serviceItemToLineFields(
  item: Pick<ServiceItemRow, "id" | "kind" | "charge_at" | "unit_amount_cents" | "label" | "description">,
  overrides: ServiceItemApplyOverrides = {},
): QuoteLineCopyFields {
  const chargeAt: QuoteChargeAt =
    overrides.chargeAt !== undefined && isQuoteChargeAtLoose(overrides.chargeAt) ? overrides.chargeAt : item.charge_at;
  const selection: QuoteLineSelection =
    overrides.selection !== undefined && isQuoteLineSelectionLoose(overrides.selection) ? overrides.selection : "included";
  const tierGroup = selection === "tier_option" ? (overrides.tierGroup?.trim() || null) : null;
  const selected = selection === "included" ? true : (overrides.selected ?? false);
  const quantity =
    typeof overrides.quantity === "number" && Number.isSafeInteger(overrides.quantity) && overrides.quantity > 0
      ? overrides.quantity
      : 1;

  return {
    kind: item.kind,
    charge_at: chargeAt,
    selection,
    tier_group: tierGroup,
    selected,
    label: overrides.label?.trim() || item.label,
    description: overrides.description !== undefined ? overrides.description : item.description,
    quantity,
    unit_amount_cents: overrides.unitAmountCents !== undefined ? overrides.unitAmountCents : item.unit_amount_cents,
    source_service_item_id: item.id,
  };
}

/**
 * The line already on the quote that a library item would duplicate EXACTLY —
 * same library item, same placement (selection and package), same kind,
 * timing, label, description and price — or undefined.
 *
 * Adding the same service twice then raises that line's quantity instead of
 * showing the client two identical rows. A line that differs in anything the
 * client can see (someone re-priced or relabelled it) is not a duplicate: the
 * new copy gets its own row, as before.
 */
export function findDuplicateLibraryLine<L extends Pick<
  QuoteLineRow,
  "source_service_item_id" | "selection" | "tier_group" | "kind" | "charge_at" | "label" | "description" | "unit_amount_cents"
>>(existing: readonly L[], fields: QuoteLineCopyFields): L | undefined {
  return existing.find(
    (l) =>
      l.source_service_item_id === fields.source_service_item_id &&
      l.selection === fields.selection &&
      (l.tier_group ?? null) === (fields.tier_group ?? null) &&
      l.kind === fields.kind &&
      l.charge_at === fields.charge_at &&
      l.label === fields.label &&
      (l.description ?? null) === (fields.description ?? null) &&
      Number(l.unit_amount_cents) === Number(fields.unit_amount_cents),
  );
}

// Local, loose guards (accept `string` rather than the narrow union) so this
// function can validate a caller-supplied override the same way pricing.ts
// validates a wire row — a bad override is dropped back to the item's own
// value rather than trusted, and the caller-facing throws
// (assertLineKindChargeAt/assertLineAmountSign) still run on the RESULT in
// store.ts before anything is written.
function isQuoteChargeAtLoose(value: string): value is QuoteChargeAt {
  return value === "signing" || value === "filing" || value === "not_charged";
}
function isQuoteLineSelectionLoose(value: string): value is QuoteLineSelection {
  return value === "included" || value === "optional" || value === "tier_option";
}
