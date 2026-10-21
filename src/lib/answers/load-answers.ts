import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { isMissingTableError } from "@/lib/intake-forms/store";
import { boothItem, requestItem, submissionItem, type AnswerItem, type FormRef } from "./items";

/**
 * The reads behind the "Intake & assessment answers" card, through the
 * caller's scoped client only (RLS scopes each table to the active org).
 *
 * Three sources, each read on its own so one failing never hides the others:
 *   submissions   `crm_intake_submission` for the lead, with the form's name;
 *   booth         `crm_booth_scorecard` for the lead;
 *   requests      `crm_intake_request` answered on the matter.
 *
 * Each source is three-state plus "skipped" (this page has no such source): an
 * empty `ok` means "we reached it and it was empty", never "we couldn't ask".
 * Only the columns the card shows are named: never a booth row's consent
 * columns or Lawmatics ids.
 */

export const ANSWERS_ROW_LIMIT = 200;

export type SourceRead =
  | { status: "ok"; items: AnswerItem[]; capped: boolean }
  | { status: "unconfigured" }
  | { status: "unavailable" }
  | { status: "skipped" };

export type AnswersRead = { submissions: SourceRead; booth: SourceRead; requests: SourceRead };

type Client = Awaited<ReturnType<typeof getScopedClient>>;

const SKIPPED: SourceRead = { status: "skipped" };

function failure(error: unknown): SourceRead {
  return isMissingTableError(error as { code?: string }) ? { status: "unconfigured" } : { status: "unavailable" };
}

async function readSubmissions(supabase: Client, leadId: string): Promise<SourceRead> {
  try {
    const { data, error } = await supabase
      .from("crm_intake_submission")
      .select("id, form_id, mode, answers, started_at, submitted_at, score, band, temperature")
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false })
      .limit(ANSWERS_ROW_LIMIT);
    if (error) return failure(error);
    const rows = data ?? [];
    const formIds = [...new Set(rows.map((r) => r.form_id))];
    const forms = new Map<string, FormRef>();
    if (formIds.length > 0) {
      const res = await supabase.from("crm_intake_form").select("id, name, kind").in("id", formIds);
      if (res.error) return failure(res.error);
      for (const f of res.data ?? []) forms.set(f.id, { id: f.id, name: f.name, kind: f.kind === "assessment" ? "assessment" : "intake" });
    }
    return { status: "ok", items: rows.map((r) => submissionItem(r, forms.get(r.form_id))), capped: rows.length >= ANSWERS_ROW_LIMIT };
  } catch {
    return { status: "unavailable" };
  }
}

async function readBooth(supabase: Client, leadId: string): Promise<SourceRead> {
  try {
    const { data, error } = await supabase
      .from("crm_booth_scorecard")
      .select("id, event_code, track, score, band, temperature, answers, gaps, created_at, completed_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(ANSWERS_ROW_LIMIT);
    if (error) return failure(error);
    const rows = data ?? [];
    return { status: "ok", items: rows.map(boothItem), capped: rows.length >= ANSWERS_ROW_LIMIT };
  } catch {
    return { status: "unavailable" };
  }
}

async function readRequests(supabase: Client, matterId: string): Promise<SourceRead> {
  try {
    const { data, error } = await supabase
      .from("crm_intake_request")
      .select("id, status, sent_at, completed_at, answers")
      .eq("matter_id", matterId)
      // Waiting and withdrawn links are not answers.
      .eq("status", "completed")
      .order("sent_at", { ascending: false })
      .limit(ANSWERS_ROW_LIMIT);
    if (error) return failure(error);
    const rows = data ?? [];
    return {
      status: "ok",
      items: rows.map(requestItem).filter((i): i is AnswerItem => i !== null),
      capped: rows.length >= ANSWERS_ROW_LIMIT,
    };
  } catch {
    return { status: "unavailable" };
  }
}

/** The lead page: the lead's submissions and booth scorecards. Intake requests belong to matters. */
export async function loadLeadAnswers(leadId: string): Promise<AnswersRead> {
  try {
    const supabase = await getScopedClient();
    const [submissions, booth] = await Promise.all([readSubmissions(supabase, leadId), readBooth(supabase, leadId)]);
    return { submissions, booth, requests: SKIPPED };
  } catch {
    return { submissions: { status: "unavailable" }, booth: { status: "unavailable" }, requests: SKIPPED };
  }
}

/**
 * The matter page: the matter's answered requests, plus the submissions and
 * booth scorecards of the lead it came from. A matter with no lead shows its
 * own requests only (nothing else hangs off a matter).
 */
export async function loadMatterAnswers(matterId: string, leadId: string | null): Promise<AnswersRead> {
  try {
    const supabase = await getScopedClient();
    const [requests, submissions, booth] = await Promise.all([
      readRequests(supabase, matterId),
      leadId ? readSubmissions(supabase, leadId) : Promise.resolve(SKIPPED),
      leadId ? readBooth(supabase, leadId) : Promise.resolve(SKIPPED),
    ]);
    return { submissions, booth, requests };
  } catch {
    return { submissions: leadId ? { status: "unavailable" } : SKIPPED, booth: leadId ? { status: "unavailable" } : SKIPPED, requests: { status: "unavailable" } };
  }
}
