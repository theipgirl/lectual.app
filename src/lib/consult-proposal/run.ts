import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import type { NewQueueDraft } from "@/lib/queue/api";
import { firmCivilDate } from "@/lib/quotes/firm-time";
import { resolveTimeZone } from "@/lib/org/profile-rules";
import { loadReviewedConsult, type ConsultDb, type ReviewedConsultRead } from "@/lib/consult/store";
import { insertAgentProposal, recordConsultDraftEvent } from "@/lib/proposals/agent-create";
import { normalisePackages } from "@/lib/proposals/package-list";
import type { ProposalsDbClient } from "@/lib/proposals/store";
import { standardProposalPricing } from "@/lib/proposals/types";
import type { ValidationIssue } from "@/lib/proposals/validate";
import { clientLinkUrl, resolveClientLinkOrigin } from "@/lib/proposals/client-link-origin";
import { draftProposalFromConsult } from "./draft";
import { renderProposalEmail } from "./email";
import { describeConsultFailure, logConsultFailure, type ConsultStage } from "./failure";
import { CONSULT_PROPOSAL_SOURCE, firmSignatureName, firmTeamSignOff, pasteHash } from "./shared";
import { MAX_PASTED_TRANSCRIPT_CHARS, type ConsultLead, type ConsultSource } from "./types";

/**
 * One consult -> one DRAFT proposal + one approval-queue email, tied together.
 *
 * Called by the "Draft proposal + email" buttons (the caller's scoped client as
 * `db`) and by the post-consult cron (the service-role client as `db`). Either
 * way every statement here names the firm (`org_id`), and nothing leaves the
 * building: the proposal is a draft nobody can see until a named approver
 * approves it and it is marked sent, and the email waits in the approval queue
 * (where approving it only creates a mailbox DRAFT for a person to send).
 *
 * `admin` is always the service-role client, used for exactly one write the
 * staff policies refuse: the agent's evidence event (0089 lets a person insert
 * only `actor = 'staff'` events as themselves).
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 * A `queue_drafted` timeline row (payload.source 'consult-proposal') marks a
 * meeting (`meeting_id`) or a pasted transcript (`paste_sha256`) as done. The
 * same marker is what the queue's approve gate uses to find the proposal.
 * The cron also records a call that holds nothing to draft as an `ai_insight`
 * so it is not read again every day (`skipDecided`).
 */

export type ConsultProposalRunInput = {
  /** The caller's scoped client (buttons) or the admin client (cron). Fenced on orgId either way. */
  db: SupabaseClient;
  /** Service-role client: the evidence event only. */
  admin: SupabaseClient;
  orgId: string;
  /** The person who pressed the button; null for the cron. */
  actorUserId: string | null;
  source: ConsultSource;
  lead: ConsultLead;
  matterId: string | null;
  llm: StructuredCall;
  createDraft: (input: NewQueueDraft) => Promise<{ id: string; deduped?: boolean }>;
  queueOrgKey: string | null;
  /** https://app.example.com — the client link and the staff link are built on it. */
  origin: string | null;
  now?: () => number;
  /** Default: "[TEST] " unless VERCEL_ENV is production. */
  testPrefix?: string;
  /** The cron: also treat an earlier "nothing to draft" decision as done. */
  skipDecided?: boolean;
};

export type ConsultProposalRefusal =
  | "no_queue"
  | "no_origin"
  | "no_material"
  | "too_long"
  | "already_drafted"
  | "no_settings"
  | "no_approvers"
  | "no_firm_name"
  | "no_recommendation"
  | "not_trademark"
  | "ai_failed"
  | "proposal_failed"
  | "queue_failed"
  | "link_failed"
  | "unavailable";

export type ConsultProposalResult =
  | {
      ok: true;
      proposalId: string;
      queueId: string;
      clientName: string;
      errorCount: number;
      warningCount: number;
      costUsd: number | null;
    }
  | { ok: false; reason: ConsultProposalRefusal; message: string; costUsd: number | null };

const SUMMARY_CAP = 8000;

const refuse = (reason: ConsultProposalRefusal, message: string, costUsd: number | null = null): ConsultProposalResult => ({
  ok: false,
  reason,
  message,
  costUsd,
});

function sourceHasMaterial(source: ConsultSource): boolean {
  if (source.kind === "pasted") return source.text.trim().length > 0;
  return Boolean(source.summary?.trim()) || (source.transcript?.length ?? 0) > 0;
}

function issueLines(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return "No rule problems found by the automatic check.";
  const rows = issues.map((i) => `- ${i.level === "error" ? "Fix" : "Check"}: ${i.message}`);
  return `The automatic check found ${issues.length} thing${issues.length === 1 ? "" : "s"} to look at:\n${rows.join("\n")}`;
}

/**
 * The queue item's summary: the reviewer notes, then the proposal's staff link
 * and the validation result. The notes (up to 12k) are what gets shortened to
 * fit, never the link or the issues the approver needs.
 */
export function queueSummary(notes: string, staffUrl: string, issues: readonly ValidationIssue[]): string {
  const tail = `\n\nProposal (review, edit, approve): ${staffUrl}\n\n${issueLines(issues)}`.slice(0, SUMMARY_CAP / 2);
  const room = SUMMARY_CAP - tail.length;
  const head = notes.length <= room ? notes : `${notes.slice(0, room - 20)}\n[notes shortened]`;
  return head + tail;
}

type Row = Record<string, unknown>;

/**
 * Whether this call has already been handled. A failed read counts as handled: never draft twice on a guess.
 * A marker whose proposal has since been deleted or withdrawn no longer counts, so the call can be drafted
 * again (Oct 30: Melvin Larry's proposal was deleted, and its old marker blocked every new draft). A marker
 * that names no proposal (an `ai_insight` decision, or an older row) still counts.
 */
async function alreadyHandled(input: ConsultProposalRunInput, meetingId: string | null, hash: string | null): Promise<boolean | "failed"> {
  const types = input.skipDecided ? ["queue_drafted", "ai_insight"] : ["queue_drafted"];
  let q = input.db
    .from("crm_activity")
    .select("id, payload")
    .eq("org_id", input.orgId)
    .in("type", types)
    .eq("payload->>source", CONSULT_PROPOSAL_SOURCE);
  q = meetingId ? q.eq("payload->>meeting_id", meetingId) : q.eq("payload->>paste_sha256", hash as string);
  const { data, error } = await q.limit(20);
  if (error) {
    logDbError("check", error);
    return "failed";
  }
  const markers = (data ?? []) as Row[];
  if (markers.length === 0) return false;
  const proposalIds: string[] = [];
  for (const m of markers) {
    const id = (m.payload as Row | null | undefined)?.proposal_id;
    if (typeof id !== "string" || id.length === 0) return true;
    proposalIds.push(id);
  }
  const { data: live, error: liveErr } = await input.db
    .from("client_proposal")
    .select("id")
    .eq("org_id", input.orgId)
    .in("id", proposalIds)
    .neq("status", "withdrawn")
    .limit(1);
  if (liveErr) {
    logDbError("check", liveErr);
    return "failed";
  }
  return (live ?? []).length > 0;
}

/** Where the run is, so a throw can be named and any half-made proposal withdrawn. */
type Progress = { stage: ConsultStage; proposalId: string | null };

/**
 * Never throws. An unexpected throw at any stage is logged (stage, error name
 * and a scrubbed message; see failure.ts), any proposal already saved is
 * withdrawn, and the caller gets a refusal that says what failed.
 */
export async function runConsultProposal(input: ConsultProposalRunInput): Promise<ConsultProposalResult> {
  const progress: Progress = { stage: "check", proposalId: null };
  try {
    return await runStages(input, progress);
  } catch (err) {
    logConsultFailure(progress.stage, err);
    if (progress.proposalId) await withdrawQuietly(input.db, input.orgId, progress.proposalId);
    return refuse("unavailable", describeConsultFailure(progress.stage, err, { origin: input.origin }));
  }
}

/** A database error the caller gets as a value (not a throw): log it under its stage. */
function logDbError(stage: ConsultStage, error: unknown): void {
  logConsultFailure(stage, error);
}

async function runStages(input: ConsultProposalRunInput, progress: Progress): Promise<ConsultProposalResult> {
  const { db, admin, orgId, source, lead } = input;
  const now = input.now ?? Date.now;
  const meetingId = source.kind === "meeting" ? source.meetingId : null;

  if (!input.queueOrgKey) return refuse("no_queue", "No approval queue is connected for your firm, so nothing was drafted.");
  if (!input.origin) return refuse("no_origin", "The site address isn't known here, so the proposal link couldn't be built. Nothing was drafted.");
  if (!sourceHasMaterial(source)) return refuse("no_material", "There is no summary or transcript to draft from.");
  if (source.kind === "pasted" && source.text.length > MAX_PASTED_TRANSCRIPT_CHARS) {
    return refuse("too_long", `That transcript is too long. The most that can be pasted is ${MAX_PASTED_TRANSCRIPT_CHARS.toLocaleString("en-US")} characters.`);
  }
  const hash = source.kind === "pasted" ? pasteHash(source.text) : null;

  progress.stage = "check";
  const handled = await alreadyHandled(input, meetingId, hash);
  if (handled === "failed") return refuse("unavailable", "Couldn't check for an earlier draft. Nothing was drafted. Try again shortly.");
  if (handled) return refuse("already_drafted", "A proposal and email for this call have already been drafted. Find them in the approval queue.");

  // The firm's standard prices and its approvers. No settings or nobody to
  // approve = nothing is drafted: a proposal no one is allowed to approve is a
  // dead end, and prices are never invented.
  progress.stage = "settings";
  const { data: setting, error: settingErr } = await db
    .from("client_proposal_setting")
    .select("approver_user_ids, pricing")
    .eq("org_id", orgId)
    .maybeSingle();
  if (settingErr) logDbError("settings", settingErr);
  if (settingErr) return refuse("unavailable", "Couldn't read the proposal settings. Nothing was drafted. Try again shortly.");
  if (!setting) return refuse("no_settings", "Your firm hasn't set up its proposal prices yet (Settings, then Client proposals), so nothing was drafted.");
  const approvers = (setting as Row).approver_user_ids;
  if (!Array.isArray(approvers) || approvers.length === 0) {
    return refuse("no_approvers", "Your firm hasn't named a proposal approver yet (Settings, then Client proposals), so nothing was drafted.");
  }

  const [{ data: org }, { data: profile }] = await Promise.all([
    db.from("crm_org").select("name, slug").eq("id", orgId).maybeSingle(),
    db.from("crm_org_profile").select("time_zone").eq("org_id", orgId).maybeSingle(),
  ]);
  const orgName = ((org as Row | null)?.name as string | undefined) ?? "";
  const firmSlug = ((org as Row | null)?.slug as string | undefined) ?? "";
  const tz = resolveTimeZone((profile as Row | null)?.time_zone as string | undefined);
  // Always "The <Firm> Team": never the org's email_signature (a personal block).
  const teamSignOff = firmTeamSignOff(orgName, firmSlug);
  if (!teamSignOff) {
    return refuse("no_firm_name", "Your firm has no name set (Settings, then Firm), so the email can't be signed. Nothing was drafted.");
  }
  const firmName = firmSignatureName(orgName, firmSlug) as string;

  progress.stage = "draft";
  // The lead's reviewed consult details (a package named there wins over the call's). A read that
  // fails is said so in the draft's flags, never read as "no consult". No email or mailbox is read.
  let reviewedConsult: ReviewedConsultRead;
  try {
    reviewedConsult = await loadReviewedConsult(db as unknown as ConsultDb, lead.id, orgId);
  } catch {
    reviewedConsult = { status: "unavailable" };
  }
  let draft: Awaited<ReturnType<typeof draftProposalFromConsult>>;
  try {
    draft = await draftProposalFromConsult({
      source,
      lead,
      firm: { name: firmName, slug: firmSlug, teamSignOff },
      pricing: standardProposalPricing((setting as Row).pricing),
      packages: normalisePackages((setting as Row).pricing),
      reviewedConsult,
      today: firmCivilDate(new Date(now()), tz),
      llm: input.llm,
    });
  } catch (err) {
    logConsultFailure("draft", err);
    return refuse("ai_failed", "The proposal couldn't be written. Nothing was drafted. Try again shortly.");
  }
  if (!draft.ok) {
    if (draft.reason !== "ai_failed" && input.skipDecided) {
      // Don't read this call again tomorrow. Timeline-visible, never an error.
      await db.from("crm_activity").insert({
        org_id: orgId,
        lead_id: lead.id,
        matter_id: input.matterId,
        type: "ai_insight",
        actor_id: input.actorUserId,
        actor_type: input.actorUserId ? "user" : "ai",
        payload: {
          source: CONSULT_PROPOSAL_SOURCE,
          outcome: draft.reason,
          meeting_id: meetingId,
          paste_sha256: hash,
          summary: `The consult agent read this call and drafted no proposal: ${draft.message}`,
        },
      });
    }
    return refuse(draft.reason, draft.message, draft.costUsd);
  }

  const clientName = draft.clientName;
  const hasRealAddress = Boolean(lead.email && !lead.email.toLowerCase().endsWith(".invalid"));

  // 1. The proposal: a DRAFT, source 'agent'. Not visible to the client; it
  //    needs a named approver and then "Mark as sent" before its link works.
  progress.stage = "insert";
  let proposal: Awaited<ReturnType<typeof insertAgentProposal>>;
  try {
    proposal = await insertAgentProposal(db as unknown as ProposalsDbClient, {
      orgId,
      createdBy: input.actorUserId,
      clientName,
      clientEmail: hasRealAddress ? draft.clientEmail : null,
      title: draft.title,
      content: draft.content,
      leadId: lead.id,
      matterId: input.matterId,
      expiresOn: draft.expiresOn,
      payUrl: draft.payUrl,
    });
  } catch (err) {
    logConsultFailure("insert", err);
    return refuse("proposal_failed", `${describeConsultFailure("insert", err)}`, draft.costUsd);
  }
  progress.proposalId = proposal.id;

  // 2. What the agent relied on, for the approver (best effort; the notes are also on the queue item).
  progress.stage = "event";
  await recordConsultDraftEvent(admin as unknown as ProposalsDbClient, proposal, {
    source: CONSULT_PROPOSAL_SOURCE,
    evidence: draft.evidence,
    notes: draft.reviewerNotes,
    ...(source.kind === "meeting" ? { meeting_id: source.meetingId, meeting_title: source.title } : {}),
  });

  // 3. The email, with the client link, into the approval queue.
  progress.stage = "email";
  const origin = input.origin.replace(/\/$/, "");
  const proposalUrl = clientLinkUrl(resolveClientLinkOrigin(orgId, origin), proposal.public_token);
  const staffUrl = `${origin}/dashboard/proposals/${proposal.id}/`;
  let email: { subject: string; body: string };
  try {
    email = renderProposalEmail(draft, { proposalUrl, signOff: teamSignOff });
  } catch (err) {
    logConsultFailure("email", err);
    await withdrawQuietly(db, orgId, proposal.id);
    return refuse("unavailable", `${describeConsultFailure("email", err, { origin })}`, draft.costUsd);
  }
  const testPrefix = input.testPrefix ?? (process.env.VERCEL_ENV === "production" ? "" : "[TEST] ");
  const summary = queueSummary(draft.reviewerNotes, staffUrl, draft.issues);

  progress.stage = "queue";
  let queueId: string;
  try {
    const queued = await input.createDraft({
      orgKey: input.queueOrgKey,
      agent: "post-consult",
      type: "CLIENT_EMAIL",
      headline: `${testPrefix}Proposal + follow-up — ${clientName}`.slice(0, 200),
      summary,
      clientName,
      leadId: lead.id,
      recipient: hasRealAddress ? (lead.email as string) : undefined,
      subject: `${testPrefix}${email.subject}`,
      draftBody: email.body,
      teamSignOff,
      ...(input.matterId ? { matterId: input.matterId } : {}),
      // The marker below ties this proposal to the returned queue id, and the
      // approve gate trusts it, so this must be our own item, never another's.
      dedupe: false,
    });
    if (queued.deduped) {
      // Belt and braces: a queue that handed back someone else's item anyway.
      await withdrawQuietly(db, orgId, proposal.id);
      return refuse(
        "already_drafted",
        "A proposal email for this client is already waiting in the approval queue. Review or reject that one first.",
        draft.costUsd,
      );
    }
    queueId = queued.id;
  } catch (err) {
    logConsultFailure("queue", err);
    await withdrawQuietly(db, orgId, proposal.id);
    return refuse("queue_failed", describeConsultFailure("queue", err), draft.costUsd);
  }

  progress.stage = "marker";
  // 4. The marker: idempotency AND the approve gate's only way to find the proposal.
  const marker = {
    org_id: orgId,
    lead_id: lead.id,
    matter_id: input.matterId,
    type: "queue_drafted",
    actor_id: input.actorUserId,
    actor_type: input.actorUserId ? "user" : "ai",
    payload: {
      source: CONSULT_PROPOSAL_SOURCE,
      proposal_id: proposal.id,
      queue_id: queueId,
      subject: email.subject,
      ...(meetingId ? { meeting_id: meetingId } : {}),
      ...(hash ? { paste_sha256: hash } : {}),
    },
  };
  let written = false;
  for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
    try {
      const { error } = await db.from("crm_activity").insert(marker);
      if (error) logDbError("marker", error);
      written = !error;
    } catch (err) {
      logConsultFailure("marker", err);
    }
  }
  if (!written) {
    // Without the marker the approve gate can't find this proposal. Kill the
    // client link (a withdrawn proposal's link stops working) and say so.
    await withdrawQuietly(db, orgId, proposal.id);
    return refuse(
      "link_failed",
      "The proposal and email were drafted but couldn't be linked, so the proposal was withdrawn. Reject the email now waiting in the approval queue.",
      draft.costUsd,
    );
  }

  return {
    ok: true,
    proposalId: proposal.id,
    queueId,
    clientName,
    errorCount: draft.issues.filter((i) => i.level === "error").length,
    warningCount: draft.issues.filter((i) => i.level === "warning").length,
    costUsd: draft.costUsd,
  };
}

async function withdrawQuietly(db: SupabaseClient, orgId: string, proposalId: string): Promise<void> {
  try {
    await db.from("client_proposal").update({ status: "withdrawn" }).eq("id", proposalId).eq("org_id", orgId);
  } catch {
    // The proposal is a draft nobody can see; leaving it is harmless.
  }
}
