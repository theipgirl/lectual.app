"use client";

import { useState } from "react";
import { expiryWarning } from "@/lib/proposal-editor/expiry-warning";
import { firmCivilDate } from "@/lib/quotes/firm-time";

/**
 * Step 3's Expiry date, beside the Pay link. It posts `expiresOn` to whichever form it sits in
 * (the package form in the editor, the one builder form on New proposal). Warns, in plain words,
 * when the date is today or earlier.
 */
export function ExpiryField({ defaultValue, today, disabled }: { defaultValue: string; today?: string; disabled?: boolean }) {
  const [value, setValue] = useState(defaultValue);
  const warning = expiryWarning(value, today ?? firmCivilDate(new Date()));
  return (
    <label className="lx-field">
      <span className="lx-label">Expiry date</span>
      <input
        className="lx-input"
        name="expiresOn"
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        aria-describedby={warning ? "pe-expiry-warning" : undefined}
      />
      {warning && (
        <span id="pe-expiry-warning" className="lx-note" role="status">
          {warning}
        </span>
      )}
    </label>
  );
}
