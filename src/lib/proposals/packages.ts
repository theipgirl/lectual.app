import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listServiceItems } from "@/lib/quotes/service-library";
import { quotesDb } from "@/lib/quotes/store";
import type { ServiceItemRow } from "@/lib/quotes/types";

/**
 * The firm's service library as a package picker for "New proposal": active
 * `legal_fee` items charged at signing (never a USPTO fee, an expense or a
 * discount). The form posts only the item's id; `resolvePackageItem` re-reads
 * the item through the caller's own scoped client when the proposal is made, so
 * a price the browser sent is never used.
 */

export type PackageChoice = { id: string; label: string; description: string | null; amountCents: number };
export type PackageChoicesRead = { status: "ok"; choices: PackageChoice[] } | { status: "unavailable" };

type PackageFields = Pick<ServiceItemRow, "kind" | "charge_at" | "active" | "unit_amount_cents">;

/** An active legal fee charged at signing, with a usable amount. */
export function isSigningPackage(item: PackageFields): boolean {
  return (
    item.active === true &&
    item.kind === "legal_fee" &&
    item.charge_at === "signing" &&
    Number.isInteger(item.unit_amount_cents) &&
    item.unit_amount_cents >= 0
  );
}

/** Three-state: a failed library read is `unavailable`, never an empty picker. */
export async function loadPackageChoices(): Promise<PackageChoicesRead> {
  try {
    const items = await listServiceItems();
    return {
      status: "ok",
      choices: items
        .filter(isSigningPackage)
        .map((i) => ({ id: i.id, label: i.label, description: i.description, amountCents: i.unit_amount_cents })),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export type ResolvedPackage = { ok: true; label: string; baseCents: number } | { ok: false; error: string };

/** Re-reads one library item for the create action. A sentence on any refusal; never throws. */
export async function resolvePackageItem(id: string): Promise<ResolvedPackage> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await quotesDb(supabase)
      .from("crm_service_item")
      .select("id, label, kind, charge_at, unit_amount_cents, active")
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: "Couldn't read the service library, so nothing was created. Try again shortly." };
    const item = data as (PackageFields & { label: string }) | null;
    if (!item || !isSigningPackage(item) || !item.label?.trim()) {
      return { ok: false, error: "That package isn't available. Pick an active legal-fee package from the service library, or leave it on the standard prices." };
    }
    return { ok: true, label: item.label.trim().slice(0, 200), baseCents: item.unit_amount_cents };
  } catch {
    return { ok: false, error: "Couldn't read the service library, so nothing was created. Try again shortly." };
  }
}
