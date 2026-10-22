/** The product name every tab title ends with. */
export const TITLE_SUFFIX = "Lectual";

const MAX_NAME = 80;

/**
 * The one builder for a dashboard tab title: "<Page> · Lectual". An empty or
 * blank name falls back to "Lectual" alone. Long record names are clipped so a
 * tab never carries a whole business name plus a mark.
 */
export function pageTitle(name?: string | null): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return TITLE_SUFFIX;
  const clipped = clean.length > MAX_NAME ? `${clean.slice(0, MAX_NAME - 1).trimEnd()}…` : clean;
  return `${clipped} · ${TITLE_SUFFIX}`;
}

/**
 * A record page's title: the record's display name, or the plain fallback
 * ("Lead", "Matter") when the read failed or found nothing. A failed or foreign
 * read must give the same tab as a missing one, so nothing leaks.
 */
export async function recordPageTitle(
  read: () => Promise<string | null | undefined>,
  fallback: string,
): Promise<string> {
  try {
    return pageTitle((await read()) || fallback);
  } catch {
    return pageTitle(fallback);
  }
}
