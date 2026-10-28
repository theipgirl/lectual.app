"use client";

import { usePathname } from "next/navigation";
import { sectionLabelFor, showSectionLabel } from "@/lib/section-label";

/** The mono section name beside the wordmark, read off the current route. Hidden where the page's own title says the same. */
export function SectionLabel() {
  const pathname = usePathname();
  if (!showSectionLabel(pathname)) return null;
  return (
    <>
      <div className="lx-vr" />
      <div className="lx-section">{sectionLabelFor(pathname)}</div>
    </>
  );
}
