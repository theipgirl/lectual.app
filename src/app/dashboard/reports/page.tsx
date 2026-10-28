import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { REPORTS, REPORT_BLURB, visibleNav, visibleReports } from "@/lib/nav";
import { activeOrgModules } from "@/lib/org/modules";
import { currentRole } from "@/lib/auth/current-role";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Reports") };

export const dynamic = "force-dynamic";

/**
 * The one door to the four reports. Only reports whose sections this firm and
 * role can see are listed; an unreadable role or module list lists none (fails closed).
 */
export default async function ReportsIndexPage() {
  const role = await currentRole();
  if (!role) notFound();
  const keys = visibleReports(visibleNav(await activeOrgModules(), role));
  if (keys.length === 0) notFound();

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="lx-h1">Reports</h1>
          <p className="lx-sub">Numbers for each part of the firm. Pick one to open it.</p>
        </div>
      </div>
      <ul className="lx-list" aria-label="Reports">
        {keys.map((key) => (
          <li key={key}>
            <Link href={REPORTS[key].href} className="lx-card lx-kpi" style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{REPORTS[key].label}</span>
              <span className="lx-note">{REPORT_BLURB[key]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
