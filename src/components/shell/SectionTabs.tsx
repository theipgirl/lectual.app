import Link from "next/link";
import { SUMMARY_TAB } from "@/lib/ui/words";

/**
 * "<List> | Summary" for a section: the list is the working page, named for what it lists
 * ("Leads", "Matters"), and the Summary is the section's numbers (/dashboard/reports/<key>/).
 * Plain links, so it works on server and client pages and needs no state.
 */
export function SectionTabs({
  active,
  listLabel,
  listHref,
  summaryHref,
}: {
  active: "list" | "summary";
  listLabel: string;
  listHref: string;
  summaryHref: string;
}) {
  return (
    <nav className="lx-segs lx-section-tabs" aria-label="Views of this section">
      <Link href={listHref} prefetch={false} aria-current={active === "list" ? "page" : undefined} className={active === "list" ? "on" : undefined}>
        {listLabel}
      </Link>
      <Link href={summaryHref} prefetch={false} aria-current={active === "summary" ? "page" : undefined} className={active === "summary" ? "on" : undefined}>
        {SUMMARY_TAB}
      </Link>
    </nav>
  );
}
