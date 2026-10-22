"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PROGRESS_DELAY_MS, PROGRESS_GIVE_UP_MS, startsNavigation } from "@/lib/ui/nav-progress";

/**
 * A thin bar under the top header while a dashboard link is loading. It shows
 * only after PROGRESS_DELAY_MS, so a navigation that finishes quickly never
 * flashes it, and it is dropped as soon as the URL changes. No dependency: it
 * watches link clicks and the pathname/search params.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = `${pathname}?${search}`;
  // The page the person was on when the bar was switched on. The bar shows only while that is still the
  // current page, so a landed navigation hides it without any state being set from an effect.
  const [shownFor, setShownFor] = useState<string | null>(null);
  const hereRef = useRef(here);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hereRef.current = here;
    // The URL changed: any pending timers belong to the navigation that just landed.
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
      showTimer.current = null;
      giveUpTimer.current = null;
    };
  }, [here]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const go = startsNavigation(
        {
          href: anchor.getAttribute("href"),
          target: anchor.getAttribute("target"),
          download: anchor.hasAttribute("download"),
          button: e.button,
          modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
          defaultPrevented: e.defaultPrevented,
        },
        new URL(window.location.href),
      );
      if (!go) return;
      if (showTimer.current) clearTimeout(showTimer.current);
      if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
      const from = hereRef.current;
      showTimer.current = setTimeout(() => setShownFor(from), PROGRESS_DELAY_MS);
      giveUpTimer.current = setTimeout(() => setShownFor(null), PROGRESS_GIVE_UP_MS);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (shownFor !== here) return null;
  return <div className="lx-navbar" role="progressbar" aria-label="Loading the next page" aria-busy="true" />;
}
