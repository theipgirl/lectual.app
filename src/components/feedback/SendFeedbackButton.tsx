"use client";

import { useRef } from "react";
import { requestFeedback } from "@/lib/feedback/open";

/** A "Send feedback" button that opens the dashboard's one feedback dialog. */
export function SendFeedbackButton({ className = "lx-btn lx-btn-sec lx-btn-sm" }: { className?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <button type="button" ref={button} className={className} onClick={() => requestFeedback(window, button.current)}>
      Send feedback
    </button>
  );
}
