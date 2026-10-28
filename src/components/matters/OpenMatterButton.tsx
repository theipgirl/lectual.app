"use client";

import { useEffect } from "react";

/** The id of the closed panel that holds the existing "Open a matter" form. */
export const OPEN_MATTER_PANEL_ID = "open-matter";

function openPanel(focus: boolean) {
  const panel = document.getElementById(OPEN_MATTER_PANEL_ID) as HTMLDetailsElement | null;
  if (!panel) return;
  panel.open = true;
  panel.scrollIntoView({ block: "nearest" });
  if (focus) panel.querySelector<HTMLElement>("input, select, textarea")?.focus();
}

/** The header button: opens the existing form panel (and a link to #open-matter opens it on load). */
export function OpenMatterButton() {
  useEffect(() => {
    if (window.location.hash === `#${OPEN_MATTER_PANEL_ID}`) openPanel(false);
  }, []);
  return (
    <button type="button" className="lx-btn lx-btn-pri lx-btn-sm" aria-controls={OPEN_MATTER_PANEL_ID} onClick={() => openPanel(true)}>
      Open a matter
    </button>
  );
}
