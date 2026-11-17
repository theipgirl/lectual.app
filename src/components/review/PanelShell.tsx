"use client";

import type { ReactNode } from "react";
import { SidePanel } from "@/components/ui/Dialog";
import "./review.css";

/**
 * The drawer around the detail panel: the shared side panel (a right-side drawer from 900px, a full-screen sheet below). The page is
 * server rendered from `?open=`, so it closes by URL: the close button and the backdrop are links (Back and Esc do the same thing),
 * focus moves in, Tab wraps and focus returns to where it was.
 */
export function PanelShell({ closeHref, titleId, title, children }: { closeHref: string; titleId: string; title: ReactNode; children: ReactNode }) {
  return (
    <SidePanel closeHref={closeHref} titleId={titleId} title={title} className="rv-panel">
      {children}
    </SidePanel>
  );
}
