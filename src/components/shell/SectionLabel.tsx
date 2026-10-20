"use client";

import { usePathname } from "next/navigation";
import { sectionLabelFor } from "@/lib/section-label";

/** The mono section name beside the wordmark, read off the current route. */
export function SectionLabel() {
  return <div className="lx-section">{sectionLabelFor(usePathname())}</div>;
}
