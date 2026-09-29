"use client";

import { usePathname } from "next/navigation";
import { NAV, REPORTS, isReportKey } from "@/lib/nav";

/** The mono section name beside the wordmark, read off the current route. */
export function SectionLabel() {
  const pathname = usePathname() ?? "/dashboard/";
  const slug = pathname.replace(/^\/dashboard\/?/, "").split("/")[0] ?? "";
  if (slug === "reports") {
    const key = pathname.replace(/^\/dashboard\/reports\/?/, "").split("/")[0];
    return <div className="lx-section">{isReportKey(key) ? `${REPORTS[key].label} · Report` : "Report"}</div>;
  }
  const item = NAV.find((n) => n.slug === slug);
  return <div className="lx-section">{item?.label ?? "Today"}</div>;
}
