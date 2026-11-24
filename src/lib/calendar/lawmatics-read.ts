import "server-only";
import { getLawmaticsConnection } from "@/lib/lawmatics/connection";
import { loadBookedConsult, type OutlookCalendarEvent, type OutlookRead } from "./outlook-read";
import { lawmaticsGateOf, type LawmaticsGate } from "./booked-merge";

/**
 * Reads of the consults the Lawmatics daily sync stored (`source = 'lawmatics'`, its own `lmsync:` rows only).
 * Scoped client throughout (RLS). NOT behind the Mailboxes feature: Lawmatics is its own connection, so the gate
 * is "is Lawmatics connected", read from the firm's own `lawmatics_connection` row.
 */

/** The firm's Lawmatics connection as the consult readers need it. Never throws. */
export async function lawmaticsConsultGate(): Promise<LawmaticsGate> {
  try {
    return lawmaticsGateOf(await getLawmaticsConnection());
  } catch {
    return "unavailable";
  }
}

/**
 * The earliest booked Lawmatics consult linked to this lead, from now on. Null when Lawmatics isn't connected
 * (nothing to read, so nothing is claimed); otherwise the three states of `OutlookRead`.
 */
export async function loadBookedLawmaticsConsult(leadId: string, now: Date = new Date()): Promise<OutlookRead<{ event: OutlookCalendarEvent | null }> | null> {
  const gate = await lawmaticsConsultGate();
  if (gate === "not-connected") return null;
  if (gate === "unavailable") return { status: "unavailable" };
  // An `invalid` connection still has the rows the sync stored before it stopped: they are shown.
  return loadBookedConsult(leadId, now, "lawmatics");
}
