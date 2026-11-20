"use client";

import { useFormStatus } from "react-dom";
import { ADD_TO_TIMELINE, SAVING } from "@/lib/ui/words";

/**
 * The Cards deck's "Add to timeline" button. Disabled while its form is posting, so a second click can't file the note twice;
 * after a successful post React resets the (uncontrolled) form, so the box is empty and `required` refuses an empty resend.
 * The form itself stays a plain server-action form, so it works without JavaScript.
 */
export function DeckNoteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending} aria-disabled={pending}>
      {pending ? SAVING : ADD_TO_TIMELINE}
    </button>
  );
}
