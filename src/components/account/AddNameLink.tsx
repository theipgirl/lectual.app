"use client";

import { useRef } from "react";
import { requestNameDialog } from "@/lib/account/name";

/** Today's quiet "Add your name" control. It opens the same dialog as the account menu. */
export function AddNameLink() {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <button type="button" ref={button} className="lx-note" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline" }} onClick={() => requestNameDialog(window, button.current)}>
      Add your name
    </button>
  );
}
