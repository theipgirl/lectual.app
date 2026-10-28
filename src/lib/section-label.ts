import { NAV, REPORTS, isReportKey } from "@/lib/nav";

/** Shown for a path no built section owns: neutral, never "Today". */
export const FALLBACK_SECTION_LABEL = "Workspace";

/**
 * The mono section name beside the wordmark, read off the current route.
 * Sections that own extra prefixes (a lead's page belongs to Intake) are found
 * through `NAV[].also`; unbuilt sections and unknown paths get the neutral label.
 */
export function sectionLabelFor(pathname: string | null | undefined): string {
  // usePathname() has no query string, but a link copied from the address bar might.
  const bare = pathname?.split(/[?#]/)[0];
  const path = !bare ? "/dashboard/" : bare.endsWith("/") ? bare : `${bare}/`;
  if (!path.startsWith("/dashboard/")) return FALLBACK_SECTION_LABEL;

  const slug = path.slice("/dashboard/".length).split("/")[0];
  if (slug === "") return "Today";
  // Reached from the bell, not the rail, so NAV does not know it.
  if (slug === "notifications") return "Notifications";
  if (slug === "reports") {
    const key = path.slice("/dashboard/reports/".length).split("/")[0];
    return isReportKey(key) ? `${REPORTS[key].label} · Report` : "Report";
  }

  const built = NAV.filter((item) => item.slug !== "" && item.built !== false);
  const item = built.find((n) => n.slug === slug) ?? built.find((n) => (n.also ?? []).some((prefix) => path.startsWith(prefix)));
  return item?.label ?? FALLBACK_SECTION_LABEL;
}

/** List roots whose page title (h1) already says the section name, so the label beside the wordmark would only repeat it. */
const TITLE_SAYS_IT = new Set(["", "reports", "calendar", "meetings", "pipeline", "notifications", "intake", "matters", "queue", "documents", "proposals", "mail", "forms"]);

/**
 * Whether the section label shows. Not on the root page of a section whose h1
 * is the same word; it still shows on deeper pages (a lead, a matter, a
 * proposal) and on reports, where it says where you are. `sectionLabelFor`
 * is unchanged.
 */
export function showSectionLabel(pathname: string | null | undefined): boolean {
  const bare = pathname?.split(/[?#]/)[0];
  const path = !bare ? "/dashboard/" : bare.endsWith("/") ? bare : `${bare}/`;
  if (!path.startsWith("/dashboard/")) return true;
  const [slug, ...rest] = path.slice("/dashboard/".length).split("/").filter(Boolean);
  if (slug === undefined) return false;
  return !(TITLE_SAYS_IT.has(slug) && rest.length === 0);
}
