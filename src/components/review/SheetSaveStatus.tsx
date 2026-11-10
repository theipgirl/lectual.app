"use client";

import { useSyncExternalStore } from "react";
import { FIELD_WORDS } from "@/lib/review/sheet-edit";
import { SHEET_PUT_BACK, sheetSaved, sheetSaving } from "@/lib/ui/words";
import { sheetStatusStore } from "./sheet-status-store";
import "./review-sheet-edit.css";

/**
 * The header's save line for the owner's editable Sheet. Both live regions are always in the page (so a change is read
 * out); "Saved" is said only after the server answered ok, and a refusal is an alert with the action's own sentence.
 */
export function SheetSaveStatus() {
  const status = useSyncExternalStore(sheetStatusStore.subscribe, sheetStatusStore.get, sheetStatusStore.get);
  const field = status ? FIELD_WORDS[status.field] : "";
  return (
    <span className="rse-status-wrap">
      <span role="status" aria-live="polite" className={status && status.tone !== "error" ? `rse-saved rse-saved--${status.tone}` : "rse-saved rse-saved--empty"}>
        {status && status.tone === "saved" && (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="rse-saved-tick">
              <path d="M5 12l5 5 9-10" />
            </svg>
            {sheetSaved(status.client, field)}
          </>
        )}
        {status && status.tone === "saving" && sheetSaving(status.client, field)}
      </span>
      <span role="alert" className={status?.tone === "error" ? "rse-failed" : "rse-failed rse-saved--empty"}>
        {status?.tone === "error" && `${status.message ?? ""}${status.field === "note" ? "" : ` ${SHEET_PUT_BACK}`}`}
      </span>
    </span>
  );
}
