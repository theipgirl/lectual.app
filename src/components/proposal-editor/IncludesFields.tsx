"use client";

import type { ProposalInclude } from "@/lib/proposals/types";
import { useRows } from "./rows";

/**
 * The "What your package includes" table as form rows (`inc.<n>.*`), shared by
 * the proposal editor and the firm's standard-pricing settings. Rows are held
 * in client state until the surrounding form is submitted; a row left entirely
 * blank is dropped on save (`parseIncludes`).
 */
export function IncludesFields({ initial, editable }: { initial: ProposalInclude[]; editable: boolean }) {
  const list = useRows<ProposalInclude>(initial);
  return (
    <div className="pe-rows">
      <div className="pe-inc-head" aria-hidden="true">
        <span>Item</span>
        <span>Worth</span>
        <span>In this package</span>
        <span>Note</span>
        <span>Highlight</span>
        <span />
      </div>
      {list.rows.map((row, i) => (
        <div key={row.key} className="pe-inc-row">
          <input className="lx-input" name={`inc.${i}.label`} defaultValue={row.label} aria-label="Item" maxLength={300} />
          <input className="lx-input" name={`inc.${i}.value`} defaultValue={row.value ?? ""} aria-label="Worth" placeholder="$450 each" maxLength={120} />
          <input className="lx-input" name={`inc.${i}.included`} defaultValue={row.included} aria-label="In this package" placeholder="✓ or Unlimited" maxLength={120} />
          <input className="lx-input" name={`inc.${i}.note`} defaultValue={row.note ?? ""} aria-label="Note" maxLength={300} />
          <label className="pe-check" title="Draws attention to this row">
            <input type="checkbox" name={`inc.${i}.highlight`} defaultChecked={row.highlight === true} />
            <span className="pe-sr">Highlight</span>
          </label>
          {editable ? (
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => list.remove(row.key)} aria-label={`Remove ${row.label || "this row"}`}>
              Remove
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {editable && (
        <div>
          <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => list.add({ label: "", included: "✓" })}>
            + Add row
          </button>
        </div>
      )}
    </div>
  );
}
