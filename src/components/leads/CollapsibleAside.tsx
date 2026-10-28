"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** The widest window that counts as a phone (the 640px rule used across the shell). */
const PHONE_QUERY = "(max-width: 640px)";

/**
 * The lead page's side column as a `<details>` titled "Details and tags". It renders open (the
 * desktop layout shows it all) and closes itself on a phone after load, so the main column is
 * what a phone reads first. The summary is hidden by CSS above 640px.
 */
export function CollapsibleAside({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.matchMedia(PHONE_QUERY).matches && ref.current) ref.current.open = false;
  }, []);
  return (
    <details ref={ref} className="lx-aside-details" open>
      <summary>Details and tags</summary>
      <div className="lx-aside-body">{children}</div>
    </details>
  );
}
