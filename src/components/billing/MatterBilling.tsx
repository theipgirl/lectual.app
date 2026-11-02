import { resolveFirmSession } from "@/lib/firm/session";
import { canSeeBilling } from "@/lib/billing/can-see";
import { loadMatterInvoices } from "@/lib/billing/load";
import { BillingCard } from "./BillingCard";

/**
 * The matter page's Billing card as its own async server component, so a slow Lawmatics call streams in
 * behind a Suspense fallback instead of holding the page. It re-resolves the role itself: the page's
 * `canSeeBilling` check decides whether to mount it, and this asks again before anything is read.
 */
export async function MatterBilling({ lawmaticsId }: { lawmaticsId: string | null }) {
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !canSeeBilling(session.role)) return null;
  const read = await loadMatterInvoices(lawmaticsId);
  return <BillingCard read={read} />;
}
