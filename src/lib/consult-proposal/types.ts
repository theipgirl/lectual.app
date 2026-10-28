/**
 * The consult agent's proposal draft — shared types (step 2, Part A).
 *
 * Pure module: types only (plus type imports), no `server-only`. `draft.ts`
 * builds a `ConsultProposalDraft` from a consult call; `run.ts` (Part B)
 * stores it as a client_proposal draft and queues the email for approval.
 *
 * Nothing here sends anything. The draft is for the firm's named approver to
 * review, edit and approve; the email becomes a mailbox draft a human sends.
 */

import type { StructuredCall } from "@/lib/ai/claude";
import type { ReviewedConsultRead } from "@/lib/consult/store";
import type { ProposalContent, ProposalPricing, standardProposalPricing } from "@/lib/proposals/types";
import type { ValidationIssue } from "@/lib/proposals/validate";

/** One speaker turn in a stored meeting transcript (crm_meeting.transcript). */
export type ConsultTranscriptTurn = { speaker: string; text: string; at?: string };

/** Where the consult came from. Either way it is untrusted DATA, never instructions. */
export type ConsultSource =
  | {
      kind: "meeting";
      meetingId: string;
      title: string;
      startedAt: string | null;
      summary: string | null;
      transcript: ConsultTranscriptTurn[] | null;
    }
  | { kind: "pasted"; text: string }; // <= 200_000 chars

/** The most a pasted transcript may be (characters). */
export const MAX_PASTED_TRANSCRIPT_CHARS = 200_000;

/** The least a transcript may be (characters) for the agent to draft from it. Pasted and uploaded alike. */
export const MIN_TRANSCRIPT_CHARS = 200;

export type ConsultLead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  businessName: string | null;
};

export type DraftConsultProposalInput = {
  source: ConsultSource;
  lead: ConsultLead;
  /** teamSignOff: "The RPB Law Team". */
  firm: { name: string; slug: string; teamSignOff: string };
  /** From src/lib/proposals/types.ts `standardProposalPricing(setting.pricing)`. */
  pricing: ReturnType<typeof standardProposalPricing>;
  /**
   * The firm's CURRENT package list, first one the default (`normalisePackages`). The proposal is priced with
   * the package the call (or the reviewed details) names; null or empty = the list couldn't be read, so the
   * flat `pricing` package is used and a flag says so.
   */
  packages?: readonly ProposalPricing[] | null;
  /** The lead's reviewed consult details (`loadReviewedConsult`): a package named there wins over the call's. */
  reviewedConsult?: ReviewedConsultRead | null;
  /** YYYY-MM-DD in the firm's time zone. */
  today: string;
  llm: StructuredCall;
  /** Firm override; null/undefined -> the built-in default (Rebecca's). */
  emailTemplate?: string | null;
};

/** One quote the model gave for a choice it made, and whether it is verbatim in the source. */
export type EvidenceItem = { path: string; quote: string; verified: boolean };

export type ConsultProposalDraft =
  | {
      ok: true;
      content: ProposalContent;
      clientName: string;
      clientEmail: string | null;
      title: string;
      /** today + 10 calendar days (Rebecca's Sevetri precedent). */
      expiresOn: string;
      /** Always null: the client's pay link is typed by a person; no default is copied. */
      payUrl: string | null;
      /** validateContent(content, { forApproval: true, ... }). */
      issues: ValidationIssue[];
      evidence: EvidenceItem[];
      /** Plain text for the approver: what was recommended + quotes + flags. */
      reviewerNotes: string;
      /**
       * The model fills ONLY the reasoning block, and only by choosing which
       * of the firm's canned paragraphs apply (schema `reasoning_parts`);
       * `reasoning` is that block assembled deterministically in code
       * (email.ts), or null when none applies. Never model prose.
       */
      email: { subject: string; reasoning: string | null };
      costUsd: number | null;
    }
  | {
      ok: false;
      reason: "no_recommendation" | "not_trademark" | "ai_failed";
      message: string;
      costUsd: number | null;
    };

export type ConsultProposalDraftOk = Extract<ConsultProposalDraft, { ok: true }>;
