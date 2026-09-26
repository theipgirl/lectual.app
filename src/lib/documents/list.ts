/**
 * The Documents page's reading of crm_document_draft (lectual 0045): the
 * letters Document Center generated, each tied to a matter and a queue item.
 * Pure helpers only; the page reads through the scoped client.
 */

export const DOC_TYPE_LABEL: Record<string, string> = {
  opinion_letter: "Opinion letter",
  trademark_clearance: "Preliminary trademark clearance",
  loe_trademark_current: "Engagement letter (trademark)",
  loe_trademark_legacy: "Engagement letter (trademark, legacy)",
  loe_general: "Engagement letter",
};

export const DOC_KIND: Record<string, string> = {
  opinion_letter: "OPN",
  trademark_clearance: "CLR",
  loe_trademark_current: "LOE",
  loe_trademark_legacy: "LOE",
  loe_general: "LOE",
};

export type DocStatusView = { label: string; tone: string };

/** queued = drafted and waiting in the approval queue; generated = approved and filed; failed = the file couldn't be made. */
export function docStatus(status: string): DocStatusView {
  if (status === "queued") return { label: "Waiting on approval", tone: "lx-pill-warn" };
  if (status === "generated") return { label: "Approved · filed", tone: "lx-pill-ok" };
  if (status === "failed") return { label: "Couldn't generate", tone: "lx-pill-risk" };
  return { label: status, tone: "lx-pill-mute" };
}

export const DOC_FILTERS = [
  { key: "all", label: "Everything" },
  { key: "queued", label: "Waiting on approval" },
  { key: "generated", label: "Approved" },
  { key: "failed", label: "Failed" },
] as const;
export type DocFilter = (typeof DOC_FILTERS)[number]["key"];

export function isDocFilter(v: unknown): v is DocFilter {
  return DOC_FILTERS.some((f) => f.key === v);
}
