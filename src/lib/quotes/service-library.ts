import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import { isQuoteChargeAt, isQuoteLineKind } from "./pricing";
import { assertLineAmountSign, assertLineKindChargeAt, QUOTE_LIBRARY_ADMIN_ROLES, type ServiceItemRow } from "./types";
import { quotesDb } from "./store";

/**
 * `crm_service_item` CRUD — Anchor's "pre-built service library" (spec §3.1):
 * the firm's standing offerings, picked rather than retyped when a quote is
 * assembled. `store.ts#applyServiceItem` is the read+copy half that turns a
 * library row into a quote line; this file is only the library itself.
 *
 * ADMIN-GATED throughout, unlike the rest of the quote engine. Assembling a
 * quote FROM the library (`applyServiceItem`) is ordinary casework and is
 * staff-gated in store.ts; deciding what the firm charges by default is not
 * — same tier as `crm_stage_sequence`/`crm_drip_sequence` configuration
 * (mirrors `crm_service_item_{insert,update,delete}_admin`, 0068 §3.1).
 */

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Resolves the caller's role and requires it be in QUOTE_LIBRARY_ADMIN_ROLES.
 * Mirrors `requireSettingsAdminRole` (src/lib/settings/admin.ts) exactly. */
export async function requireQuoteLibraryAdminRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !QUOTE_LIBRARY_ADMIN_ROLES.includes(data)) {
    throw new Error("You don't have permission to edit the service library.");
  }
  return data;
}

/**
 * Lists the org's service library, sort order. Not role-gated — any signed-in
 * staff member needs this to build a quote (mirrors `crm_service_item_select_own`,
 * which carries no role restriction). Defaults to active items only; a firm
 * raising its old package's price archives the old row rather than deleting
 * it (0068's own comment), so `includeInactive` is how the settings page
 * shows the archive.
 */
export async function listServiceItems(includeInactive = false): Promise<ServiceItemRow[]> {
  const supabase = await getScopedClient();
  const db = quotesDb(supabase);
  let query = db.from("crm_service_item").select("*");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query.order("sort_index", { ascending: true });
  if (error) throw error;
  return (data as ServiceItemRow[] | null) ?? [];
}

export type CreateServiceItemInput = {
  label: string;
  description?: string | null;
  kind: string;
  chargeAt: string;
  unitAmountCents: number;
  /** Appends after the current last item when omitted. */
  sortIndex?: number;
};

/** Creates a library item. Admin-gated. `org_id` is always the caller's
 * active org (never taken from input). */
export async function createServiceItem(input: CreateServiceItemInput): Promise<ServiceItemRow> {
  const label = input.label?.trim();
  if (!label || label.length > 200) {
    throw new Error("A service item needs a label of 1-200 characters.");
  }
  if (!isQuoteLineKind(input.kind)) throw new Error(`'${input.kind}' isn't a valid line kind.`);
  if (!isQuoteChargeAt(input.chargeAt)) throw new Error(`'${input.chargeAt}' isn't a valid charge schedule.`);
  // §0, enforced here a second time before it ever reaches the identical
  // crm_service_item_gov_fee_not_at_signing constraint: a library item that
  // declared a USPTO fee at signing is a loaded gun sitting in the picker.
  assertLineKindChargeAt(input.kind, input.chargeAt);
  assertLineAmountSign(input.kind, input.unitAmountCents);

  const supabase = await getScopedClient();
  await requireQuoteLibraryAdminRole(supabase);
  const db = quotesDb(supabase);

  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");
  if (orgError) throw orgError;
  if (!orgId) throw new Error("No active organization for the current session.");

  let sortIndex = input.sortIndex;
  if (sortIndex === undefined) {
    const { data: last, error: lastError } = await db
      .from("crm_service_item")
      .select("sort_index")
      .order("sort_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;
    sortIndex = ((last as { sort_index: number } | null)?.sort_index ?? -1) + 1;
  }

  const { data, error } = await db
    .from("crm_service_item")
    .insert({
      org_id: orgId,
      label,
      description: input.description ?? null,
      kind: input.kind,
      charge_at: input.chargeAt,
      unit_amount_cents: input.unitAmountCents,
      sort_index: sortIndex,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ServiceItemRow;
}

export type UpdateServiceItemInput = Partial<{
  label: string;
  description: string | null;
  kind: string;
  chargeAt: string;
  unitAmountCents: number;
  sortIndex: number;
}>;

/** Edits a library item's editable fields. Admin-gated. Cross-field
 * constraints are validated against the RESULTING (patch-merged) shape, same
 * discipline as `store.ts#updateQuoteLine`. */
export async function updateServiceItem(id: string, patch: UpdateServiceItemInput): Promise<ServiceItemRow> {
  const supabase = await getScopedClient();
  await requireQuoteLibraryAdminRole(supabase);
  const db = quotesDb(supabase);

  const { data: existing, error: fetchError } = await db
    .from("crm_service_item")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) throw new Error("That service isn't in your firm's library.");
  const item = existing as ServiceItemRow;

  if (patch.kind !== undefined && !isQuoteLineKind(patch.kind)) {
    throw new Error(`'${patch.kind}' isn't a valid line kind.`);
  }
  if (patch.chargeAt !== undefined && !isQuoteChargeAt(patch.chargeAt)) {
    throw new Error(`'${patch.chargeAt}' isn't a valid charge schedule.`);
  }
  if (patch.label !== undefined && (!patch.label.trim() || patch.label.length > 200)) {
    throw new Error("A service item needs a label of 1-200 characters.");
  }

  const merged = {
    kind: patch.kind ?? item.kind,
    charge_at: patch.chargeAt ?? item.charge_at,
    unit_amount_cents: patch.unitAmountCents !== undefined ? patch.unitAmountCents : item.unit_amount_cents,
  };
  assertLineKindChargeAt(merged.kind, merged.charge_at);
  assertLineAmountSign(merged.kind, merged.unit_amount_cents);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.chargeAt !== undefined) update.charge_at = patch.chargeAt;
  if (patch.unitAmountCents !== undefined) update.unit_amount_cents = patch.unitAmountCents;
  if (patch.sortIndex !== undefined) update.sort_index = patch.sortIndex;

  const { data, error } = await db.from("crm_service_item").update(update).eq("id", id).select("*").single();
  if (error) throw error;
  return data as ServiceItemRow;
}

/**
 * Archives (never hard-deletes) a service item. 0068's own comment on
 * `crm_service_item`: an old quote line's `source_service_item_id` still
 * names this row for analytics, and deleting it would orphan the only record
 * of where that line's price came from. Archived items just stop appearing
 * in `listServiceItems`'s default (active-only) list — the RLS delete policy
 * exists for a genuine mistake cleanup, not for this app's normal flow, so
 * this module deliberately exposes no delete function.
 */
export async function archiveServiceItem(id: string): Promise<ServiceItemRow> {
  return setServiceItemActive(id, false);
}

export async function restoreServiceItem(id: string): Promise<ServiceItemRow> {
  return setServiceItemActive(id, true);
}

async function setServiceItemActive(id: string, active: boolean): Promise<ServiceItemRow> {
  const supabase = await getScopedClient();
  await requireQuoteLibraryAdminRole(supabase);
  const db = quotesDb(supabase);
  const { data, error } = await db
    .from("crm_service_item")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as ServiceItemRow;
}
