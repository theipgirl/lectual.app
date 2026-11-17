import { openToken, parseOpenParam, type OpenRef } from "@/lib/review/open";

/**
 * `?open=<lead|matter>:<uuid>` on the Intake and Matters pages opens one record as a card. PURE. The grammar is the Weekly
 * review's (`parseOpenParam` / `openToken`), imported, not copied: anything that is not exactly a kind, a colon and a
 * uuid is no card. The helpers below only build addresses: every other query key (view, set, filters, `show`, the
 * Matters `group`, repeated keys too) is kept as it was, so Back and the close link land on the same view. The page
 * passes its OWN path; nothing here names a list path, so no link to a list loses its group.
 */
export type CardRef = OpenRef;

export const OPEN_PARAM = "open";

export function parseCardOpen(raw: string | string[] | null | undefined): CardRef | null {
  return parseOpenParam(raw);
}

export { openToken };

/** A page's searchParams as Next hands them over, or a URLSearchParams. */
export type CurrentParams = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

function copyParams(current: CurrentParams): URLSearchParams {
  if (current instanceof URLSearchParams) return new URLSearchParams(current);
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value === undefined) continue;
    if (typeof value === "string") out.append(key, value);
    else for (const v of value) out.append(key, v);
  }
  return out;
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** The current address with the card for `ref` open (any earlier `open` replaced). */
export function openHref(path: string, current: CurrentParams, ref: CardRef): string {
  const params = copyParams(current);
  params.delete(OPEN_PARAM);
  params.append(OPEN_PARAM, openToken(ref));
  return withQuery(path, params);
}

/** The current address with the card closed: only `open` goes, everything else stays. */
export function closeHref(path: string, current: CurrentParams): string {
  const params = copyParams(current);
  params.delete(OPEN_PARAM);
  return withQuery(path, params);
}

/**
 * The opened-card address built from a page's CURRENT address (`/dashboard/intake/?view=table&q=ana`), for a client component that
 * changes its filters without a navigation. The server-built `card.openHref` is from the address the page LOADED with, so after
 * a filter, a search or a page change it would send the person back to the old view. Every other key is kept.
 */
export function openHrefFromHref(path: string, currentHref: string, ref: CardRef): string {
  const q = currentHref.indexOf("?");
  return openHref(path, new URLSearchParams(q >= 0 ? currentHref.slice(q + 1) : ""), ref);
}
