/**
 * Shared Document Center types.
 *
 * `crm_document_draft` (supabase/migrations/0045_document_center.sql) is not
 * yet in the generated `src/lib/db/types.ts` — same situation
 * ACTIVITY_TYPES_0033/0036 solve for crm_activity's enum in
 * src/lib/matters/activity.ts, and the same fix: a hand-written type here,
 * folded into the generated file's next codegen run rather than blocking on
 * one now.
 */

export const DOC_TYPES = [
  "opinion_letter",
  "trademark_clearance",
  "loe_trademark_current",
  "loe_trademark_legacy",
  "loe_general",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOCUMENT_DRAFT_STATUSES = ["queued", "generated", "failed"] as const;
export type DocumentDraftStatus = (typeof DOCUMENT_DRAFT_STATUSES)[number];

export type DocumentDraftRow = {
  id: string;
  org_id: string;
  matter_id: string;
  doc_type: DocType;
  queue_item_id: string | null;
  status: DocumentDraftStatus;
  payload: Record<string, unknown>;
  file_name: string | null;
  storage_path: string | null;
  error_message: string | null;
  generated_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Human label for a doc_type — used in the Document Center list and headlines. */
export const DOC_TYPE_LABEL: Record<DocType, string> = {
  opinion_letter: "Opinion letter",
  trademark_clearance: "Preliminary trademark clearance",
  loe_trademark_current: "Trademark LOE (current)",
  loe_trademark_legacy: "Trademark LOE (legacy)",
  loe_general: "General LOE",
};

/** The lawmatics-mcp queue `type` each doc_type is queued under (see AGENTS.md's
 * approval-queue section). Opinion letters and preliminary trademark-clearance
 * opinions each get their own type (kept distinct — see
 * trademark-clearance.ts's header comment for why they must never be
 * conflated); both trademark LOE variants and the general LOE reuse
 * ENGAGEMENT_LETTER, which already existed in the queue's type vocabulary
 * before this feature. */
export const QUEUE_TYPE_FOR_DOC: Record<DocType, string> = {
  opinion_letter: "OPINION_LETTER",
  trademark_clearance: "TRADEMARK_CLEARANCE",
  loe_trademark_current: "ENGAGEMENT_LETTER",
  loe_trademark_legacy: "ENGAGEMENT_LETTER",
  loe_general: "ENGAGEMENT_LETTER",
};

/** Queue `type` values this feature ever hooks post-approval docx generation for. */
export const DOCUMENT_QUEUE_TYPES = new Set([
  "OPINION_LETTER",
  "TRADEMARK_CLEARANCE",
  "ENGAGEMENT_LETTER",
]);
