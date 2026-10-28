/**
 * Why a letter failed, in words for a person. `crm_document_draft.error_message` is free text from
 * the file-making step (it can name internal paths or services), so it is NEVER shown: the stored
 * text is only matched against a few keywords to pick one of these fixed sentences.
 */
export const FAILURE_REASONS = {
  template: "The firm's template couldn't be read.",
  save: "The file couldn't be saved.",
  generate: "The letter couldn't be generated. Try again.",
  unknown: "This letter failed. Lectual has been told and is looking into it.",
} as const;

export function failureReason(errorMessage: string | null | undefined): string {
  const m = (errorMessage ?? "").toLowerCase();
  if (!m.trim()) return FAILURE_REASONS.unknown;
  if (/template|letterhead|placeholder/.test(m)) return FAILURE_REASONS.template;
  if (/storage|upload|bucket|already exists|duplicate|permission|policy/.test(m)) return FAILURE_REASONS.save;
  if (/docx|render|generat|zip|xml|font/.test(m)) return FAILURE_REASONS.generate;
  return FAILURE_REASONS.unknown;
}

/** The Documents list reads at most this many rows. */
export const DOCUMENT_LIST_LIMIT = 300;

/** Said only when the read hit the limit, so a person knows older letters exist. */
export function listCutNotice(count: number): string | null {
  return count >= DOCUMENT_LIST_LIMIT ? `Showing the newest ${DOCUMENT_LIST_LIMIT} documents. Older ones aren't listed here.` : null;
}
