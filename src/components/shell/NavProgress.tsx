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
  const [active, setActive] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
      showTimer.current = null;
      giveUpTimer.current = null;
    };
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
      clear();
      showTimer.current = setTimeout(() => setActive(true), PROGRESS_DELAY_MS);
      giveUpTimer.current = setTimeout(() => setActive(false), PROGRESS_GIVE_UP_MS);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      clear();
    };
  }, []);

  // The URL changed: the navigation landed.
  useEffect(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    showTimer.current = null;
    giveUpTimer.current = null;
    setActive(false);
  }, [pathname, search]);

  if (!active) return null;
  return <div className="lx-navbar" role="progressbar" aria-label="Loading the next page" aria-busy="true" />;
}
