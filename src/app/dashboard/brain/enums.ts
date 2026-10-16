import type { BrainCategory, ClaimStatus } from "@/lib/brain";
import { hasRole, type Role } from "@/lib/auth/roles";

/**
 * Plain (non-"use server") module for the brain-page form enums, labels, and
 * role checks. Next.js 16 requires every export of a "use server" file to be
 * an async function, so these — imported by both the server page and client
 * forms — cannot live in `actions.ts` alongside the server actions. Mirrors
 * the equivalent split in lectual's src/lib/settings/enums.ts.
 */

export const BRAIN_CATEGORIES = [
  "identity",
  "voice",
  "pricing",
  "engagement_norms",
  "decision_log",
  "client_language",
  "template",
  "stage_mapping",
  "other",
] as const satisfies readonly BrainCategory[];

export const BRAIN_CATEGORY_LABEL: Record<BrainCategory, string> = {
  identity: "Identity",
  voice: "Voice",
  pricing: "Pricing",
  engagement_norms: "Engagement norms",
  decision_log: "Decision log",
  client_language: "Client language",
  template: "Template",
  stage_mapping: "Stage mapping",
  other: "Other",
};

/**
 * What each collection of firm memory is for. Static copy describing the
 * category itself — never a count, a sample, or anything derived from a
 * design mock. Every number on the page comes from the rows actually read.
 */
export const BRAIN_CATEGORY_BLURB: Record<BrainCategory, string> = {
  identity: "Who the firm is — practice areas, positioning, the facts that don't change.",
  voice: "How the firm sounds in writing, and the phrasing it avoids.",
  pricing: "Flat-fee structures and what each one includes.",
  engagement_norms: "How the firm engages, responds, and hands work off.",
  decision_log: "Decisions the firm has already made, so nobody re-litigates them.",
  client_language: "The words this firm uses with clients — and the jargon it doesn't.",
  template: "Reusable language the firm has already written and settled on.",
  stage_mapping: "How this firm's own vocabulary maps onto the pipeline stages.",
  other: "Everything else the firm has written down.",
};

export function isBrainCategory(value: unknown): value is BrainCategory {
  return typeof value === "string" && (BRAIN_CATEGORIES as readonly string[]).includes(value);
}

export const CLAIM_STATUSES = [
  "proposed",
  "approved",
  "forbidden",
] as const satisfies readonly ClaimStatus[];

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  proposed: "Proposed",
  approved: "Approved",
  forbidden: "Forbidden",
};

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === "string" && (CLAIM_STATUSES as readonly string[]).includes(value);
}

/** lx-pill tone (see globals.css: lx-pill-ok/warn/risk/mute) for a claim's status. */
export function pillToneForClaimStatus(status: ClaimStatus): "ok" | "warn" | "risk" {
  switch (status) {
    case "approved":
      return "ok";
    case "forbidden":
      return "risk";
    default:
      return "warn";
  }
}

/**
 * Roles that may create/edit/delete firm-brain entries. Mirrors
 * crm_brain_insert_admin / crm_brain_update_admin / crm_brain_delete_admin
 * (lectual's supabase/migrations/0024_firm_brain.sql): owner, admin,
 * senior_admin — exactly the roles for which hasRole(role, "senior_admin")
 * is true. UI affordance only; @/lib/brain re-checks on every write and RLS
 * is the real boundary.
 */
export function canManageBrainEntries(role: Role): boolean {
  return hasRole(role, "senior_admin");
}

/**
 * Roles that may propose a claim. Every role except viewer may propose
 * (always at status='proposed' — see crm_claim_insert_propose in
 * 0024_firm_brain.sql). UI affordance only; proposeClaim re-checks.
 */
export function canProposeClaims(role: Role): boolean {
  return role !== "viewer";
}

/**
 * Roles that may review a proposed claim (approve or mark forbidden).
 * Mirrors crm_claim_update_review: owner, admin, senior_admin, attorney only
 * — deliberately narrower than "everyone who outranks attorney" in the
 * privilege list, so this is an explicit set rather than hasRole(). UI
 * affordance only; reviewClaim re-checks and RLS is the real boundary.
 */
const CLAIM_REVIEWER_ROLES: readonly Role[] = ["owner", "admin", "senior_admin", "attorney"];

export function canReviewClaims(role: Role): boolean {
  return CLAIM_REVIEWER_ROLES.includes(role);
}

/**
 * Roles that may delete a claim outright. Mirrors crm_claim_delete_admin:
 * owner, admin, senior_admin — same set as canManageBrainEntries.
 */
export function canDeleteClaims(role: Role): boolean {
  return hasRole(role, "senior_admin");
}
