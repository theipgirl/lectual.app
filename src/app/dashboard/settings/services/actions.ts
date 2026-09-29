"use server";

import { revalidatePath } from "next/cache";
import {
  archiveServiceItem,
  createServiceItem,
  restoreServiceItem,
  updateServiceItem,
} from "@/lib/quotes/service-library";
import { parseDollarsToCents } from "@/lib/quotes/money";
import { friendlyQuoteError, type ActionState } from "@/app/dashboard/quotes/errors";

/**
 * Service-library writes. Admin-gated by `@/lib/quotes/service-library` itself
 * (`requireQuoteLibraryAdminRole`, owner/admin/senior_admin — mirroring
 * `crm_service_item_{insert,update,delete}_admin`) on EVERY call, and finally
 * by RLS. A "use server" function is its own POST entry point, so nothing here
 * trusts the page's gate.
 *
 * Archive, never delete: an old quote line's `source_service_item_id` still
 * names the row. The RLS delete policy exists for mistake cleanup, not for
 * this app's flow, so no delete action exists.
 */

const LIBRARY_PATH = "/dashboard/settings/services/";

function readItem(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const chargeAt = String(formData.get("chargeAt") ?? "");
  const description = String(formData.get("description") ?? "").trim() || null;
  const magnitude = parseDollarsToCents(String(formData.get("amount") ?? ""));
  return { label, kind, chargeAt, description, magnitude };
}

/** Prices are typed positive. A discount item is stored negative (0068's
 * `crm_service_item_amount_sign`), so the sign comes from the kind — nobody is
 * asked to type a minus. (`lectual` stored the magnitude as-is, which made a
 * discount item impossible to save; its own comment said the library was not
 * a discount catalogue, while offering "Discount" as a kind.) */
function signedAmount(kind: string, magnitude: number): number {
  return kind === "discount" ? -magnitude : magnitude;
}

export async function createServiceItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { label, kind, chargeAt, description, magnitude } = readItem(formData);
  if (!label) return { error: "Enter a label." };
  if (magnitude === null || magnitude < 0) return { error: "Enter a valid price, e.g. 1250.00." };
  try {
    await createServiceItem({ label, description, kind, chargeAt, unitAmountCents: signedAmount(kind, magnitude) });
  } catch (err) {
    return { error: friendlyQuoteError(err, "Couldn't add this service.") };
  }
  revalidatePath(LIBRARY_PATH);
  return { saved: true };
}

export async function updateServiceItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { label, kind, chargeAt, description, magnitude } = readItem(formData);
  if (!id) return { error: "Missing service." };
  if (!label) return { error: "Enter a label." };
  if (magnitude === null || magnitude < 0) return { error: "Enter a valid price, e.g. 1250.00." };
  try {
    await updateServiceItem(id, { label, description, kind, chargeAt, unitAmountCents: signedAmount(kind, magnitude) });
  } catch (err) {
    return { error: friendlyQuoteError(err, "Couldn't save this service.") };
  }
  revalidatePath(LIBRARY_PATH);
  return { saved: true };
}

export async function archiveServiceItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing service." };
  try {
    await archiveServiceItem(id);
  } catch (err) {
    return { error: friendlyQuoteError(err, "Couldn't archive this service.") };
  }
  revalidatePath(LIBRARY_PATH);
  return {};
}

export async function restoreServiceItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing service." };
  try {
    await restoreServiceItem(id);
  } catch (err) {
    return { error: friendlyQuoteError(err, "Couldn't restore this service.") };
  }
  revalidatePath(LIBRARY_PATH);
  return {};
}
