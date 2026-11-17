import "server-only";
import { getAdminClient } from "@/lib/db/admin";
import { pickBookingLink } from "./booking-link";

/** Live wiring for `WorksheetDeps.bookingLinkFor`. Never throws; any failure is null. Logs nothing. */
export async function bookingLinkFor(formId: string, email: string): Promise<string | null> {
  try {
    const { data, error } = await getAdminClient().from("crm_intake_form").select("config").eq("id", formId).maybeSingle();
    if (error || !data) return null;
    return pickBookingLink((data as { config: unknown }).config, email);
  } catch {
    return null;
  }
}
