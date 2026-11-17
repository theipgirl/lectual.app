/**
 * The links M5 builds (pure). Ids are only ever ones that passed `isLeadId`; nothing else from a URL goes into a link.
 */
import { isLeadId } from "./merge";

const enc = encodeURIComponent;

/** The merge screen for two leads, optionally with the keeper chosen. */
export function mergeHref(a: string, b: string, keep?: string | null): string {
  const q = `a=${enc(a)}&b=${enc(b)}${keep ? `&keep=${enc(keep)}` : ""}`;
  return `/dashboard/intake/merge/?${q}`;
}

/** Where a successful merge lands: the kept lead, with the quiet "Merged" line. */
export function mergedRedirect(keeperId: string): string {
  return `/dashboard/leads/${enc(keeperId)}/?merged=1`;
}

/** Where a merged lead's old link goes: the keeper, saying which lead was merged into it. */
export function mergedFromRedirect(keeperId: string, loserId: string): string {
  return `/dashboard/leads/${enc(keeperId)}/?from=${enc(loserId)}`;
}

/**
 * The quiet line on a lead page: "merged" right after a merge, "from" when a merged lead's link was followed. A
 * `from` id is shown only when it really is one of the leads merged into this one (`mergedIds`), so the line can't
 * be made up from the URL.
 */
export function mergeNotice(params: { merged?: unknown; from?: unknown }, mergedIds: readonly string[]): "merged" | "from" | null {
  if (params.merged === "1" && mergedIds.length > 0) return "merged";
  if (isLeadId(params.from) && mergedIds.includes(params.from)) return "from";
  return null;
}
