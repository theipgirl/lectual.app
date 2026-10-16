import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { staleRunning, type TimeEntryLike } from "@/lib/time";
import { notify } from "./core";

/**
 * The two producers this pass owns (blueprint §13.3): `assigned`, raised from
 * inside `assignLead`, and `time_running`, raised when somebody's clock has
 * been open longer than a working day.
 *
 * The other two producers live in their own write paths — `mentioned` in
 * saveNote, `lead_replied` in the §12.2 email sync — and all four go through
 * the single `notify()` in ./core, which is where the recipient is validated
 * against the org's member directory. Nothing here inserts a notification
 * itself.
 *
 * EVERY function below is best-effort and never throws. Each one hangs off
 * somebody else's write: the assignment and the timer are the records that
 * matter, and a bell row that cannot be written must not take them down with
 * it. Callers still wrap, so a future change here cannot regress that.
 *
 * Internal only. Nothing here sends email or SMS, writes to Lawmatics, or
 * reaches a client — a notification is one colleague telling another what
 * moved. A time entry named in one is internal effort, never a client invoice.
 *
 * Deliberately does NOT import from `@/lib/time/entries`: that module reads
 * `CAN_WRITE_LEAD` out of `@/lib/pipeline/leads` at module-evaluation time,
 * and `leads.ts` imports THIS file — an import cycle through it would leave
 * that const in its temporal dead zone depending on which module loaded
 * first. `notifyTimeRunning` therefore takes the entries it is to nudge about
 * rather than fetching them: /intake already has the caller's open timer in
 * hand for the ⏱ chip, and passes it straight in.
 */

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/** Hours a timer may stay open before its owner is told. §13.3's number. */
export const STALE_TIMER_HOURS = 8;

/**
 * A lead's name for the sentence, best-effort.
 *
 * Read through the scoped client, so a lead another firm owns simply isn't
 * there and the notification degrades to "a lead" rather than leaking a name
 * across the tenant boundary.
 */
async function leadNames(
  supabase: ScopedClient,
  ids: string[],
): Promise<Record<string, string>> {
  const wanted = Array.from(new Set(ids.filter(Boolean)));
  if (wanted.length === 0) return {};
  try {
    const { data } = await supabase
      .from("crm_lead")
      .select("id, first_name, last_name, email")
      .in("id", wanted);
    const names: Record<string, string> = {};
    for (const row of data ?? []) {
      const full = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
      const label = full || row.email;
      if (label) names[row.id] = label;
    }
    return names;
  } catch {
    return {};
  }
}

/**
 * "Rebecca assigned you Marisol Okafor".
 *
 * Called from `assignLead` after the update has already succeeded. Raises
 * nothing when the lead was unassigned (`newOwnerId` null) — there is nobody
 * to tell — and `notify()` itself drops the self-assignment case, so an
 * attorney picking up their own lead never hears about it from the bell.
 */
export async function notifyAssigned(
  leadId: string,
  newOwnerId: string | null,
  actorId: string | null,
): Promise<void> {
  if (!newOwnerId) return;

  try {
    const supabase = await getScopedClient();
    const names = await leadNames(supabase, [leadId]);
    await notify({
      userId: newOwnerId,
      kind: "assigned",
      leadId,
      actorId,
      // The lead's name, nothing else. No note, no email body, no stage
      // commentary — the panel only ever renders a sentence.
      payload: names[leadId] ? { lead_name: names[leadId] } : {},
    });
  } catch (err) {
    console.warn(
      `[notifications] assigned producer failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Which of these timers their owner has ALREADY been told about.
 *
 * Keyed on `entry_id` in the payload, because the check runs on page load
 * (§13.3: no cron) and a person who refreshes the intake list twelve times
 * must not collect twelve identical rows. One nudge per timer, ever: the row
 * stays in the bell until it is read, and the second reminder a still-running
 * clock would earn is the unread first one.
 *
 * The read is RLS-scoped to the caller's own notifications, which is exactly
 * the set the page-load check can produce — /intake nudges the CALLER about the
 * CALLER's own open timer and nobody else's. A failed read returns "none seen" —
 * a duplicate nudge is a smaller failure than silence about a clock that has
 * been running since Friday.
 */
async function alreadyNudged(supabase: ScopedClient): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from("crm_notification")
      .select("payload")
      .eq("kind", "time_running");
    const seen = new Set<string>();
    for (const row of data ?? []) {
      const payload = row.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const id = (payload as Record<string, unknown>).entry_id;
        if (typeof id === "string") seen.add(id);
      }
    }
    return seen;
  } catch {
    return new Set<string>();
  }
}

/**
 * "Your timer on Kestrel Fine Foods has been running 9 h".
 *
 * Takes the entries rather than finding them, so the caller decides whose
 * clocks are in scope and this stays testable without a clock of its own.
 * Only entries that are genuinely stale are notified — `staleRunning` is the
 * same pure predicate the ⏱ chip uses, so the bell and the card can never
 * disagree about what "too long" means.
 *
 * Notifies the entry's OWNER, which for the page-load path is the caller. It
 * does not stop anything: nobody's recorded effort is edited by a background
 * rule (see `staleRunning`'s own note).
 *
 * This IS §13.3's "checked on page load, no cron" hook: src/app/(intake)/
 * intake/page.tsx passes the caller's own open timer — the row it already read
 * for the ⏱ chip — straight in. A `useEffect` in a client component could not
 * do this job: a producer a browser can trigger is a producer a browser can
 * forge.
 */
export async function notifyTimeRunning(
  entries: readonly TimeEntryLike[],
  now: Date = new Date(),
  hours: number = STALE_TIMER_HOURS,
): Promise<void> {
  const stale = staleRunning([...entries], now, hours);
  if (stale.length === 0) return;

  try {
    const supabase = await getScopedClient();
    const seen = await alreadyNudged(supabase);
    const fresh = stale.filter((entry) => !seen.has(entry.id));
    if (fresh.length === 0) return;

    const names = await leadNames(
      supabase,
      fresh.map((entry) => entry.lead_id).filter((id): id is string => typeof id === "string"),
    );

    for (const entry of fresh) {
      const elapsed = (now.getTime() - Date.parse(entry.started_at)) / 3_600_000;
      await notify({
        userId: entry.user_id,
        kind: "time_running",
        leadId: entry.lead_id,
        matterId: entry.matter_id,
        // No actor: nobody did this to them. A system nudge has no author,
        // and naming one would make a forgotten timer look like an accusation.
        actorId: null,
        payload: {
          entry_id: entry.id,
          hours: Number.isFinite(elapsed) ? Math.floor(elapsed) : hours,
          ...(entry.lead_id && names[entry.lead_id] ? { lead_name: names[entry.lead_id] } : {}),
        },
      });
    }
  } catch (err) {
    console.warn(
      `[notifications] time_running producer failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

