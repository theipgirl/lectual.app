"use client";

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CustomKind } from "@/lib/review/sheet-columns";
import { SHEET_ENTER_ESC } from "@/lib/ui/words";
import { usePopPlacement } from "./pop-placement";
import "./review-sheet-edit.css";

/**
 * The one input a firm's text, money or date column is typed in, on the owner Sheet (inside `CustomValuePop`) and on the opened card.
 * It holds what is typed and nothing else: no form, no action, no save. The caller decides "unchanged" and posts.
 *   text   a plain text input;
 *   money  the same, with a "$" in front and the decimal keypad;
 *   date   the browser's date input.
 * `hint` is the visible inherited line ("From the lead: ..."), a line and not only a placeholder (a date input has none).
 */
export function CustomValueField({
  id,
  kind,
  label,
  value,
  onChange,
  onKeyDown,
  hint,
  autoFocus = false,
  showKeys = true,
  name,
  inputClassName = "rse-in",
}: {
  id: string;
  kind: Extract<CustomKind, "text" | "money" | "date">;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  hint?: string;
  autoFocus?: boolean;
  /** The "Enter to save · Esc to cancel" line. */
  showKeys?: boolean;
  /** The form field's name (the card's form posts it as `value`). */
  name?: string;
  /** The Sheet's `rse-in`; the card passes its own `lx-input`. */
  inputClassName?: string;
}) {
  const input = (
    <input
      id={id}
      name={name}
      className={`${inputClassName}${kind === "date" ? " rse-in-date" : ""}`}
      type={kind === "date" ? "date" : "text"}
      inputMode={kind === "money" ? "decimal" : undefined}
      aria-label={label}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
  return (
    <>
      {kind === "money" ? (
        <span className="rse-money">
          <span className="rse-money-sign" aria-hidden>
            $
          </span>
          {input}
        </span>
      ) : (
        input
      )}
      {hint && <span className="rse-ed-hint">{hint}</span>}
      {showKeys && <span className="rse-ed-hint">{SHEET_ENTER_ESC}</span>}
    </>
  );
}

/**
 * The owner Sheet's editor for a text, money or date cell: a small `.rse-pop` dialog with one input. Sprint 1's keys: Enter saves; Tab
 * and Shift+Tab save (when changed) and move to the next or previous drawn editable cell; Esc cancels. An outside click saves nothing
 * (the table closes it).
 */
export function CustomValuePop({
  cellId,
  kind,
  label,
  initial,
  hint,
  onSave,
  onSaveAndMove,
  onCancel,
}: {
  cellId: string;
  kind: Extract<CustomKind, "text" | "money" | "date">;
  label: string;
  initial: string;
  hint?: string;
  onSave: (raw: string) => void;
  onSaveAndMove: (raw: string, dir: 1 | -1) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  usePopPlacement(ref);
  return (
    <div className="rse-pop rse-cv-pop" role="dialog" aria-label={label} ref={ref}>
      <CustomValueField
        id={cellId}
        kind={kind}
        label={label}
        value={value}
        onChange={setValue}
        hint={hint}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (e.key === "Enter") {
            e.preventDefault();
            onSave(value);
          } else if (e.key === "Tab") {
            e.preventDefault();
            onSaveAndMove(value, e.shiftKey ? -1 : 1);
          }
        }}
      />
    </div>
  );
}
