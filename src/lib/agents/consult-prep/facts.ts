import type { SupabaseClient } from "@supabase/supabase-js";
import { boothItem, mergeAnswerItems, scoreLine, submissionItem, type AnswerItem, type AnswerPair, type FormRef } from "@/lib/answers/items";
import { scrubJudgmentContent } from "@/lib/prep-consult/prep-consult";
import { classifyEmail } from "@/lib/intake/email-match";
import { chunk, IN_CHUNK, leadLabel, text } from "../shared";

/**
 * The facts card behind a consult heads-up: what the firm already has on the lead, laid out for the
 * attorney. Deterministic: every line is read from a table the firm owns and rendered here, none is
 * written by a model, so nothing in it can be invented.
 *
 * It states facts and never judgment. A class number, a package, a risk call or a price is attorney
 * work and is never generated: values read from the record (a mark, a business name, an email
 * subject) have any such fragment withheld ("[omitted]") before they are printed, and the card's own
 * wording avoids those words. The ONE place a client's own text is printed as written is the
 * "In the client's words" block: a client may say "$5,000", and that is theirs, shown verbatim and
 * labelled, never the system's statement.
 *
 * Privacy: no email body or preview is ever read (the timeline rows carry none), a sensitive thread's
 * subject is omitted, and a meeting contributes its title, date and source only, never its transcript
 * or summary.
 */

export type SourceState = "ok" | "unavailable";

export type LeadFacts = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  practiceArea: string | null;
  markText: string | null;
  referralSource: string | null;
  referralDetail: string | null;
  stage: string | null;
  /** The lead's Lawmatics prospect id, when linked. */
  lawmaticsId: string | null;
};

export type AnswerBlock = { label: string; at: string; pairs: AnswerPair[]; score: string | null };
export type AnswersRead = { state: "ok"; blocks: AnswerBlock[] } | { state: "unavailable" };

export type MailSummary = {
  received: number;
  sent: number;
  newestReceived: string | null;
  subjects: string[];
  withheld: number;
};
export type MailRead = { state: "ok"; summary: MailSummary } | { state: "unavailable" };

export type MeetingLine = { title: string; at: string | null; source: string };
export type MeetingsRead = { state: "ok"; meetings: MeetingLine[] } | { state: "unavailable" };

export const ANSWER_PAIR_CAP = 12;
const ANSWER_CHARS = 400;
const MAIL_ROWS = 200;
const SUBJECT_COUNT = 3;
const MEETING_COUNT = 5;
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

// ── reads (every statement names the firm) ───────────────────────────────────

export async function readLeadFacts(admin: SupabaseClient, orgId: string, leadId: string): Promise<LeadFacts | null> {
  const { data, error } = await admin
    // live-guard: reads the lead a calendar consult is linked to; calendar events move to the keeper in the merge
    .from("crm_lead")
    .select("id, first_name, last_name, business_name, email, phone, practice_area, mark_text, referral_source, referral_detail, current_stage_id, lawmatics_id")
    .eq("org_id", orgId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error("lead read failed");
  if (!data) return null;
  let stage: string | null = null;
  try {
    const res = await admin.from("crm_stage").select("name").eq("org_id", orgId).eq("id", data.current_stage_id).maybeSingle();
    stage = res.error ? null : ((res.data?.name as string | undefined) ?? null);
  } catch {
    stage = null;
  }
  return {
    id: data.id as string,
    firstName: data.first_name ?? null,
    lastName: data.last_name ?? null,
    businessName: data.business_name ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    practiceArea: data.practice_area ?? null,
    markText: data.mark_text ?? null,
    referralSource: data.referral_source ?? null,
    referralDetail: data.referral_detail ?? null,
    stage,
    lawmaticsId: (data.lawmatics_id as string | null | undefined) ?? null,
  };
}

/** The lead's intake submissions and booth scorecards, through the shared item builders so an answer reads as it does on the lead page. */
export async function readLeadAnswers(admin: SupabaseClient, orgId: string, leadId: string): Promise<AnswersRead> {
  try {
    const items: AnswerItem[] = [];
    const subs = await admin
      .from("crm_intake_submission")
      .select("id, form_id, mode, answers, started_at, submitted_at, score, band, temperature")
      .eq("org_id", orgId)
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false })
      .limit(50);
    if (subs.error && !MISSING_TABLE.has(subs.error.code ?? "")) return { state: "unavailable" };
    const subRows = subs.error ? [] : (subs.data ?? []);
    const forms = new Map<string, FormRef>();
    const formIds = [...new Set(subRows.map((r) => r.form_id as string))];
    for (const batch of chunk(formIds, IN_CHUNK)) {
      const res = await admin.from("crm_intake_form").select("id, name, kind").eq("org_id", orgId).in("id", batch);
      if (res.error) return { state: "unavailable" };
      for (const f of res.data ?? []) forms.set(f.id as string, { id: f.id as string, name: f.name as string, kind: f.kind === "assessment" ? "assessment" : "intake" });
    }
    for (const r of subRows) items.push(submissionItem(r as never, forms.get(r.form_id as string)));

    const booth = await admin
      .from("crm_booth_scorecard")
      .select("id, event_code, track, score, band, temperature, answers, gaps, created_at, completed_at")
      .eq("org_id", orgId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (booth.error && !MISSING_TABLE.has(booth.error.code ?? "")) return { state: "unavailable" };
    for (const r of booth.error ? [] : (booth.data ?? [])) items.push(boothItem(r as never));

    const merged = mergeAnswerItems(items).filter((i) => i.pairs.length > 0);
    const newestIntake = merged.find((i) => i.kind === "submission" && i.formKind === "intake");
    const newestAssessment = merged.find((i) => (i.kind === "submission" && i.formKind === "assessment") || i.kind === "booth");
    const blocks: AnswerBlock[] = [];
    for (const [label, item] of [
      ["Intake form", newestIntake],
      ["Assessment", newestAssessment],
    ] as const) {
      if (!item) continue;
      const summary = item.kind === "request" ? null : item.summary;
      blocks.push({ label, at: item.at, pairs: item.pairs, score: summary ? scoreLine(summary) : null });
    }
    return { state: "ok", blocks };
  } catch {
    return { state: "unavailable" };
  }
}

/** Counts and a few subjects from the mail the sync filed on the lead. No body, no preview: the rows carry none. */
export async function readMailSummary(admin: SupabaseClient, orgId: string, leadId: string): Promise<MailRead> {
  try {
    const { data, error } = await admin
      .from("crm_activity")
      .select("type, created_at, payload")
      .eq("org_id", orgId)
      .eq("lead_id", leadId)
      .in("type", ["email_sent", "email_received"])
      .order("created_at", { ascending: false })
      .limit(MAIL_ROWS);
    if (error) return { state: "unavailable" };
    const rows = (data ?? []) as Array<{ type: string; created_at: string; payload: Record<string, unknown> | null }>;
    const summary: MailSummary = { received: 0, sent: 0, newestReceived: null, subjects: [], withheld: 0 };
    for (const row of rows) {
      const received = row.type === "email_received";
      if (received) {
        summary.received += 1;
        if (!summary.newestReceived) summary.newestReceived = row.created_at;
      } else {
        summary.sent += 1;
      }
      const subject = text(row.payload?.subject);
      const sensitive = row.payload?.sensitive === true || classifyEmail(subject, "").sensitive;
      if (sensitive) {
        summary.withheld += 1;
        continue;
      }
      if (subject && summary.subjects.length < SUBJECT_COUNT) summary.subjects.push(subject);
    }
    return { state: "ok", summary };
  } catch {
    return { state: "unavailable" };
  }
}

const PROVIDER_LABEL: Record<string, string> = { fathom: "Fathom", zoom: "Zoom" };

/** Earlier meetings linked to the lead: title, date and source. The transcript and summary columns are never selected. */
export async function readMeetingHistory(admin: SupabaseClient, orgId: string, leadId: string): Promise<MeetingsRead> {
  try {
    const { data, error } = await admin
      .from("crm_meeting")
      .select("title, started_at, provider")
      .eq("org_id", orgId)
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false })
      .limit(MEETING_COUNT);
    if (error) return { state: "unavailable" };
    return {
      state: "ok",
      meetings: ((data ?? []) as Array<{ title: string | null; started_at: string | null; provider: string | null }>).map((m) => ({
        title: text(m.title) ?? "Untitled meeting",
        at: m.started_at ?? null,
        source: PROVIDER_LABEL[m.provider ?? ""] ?? "a meeting source",
      })),
    };
  } catch {
    return { state: "unavailable" };
  }
}

// ── files ────────────────────────────────────────────────────────────────────

export type FileLine = { name: string; type: string; at: string };
export type FilesRead = { state: "ok"; files: FileLine[]; more: number } | { state: "not-set-up" } | { state: "unavailable" };

const FILE_ROWS = 15;

const MIME_WORD: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "image",
  "image/jpeg": "image",
  "image/heic": "image",
  "image/gif": "image",
  "image/webp": "image",
  "text/plain": "text",
  "text/csv": "spreadsheet",
  "application/msword": "Word document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
};

/**
 * The files uploaded on the lead and on leads merged into it: file name, type word and upload date ONLY. The file's
 * contents are never read and no storage path or download link is selected. Every statement names the firm.
 */
export async function readLeadFiles(admin: SupabaseClient, orgId: string, leadId: string, mergedIds: readonly string[] = []): Promise<FilesRead> {
  try {
    const ids = [leadId, ...mergedIds];
    const base = admin.from("crm_file").select("file_name, mime, created_at").eq("org_id", orgId);
    const { data, error } = await (ids.length > 1 ? base.in("lead_id", ids) : base.eq("lead_id", leadId))
      .order("created_at", { ascending: false })
      .limit(FILE_ROWS + 1);
    if (error) return MISSING_TABLE.has(error.code ?? "") ? { state: "not-set-up" } : { state: "unavailable" };
    const rows = (data ?? []) as Array<{ file_name: string; mime: string | null; created_at: string }>;
    return {
      state: "ok",
      files: rows.slice(0, FILE_ROWS).map((r) => ({ name: r.file_name, type: MIME_WORD[r.mime ?? ""] ?? "file", at: r.created_at })),
      more: Math.max(0, rows.length - FILE_ROWS),
    };
  } catch {
    return { state: "unavailable" };
  }
}

// ── small helpers ────────────────────────────────────────────────────────────

const safe = (value: string | null | undefined): string | null => {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return flat ? scrubJudgmentContent(flat) : null;
};

function clip(value: string): string {
  return value.length > ANSWER_CHARS ? `${value.slice(0, ANSWER_CHARS - 1)}…` : value;
}

export function cardName(lead: LeadFacts): string {
  return leadLabel({ first_name: lead.firstName, last_name: lead.lastName, business_name: lead.businessName }, "the client");
}

/** What the client-prep email may know: the lead's own stated interest, with refusable fragments withheld. */
export function inquiryDescription(lead: LeadFacts, answers: AnswersRead): string {
  const lines: string[] = [];
  const interest = [safe(lead.practiceArea), safe(lead.markText) ? `the name ${safe(lead.markText)}` : null, safe(lead.businessName) ? `for ${safe(lead.businessName)}` : null].filter(Boolean);
  if (interest.length > 0) lines.push(`Interested in ${interest.join(" ")}.`);
  if (answers.state === "ok") {
    for (const block of answers.blocks.filter((b) => b.label === "Intake form")) {
      for (const pair of block.pairs.slice(0, 4)) {
        const q = safe(pair.question);
        const a = safe(clip(pair.answer));
        if (q && a) lines.push(`${q} ${a}`);
      }
    }
  }
  return lines.join(" ").slice(0, 800) || "No description of the inquiry is on file.";
}
