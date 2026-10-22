/** How long a navigation must run before the top bar appears, so a fast one never flashes it. */
export const PROGRESS_DELAY_MS = 150;
/** The bar is dropped after this long even if the URL never changed (a failed navigation). */
export const PROGRESS_GIVE_UP_MS = 20_000;

export type ClickInfo = {
  href: string | null;
  target: string | null;
  download: boolean;
  button: number;
  modified: boolean;
  defaultPrevented: boolean;
};

/**
 * Does this click start a client navigation to a different dashboard page?
 * New-tab clicks, downloads, other origins, hash-only moves and the page the
 * person is already on do not.
 */
export function startsNavigation(click: ClickInfo, current: URL): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.modified || click.download) return false;
  if (click.target && click.target !== "_self") return false;
  if (!click.href) return false;
  let next: URL;
  try {
    next = new URL(click.href, current);
  } catch {
    return false;
  }
  if (next.origin !== current.origin) return false;
  if (!next.pathname.startsWith("/dashboard")) return false;
  return next.pathname !== current.pathname || next.search !== current.search;
}
