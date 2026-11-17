import { OPTIONAL } from "@/lib/ui/words";

/** One form field: a sentence-case label, the control, an optional hint. Required fields carry no mark; optional ones say "(optional)". */
export function Field({ label, hint, optional, children }: { label: string; hint?: React.ReactNode; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="lx-field">
      <span className="lx-label">
        {label}
        {optional ? <span className="lx-optional"> {OPTIONAL}</span> : null}
      </span>
      {children}
      {hint ? <span className="lx-note">{hint}</span> : null}
    </label>
  );
}
