import "server-only";

import { getFirmTimeZone } from "@/lib/org/profile";
import { getScopedClient } from "@/lib/db/scoped-client";
import { DocumentFlowError } from "@/lib/documents/errors";
import { generateTrademarkLoe } from "@/lib/documents/generate";
import { listDraftsForProposal } from "@/lib/documents/store";
import { renderAcceptedProposalDocx, DOCX_MIME } from "@/lib/documents/accepted-proposal-docx";
import { setProspectCustomFields, uploadMatterFile } from "@/lib/lawmatics/writes";
import { orgHasModule } from "@/lib/org/modules";
import { firmCivilDate } from "@/lib/quotes/firm-time";
import { addAcceptanceNote, type LookupDb } from "./accept-followups";
import { lawmaticsMatterAccess, resolveProposalMatter, signedInLawmaticsToken } from "./lawmatics-access";
import { loeInputFromAcceptedProposal, loeFieldValues, LOE_REFUSAL_TEXT, type LoeAdapterResult } from "./loe-adapter";
import { fieldWrites, readLoeFieldsConfig, type LoeFieldsConfig } from "./loe-fields";
import { retryLoeFileUpload } from "./loe-upload";
import { normalisePackages } from "./package-list";
import {
  draftsInRound,
  paidStateFromEvents,
  roundStartedAt,
  stepPayload,
  stepSucceeded,
  type ProposalStep,
  type RetryableStep,
} from "./paid";
import { MARK_PAID_WORDS, STEP_TEXT } from "./step-text";
import { getProposalRow, getProposalSettings, listProposalStepEvents, recordProposalStep, type ProposalStepEvent } from "./store";
import type { ProposalRow } from "./types";

/**
 * "Mark paid" on an accepted proposal, its Undo, and the follow-up steps (Sprint 19).
 *
 * ── SCOPED CLIENT ONLY ──────────────────────────────────────────────────────
 * Everything here runs as the signed-in person through their own scoped client (RLS is the
 * boundary). The server actions call their gate (module, role) FIRST and then these
 * functions, which re-read the proposal themselves: another firm's id is simply not found.
 *
 * ── THE STEPS ARE INDEPENDENT ───────────────────────────────────────────────
 * The paid mark is its own event and is written first. Each follow-up after it (the LOE
 * draft, the accepted-proposal file, the LOE fields) runs in its own try/catch, writes its
 * own timeline line, and never stops the others. A blocked or failed step is a line the
 * person reads on the proposal; nothing is silent. Nothing here sends anything, moves a
 * stage or opens a matter.
 *
 * ── ONCE PER VERSION ────────────────────────────────────────────────────────
 * "Done already" is read from the version's own timeline (and, for the LOE draft, from the
 * matter's document drafts too). There is no database constraint behind it, so two truly
 * simultaneous clicks could both pass the check: sequential repeats (a second click, undo
 * then mark again, a reload) never duplicate anything.
 *
 * Nothing here logs a name, an email, an amount, a token or file content.
 */

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

export type FlowReport = { step: ProposalStep; outcome: string; reason: string | null; recorded: boolean };

export type FlowResult =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Steps that ran and left a line on the timeline. */
      reports: FlowReport[];
      /** Things that were already done, said in the confirmation but not written again. */
      notes: string[];
      /** Mark paid found the version already paid and did nothing. */
      alreadyPaid?: true;
    };

const NOT_FOUND = "Proposal not found.";

type Loaded = { ok: true; proposal: ProposalRow; events: ProposalStepEvent[] } | { ok: false; error: string };

/** The accepted version and its step events, or the sentence that says why not. A failed read is its own sentence. */
async function loadAccepted(id: string): Promise<Loaded> {
  let proposal: ProposalRow | null;
  try {
    proposal = await getProposalRow(id);
  } catch {
    return { ok: false, error: "Couldn't load the proposal. Try again shortly." };
  }
  if (!proposal) return { ok: false, error: NOT_FOUND };
  if (proposal.status !== "accepted" || !proposal.accepted_snapshot) {
    return { ok: false, error: "Only an accepted proposal can be marked paid." };
  }
  const read = await listProposalStepEvents(proposal.id);
  if (!read.ok) return { ok: false, error: MARK_PAID_WORDS.unreadable + ". Reload the page to try again." };
  return { ok: true, proposal, events: read.events };
}

async function report(proposal: ProposalRow, step: ProposalStep, outcome: string, reason: string | null, extra: Record<string, string | number> = {}): Promise<FlowReport> {
  const recorded = await recordProposalStep(proposal, stepPayload(step, outcome, reason, extra));
  return { step, outcome, reason: reason ?? null, recorded };
}

/** A step's body, with an unexpected throw turned into a recorded "failed" and a fixed sentence (never the error's text). */
async function guarded(proposal: ProposalRow, step: ProposalStep, body: () => Promise<FlowReport | { note: string } | null>): Promise<FlowReport | { note: string } | null> {
  try {
    return await body();
  } catch {
    console.error(`[proposals] the ${step} step stopped early`);
    try {
      return await report(proposal, step, "failed", "something went wrong; try again");
    } catch {
      return { step, outcome: "failed", reason: "something went wrong; try again", recorded: false };
    }
  }
}

/* ─────────────────────────── what the steps read ────────────────────────── */

type Facts = {
  tz: string;
  /** The firm's current package list; null when settings couldn't be read. */
  packages: ReturnType<typeof normalisePackages> | null;
  /** The LOE fields setting; null when settings couldn't be read (then the step stays inert). */
  fields: LoeFieldsConfig | null;
  adapted: LoeAdapterResult;
};

async function loadFacts(proposal: ProposalRow): Promise<Facts> {
  const [tz, settings] = await Promise.all([
    getFirmTimeZone().catch(() => "America/New_York"),
    getProposalSettings().then(
      (row) => ({ ok: true as const, pricing: row?.pricing ?? {} }),
      () => ({ ok: false as const }),
    ),
  ]);
  const packages = settings.ok ? normalisePackages(settings.pricing) : null;
  return {
    tz,
    packages,
    fields: settings.ok ? readLoeFieldsConfig(settings.pricing) : null,
    adapted: loeInputFromAcceptedProposal(proposal.accepted_snapshot!, { packages, todayIso: firmCivilDate(new Date(), tz) }),
  };
}

/* ─────────────────────────── the steps ──────────────────────────────────── */

async function loeDraftStep(supabase: ScopedClient, proposal: ProposalRow, events: ProposalStepEvent[], facts: Facts): Promise<FlowReport | { note: string } | null> {
  if (stepSucceeded(events, proposal.id, "loe_draft")) return { note: STEP_TEXT.alreadyQueued };
  if (!(await orgHasModule("document-center"))) return report(proposal, "loe_draft", "blocked", STEP_TEXT.documentCenterOff, { code: "module_off" });

  if (!facts.adapted.ok) {
    // An unknown package sends the person to the LOE form on the matter, so carry the matter found through the lead.
    // Spec 7: marks accepted under different packages are also "Choose the LOE template": the line carries the
    // `unknown_package` code the payment panel links from (paid-view.ts is unchanged), with its own sentence and `detail`.
    const reason = facts.adapted.reason;
    if (reason === "unknown_package" || reason === "mixed_mark_packages") {
      const mixed: Record<string, string> = reason === "mixed_mark_packages" ? { detail: reason } : {};
      const found = await resolveProposalMatter(supabase, proposal);
      if (found.status === "one") {
        return report(proposal, "loe_draft", "blocked", LOE_REFUSAL_TEXT[reason], { code: "unknown_package", ...mixed, matter_id: found.id });
      }
      return report(proposal, "loe_draft", "blocked", LOE_REFUSAL_TEXT[reason], { code: "unknown_package", ...mixed });
    }
    return report(proposal, "loe_draft", "blocked", LOE_REFUSAL_TEXT[facts.adapted.reason], { code: facts.adapted.reason });
  }

  const matter = await resolveProposalMatter(supabase, proposal);
  if (matter.status === "none") return report(proposal, "loe_draft", "blocked", STEP_TEXT.noMatter, { code: "no_matter" });
  if (matter.status === "many") return report(proposal, "loe_draft", "blocked", STEP_TEXT.manyMatters, { code: "many_matters" });
  if (matter.status === "unreadable") return report(proposal, "loe_draft", "failed", STEP_TEXT.mattersUnreadable, { code: "matters_unreadable" });

  const drafts = await listDraftsForProposal(supabase, matter.id, proposal.id);
  if (drafts === null) return report(proposal, "loe_draft", "failed", STEP_TEXT.draftsUnreadable, { code: "drafts_unreadable" });
  // lectual 0101: a reset starts a fresh round, so a letter drafted for the earlier acceptance doesn't count.
  const earlier = draftsInRound(drafts, roundStartedAt(events, proposal.id));
  if (earlier.length > 0) {
    // A draft exists but its timeline line never landed: write the line, create nothing.
    const queueItemId = earlier.find((d) => d.queue_item_id)?.queue_item_id;
    await report(proposal, "loe_draft", "queued", null, { draft_id: earlier[0].id, ...(queueItemId ? { queue_item_id: queueItemId } : {}) });
    return { note: STEP_TEXT.alreadyQueued };
  }

  try {
    const made = await generateTrademarkLoe({ ...facts.adapted.input, matterId: matter.id, proposalId: proposal.id });
    return report(proposal, "loe_draft", "queued", null, { draft_id: made.draftId, queue_item_id: made.queueItemId });
  } catch (err) {
    // A DocumentFlowError is a sentence written to be read ("Approvals aren't enabled for this firm yet..."); anything else is not.
    if (err instanceof DocumentFlowError) return report(proposal, "loe_draft", "blocked", err.message, { code: "flow" });
    console.error("[proposals] the engagement letter draft failed");
    return report(proposal, "loe_draft", "failed", STEP_TEXT.draftFailed, { code: "failed" });
  }
}

async function acceptedUploadStep(supabase: ScopedClient, proposal: ProposalRow, events: ProposalStepEvent[], facts: Facts): Promise<FlowReport | { note: string } | null> {
  if (stepSucceeded(events, proposal.id, "accepted_file_upload")) return { note: STEP_TEXT.alreadyUploaded };
  const matter = await resolveProposalMatter(supabase, proposal);
  const access = lawmaticsMatterAccess(matter, await signedInLawmaticsToken(), "uploaded");
  if (!access.ok) return report(proposal, "accepted_file_upload", "blocked", access.reason);

  const snapshot = proposal.accepted_snapshot!;
  const file = await renderAcceptedProposalDocx(snapshot, {
    clientName: proposal.client_name,
    entityName: snapshot.content.client?.company ?? null,
    timeZone: facts.tz,
  });
  const sent = await uploadMatterFile(access.token, { matterId: access.lawmaticsId, fileName: file.fileName, mime: DOCX_MIME, bytes: file.buffer });
  return sent.ok
    ? report(proposal, "accepted_file_upload", "uploaded", null)
    : report(proposal, "accepted_file_upload", "failed", sent.reason);
}

async function customFieldsStep(supabase: ScopedClient, proposal: ProposalRow, events: ProposalStepEvent[], facts: Facts): Promise<FlowReport | { note: string } | null> {
  // OFF BY DEFAULT: no setting, a setting that couldn't be read, or `enabled: false` makes no request and leaves no line.
  if (!facts.fields || !facts.fields.enabled) return null;
  if (stepSucceeded(events, proposal.id, "custom_fields")) return { note: STEP_TEXT.alreadyWritten };
  if (!facts.adapted.ok) return report(proposal, "custom_fields", "blocked", LOE_REFUSAL_TEXT[facts.adapted.reason], { code: facts.adapted.reason });

  const { writes, unmapped } = fieldWrites(facts.fields, loeFieldValues(facts.adapted.input));
  if (writes.length === 0) return report(proposal, "custom_fields", "skipped", STEP_TEXT.fieldsNoMapping);

  const matter = await resolveProposalMatter(supabase, proposal);
  const access = lawmaticsMatterAccess(matter, await signedInLawmaticsToken(), "written");
  if (!access.ok) return report(proposal, "custom_fields", "blocked", access.reason);

  const sent = await setProspectCustomFields(access.token, access.lawmaticsId, writes);
  if (!sent.ok) return report(proposal, "custom_fields", "failed", sent.reason);
  return report(proposal, "custom_fields", "written", unmapped.length > 0 ? `Not matched to a field, so skipped: ${unmapped.join(", ")}.` : null);
}

async function noteStep(supabase: ScopedClient, proposal: ProposalRow, events: ProposalStepEvent[]): Promise<FlowReport | { note: string } | null> {
  if (stepSucceeded(events, proposal.id, "lawmatics_note")) return { note: STEP_TEXT.alreadyNoted };
  const token = await signedInLawmaticsToken();
  if (token.status === "unavailable") return report(proposal, "lawmatics_note", "failed", "couldn't check the Lawmatics connection");
  const result = await addAcceptanceNote(
    supabase as unknown as LookupDb,
    {
      id: proposal.id,
      orgId: proposal.org_id,
      clientName: proposal.client_name,
      clientEmail: proposal.client_email,
      matterId: proposal.matter_id,
      leadId: proposal.lead_id,
      snapshot: proposal.accepted_snapshot!,
    },
    token.status === "ok" ? token.token : null,
  );
  return report(proposal, "lawmatics_note", result.outcome, result.reason ?? null);
}

function split(results: Array<FlowReport | { note: string } | null>): { reports: FlowReport[]; notes: string[] } {
  const reports: FlowReport[] = [];
  const notes: string[] = [];
  for (const r of results) {
    if (!r) continue;
    if ("note" in r) notes.push(r.note);
    else reports.push(r);
  }
  return { reports, notes };
}

/* ─────────────────────────── mark paid ──────────────────────────────────── */

export async function markProposalPaid(id: string): Promise<FlowResult> {
  const loaded = await loadAccepted(id);
  if (!loaded.ok) return loaded;
  const { proposal, events } = loaded;

  // Already paid: no second event and no follow-ups (a stale click can't double-mark).
  if (paidStateFromEvents(events).state === "paid") return { ok: true, reports: [], notes: [STEP_TEXT.alreadyPaid], alreadyPaid: true };

  const marked = await recordProposalStep(proposal, stepPayload("paid_marked", "marked", null));
  if (!marked) return { ok: false, error: "Couldn't save the paid mark. Nothing was changed; try again." };

  try {
    const supabase = await getScopedClient();
    const facts = await loadFacts(proposal);
    const results: Array<FlowReport | { note: string } | null> = [];
    // In order, one at a time: each is independent, and none stops the next.
    results.push(await guarded(proposal, "loe_draft", () => loeDraftStep(supabase, proposal, events, facts)));
    results.push(await guarded(proposal, "accepted_file_upload", () => acceptedUploadStep(supabase, proposal, events, facts)));
    results.push(await guarded(proposal, "custom_fields", () => customFieldsStep(supabase, proposal, events, facts)));
    return { ok: true, ...split(results) };
  } catch {
    // The paid mark is already saved; only the follow-ups couldn't start. Each can be run again from the page.
    console.error("[proposals] the follow-up steps couldn't start");
    return { ok: true, reports: [], notes: [STEP_TEXT.followupsNotStarted] };
  }
}

/* ─────────────────────────── undo ───────────────────────────────────────── */

/** Writes `paid_undone`. Deletes nothing and withdraws nothing: a queued engagement letter stays queued. */
export async function undoProposalPaid(id: string): Promise<FlowResult> {
  const loaded = await loadAccepted(id);
  if (!loaded.ok) return loaded;
  if (paidStateFromEvents(loaded.events).state !== "paid") return { ok: false, error: "This proposal isn't marked paid." };
  const done = await recordProposalStep(loaded.proposal, stepPayload("paid_undone", "undone", null));
  if (!done) return { ok: false, error: "Couldn't save the undo. Nothing was changed; try again." };
  return { ok: true, reports: [], notes: [MARK_PAID_WORDS.undoneNotice] };
}

/* ─────────────────────────── retry ──────────────────────────────────────── */

/**
 * Runs one failed or blocked step again, for a paid version. A step that already ended in its
 * success word is not repeated. The same idempotence and the same signed-in token rules as
 * the first run.
 */
export async function retryProposalStep(id: string, step: RetryableStep): Promise<FlowResult> {
  const loaded = await loadAccepted(id);
  if (!loaded.ok) return loaded;
  const { proposal, events } = loaded;
  if (paidStateFromEvents(events).state !== "paid") return { ok: false, error: "Mark the proposal paid first." };

  const supabase = await getScopedClient();
  const run = async (): Promise<FlowReport | { note: string } | null> => {
    switch (step) {
      case "loe_draft":
        return loeDraftStep(supabase, proposal, events, await loadFacts(proposal));
      case "accepted_file_upload":
        return acceptedUploadStep(supabase, proposal, events, await loadFacts(proposal));
      case "custom_fields":
        return customFieldsStep(supabase, proposal, events, await loadFacts(proposal));
      case "lawmatics_note":
        return noteStep(supabase, proposal, events);
      case "loe_file_upload": {
        if (stepSucceeded(events, proposal.id, "loe_file_upload")) return { note: "The engagement letter is already uploaded to Lawmatics." };
        const r = await retryLoeFileUpload(proposal);
        // Nothing to upload yet (no queued letter, not approved, not stored): said, not written as a step.
        if (!r.recorded && r.outcome === "blocked" && r.reason) return { note: r.reason };
        return { step: "loe_file_upload", outcome: r.outcome, reason: r.reason, recorded: r.recorded };
      }
    }
  };
  return { ok: true, ...split([await guarded(proposal, step, run)]) };
}

/** The upload-named entry the contract lists; it runs any retryable step. */
export const retryProposalUpload = retryProposalStep;
