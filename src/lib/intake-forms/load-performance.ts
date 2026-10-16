import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { callerHasRole } from "@/lib/auth/current-role";
import { buildFunnel, type Funnel, type FunnelEvent, type RangeDays, type SubmissionDetailRow, type SubmissionListRow } from "./performance";
import { isMissingTableError, IntakeFormError } from "./store";
import { isSubmissionStatus } from "./submission";

/**
 * The Performance tab's reads, each three-state, through the scoped client
 * (RLS on `crm_intake_event` / `crm_intake_submission` is org-scoped, read-only
 * for the firm, except a submission's `status`).
 *
 * A failed read is never drawn as zero: "0 visits" when the events table was
 * unreachable would tell a firm its intake is dead when it isn't.
 */

type Load<T> = { status: "ok"; value: T } | { status: "unconfigured" } | { status: "unavailable"; error?: unknown };

const PAGE = 1000;
/** 50k events per range is far past any MVP firm; past it the page says the counts are capped. */
const MAX_PAGES = 50;

export async function loadFunnel(formId: string, range: RangeDays, now = new Date()): Promise<Load<Funnel & { capped: boolean }>> {
  try {
    const supabase = await getScopedClient();
    const since = new Date(now.getTime() - range * 86_400_000).toISOString();
    const events: FunnelEvent[] = [];
    let capped = false;
    for (let page = 0; ; page++) {
      if (page === MAX_PAGES) {
        capped = true;
        break;
      }
      const { data, error } = await supabase
        .from("crm_intake_event")
        .select("kind, session_hash")
        .eq("form_id", formId)
        .gte("occurred_at", since)
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable", error };
      events.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return { status: "ok", value: { ...buildFunnel(events), capped } };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

export const INTAKE_TABLE_LIMIT = 200;

/** The latest intakes, newest first. No answers: those load one at a time, for the drawer. */
export async function loadIntakeList(formId: string): Promise<Load<SubmissionListRow[]>> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_intake_submission")
      .select("id, mode, contact, fit, status, started_at, last_active_at")
      .eq("form_id", formId)
      .order("started_at", { ascending: false })
      .limit(INTAKE_TABLE_LIMIT);
    if (error) return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable", error };
    return { status: "ok", value: data ?? [] };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/** One intake for the drawer. `value: null` under ok means not found in this firm. */
export async function loadIntakeSubmission(id: string): Promise<Load<SubmissionDetailRow | null>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: "ok", value: null };
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_intake_submission")
      .select("id, mode, contact, answers, fit, status, screening_note, started_at, submitted_at, last_active_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable", error };
    return { status: "ok", value: data };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/**
 * Moves an intake's status. Anyone in the firm but a viewer (0079's
 * `crm_intake_submission_update`; `clerk` is the rank just above viewer).
 * Only the `status` column is granted to the firm, and only it is written.
 * Nothing is sent to the prospect: a status is the firm's own bookkeeping.
 */
export async function setIntakeSubmissionStatus(id: string, status: string): Promise<void> {
  if (!(await callerHasRole("clerk"))) throw new IntakeFormError("Viewers can't change an intake's status.");
  if (!isSubmissionStatus(status)) throw new IntakeFormError("Choose a status from the list.");
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("crm_intake_submission").update({ status }).eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new IntakeFormError("That intake isn't in your firm.");
}
