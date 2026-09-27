"use server";

import { revalidatePath } from "next/cache";
import { addManualEntry, deleteEntry, startTimer, stopTimer } from "@/lib/time/entries";
import { friendlyLeadWriteError } from "@/app/dashboard/leads/errors";

/**
 * Server actions for the ⏱ on an intake row or card (blueprint §13.1).
 *
 * Thin wrappers, exactly like actions.ts next door: the role gate, the
 * one-running-timer rule and the duration arithmetic all live in
 * src/lib/time/entries.ts, and this file's whole job is to turn a refusal into
 * `{ ok: false, error }` for the chip instead of an unhandled throw. Only a
 * LeadWriteError's own message is ever allowed through (friendlyLeadWriteError),
 * so a raw RLS or Postgres string can never reach a firm user's screen.
 *
 * These record INTERNAL EFFORT and nothing else. Nothing here sends email,
 * writes to Lawmatics, or reaches a client — a time entry is never a client
 * invoice, because both firms in this product bill flat fees.
 *
 * Kept in its own file rather than added to actions.ts so §13.1 is one
 * reviewable surface and the time writes are not entangled with the
 * temperature/owner/stage ones a sibling is editing this pass.
 */

export type TimeActionResult = { ok: true } | { ok: false; error: string };

/** Every write on this page touches the same two screens. */
function revalidateFor(leadId: string | null): void {
  revalidatePath("/dashboard/intake/");
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
}

/** Starts the caller's clock on a lead. Refused if they already have one running. */
export async function startTimerAction(leadId: string): Promise<TimeActionResult> {
  if (!leadId) return { ok: false, error: "Missing lead." };

  try {
    await startTimer({ leadId });
  } catch (err) {
    return { ok: false, error: friendlyLeadWriteError(err, "Couldn't start a timer.") };
  }

  revalidateFor(leadId);
  return { ok: true };
}

/**
 * Stops a running entry, optionally with the one-line note the dialog prompts
 * for. `leadId` is passed only so the right pages are revalidated — the entry
 * itself is found by id, under RLS.
 */
export async function stopTimerAction(
  entryId: string,
  note?: string | null,
  leadId?: string | null,
): Promise<TimeActionResult> {
  if (!entryId) return { ok: false, error: "Missing timer." };

  try {
    await stopTimer(entryId, note ?? null);
  } catch (err) {
    return { ok: false, error: friendlyLeadWriteError(err, "Couldn't stop this timer.") };
  }

  revalidateFor(leadId ?? null);
  return { ok: true };
}

/**
 * "+ time" — work that already happened. `atIso` is when it ENDED; omitted
 * means now. Both the 12-hour cap and the no-future rule are enforced in the
 * data layer, not here, so the dialog's client-side copy of them is a courtesy
 * rather than the guard.
 */
export async function addManualTimeAction(
  leadId: string,
  seconds: number,
  note?: string | null,
  atIso?: string | null,
): Promise<TimeActionResult> {
  if (!leadId) return { ok: false, error: "Missing lead." };

  let at: Date | undefined;
  if (atIso) {
    at = new Date(atIso);
    if (Number.isNaN(at.getTime())) return { ok: false, error: "That isn't a date we can read." };
  }

  try {
    await addManualEntry({ leadId }, seconds, note ?? null, at);
  } catch (err) {
    return { ok: false, error: friendlyLeadWriteError(err, "Couldn't log that time.") };
  }

  revalidateFor(leadId);
  return { ok: true };
}

/** Removes an entry — your own, or anyone's if you administer the firm. */
export async function deleteTimeEntryAction(
  entryId: string,
  leadId?: string | null,
): Promise<TimeActionResult> {
  if (!entryId) return { ok: false, error: "Missing entry." };

  try {
    await deleteEntry(entryId);
  } catch (err) {
    return { ok: false, error: friendlyLeadWriteError(err, "Couldn't remove that entry.") };
  }

  revalidateFor(leadId ?? null);
  return { ok: true };
}
