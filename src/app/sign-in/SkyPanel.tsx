"use client";

import { useEffect, useRef } from "react";
import { SIGN_IN_PANEL_LINES } from "@/lib/ui/words";

/**
 * The decorative sky beside the sign-in form: Lectual's own time-lapse frames and four product lines that cross-fade one at
 * a time. It adds nothing a person needs to sign in, so the whole panel is aria-hidden and holds no link, control or name.
 * Motion is CSS only and starts once this script has run (data-anim="on"), so without JavaScript, and under reduced motion,
 * the panel is one still frame with the first line.
 */
export default function SkyPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.setAttribute("data-anim", "on");
  }, []);
  return (
    <div ref={ref} className="lx-si-panel" aria-hidden="true">
      <div className="lx-si-skies">
        <div className="lx-si-sky lx-si-sky-1" />
        <div className="lx-si-sky lx-si-sky-2" />
        <div className="lx-si-sky lx-si-sky-3" />
      </div>
      <div className="lx-si-scrim" />
      <div className="lx-si-words">
        <span className="lx-si-cap">Lectual</span>
        <div className="lx-si-stack">
          {SIGN_IN_PANEL_LINES.map((line) => (
            <p key={line} className="lx-si-line">
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
