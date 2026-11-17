import Link from "next/link";
import { compareRows, type CompareData } from "@/lib/intake/compare";
import {
  LEADS_COMPARE_CLOSE,
  LEADS_COMPARE_FAILED,
  LEADS_COMPARE_GONE,
  LEADS_COMPARE_LOADING,
  LEADS_COMPARE_NOTE,
  LEADS_COMPARE_OPEN_LEAD,
  LEADS_COMPARE_TITLE,
} from "@/lib/ui/words";

export type CompareState = { status: "loading" } | { status: "failed"; error: string } | { status: "ok"; data: CompareData };

/**
 * The compare panel's contents: a dialog with the two leads side by side and a link to each. Presentational (no hooks), so it is
 * tested and drawn in the design harness as markup. The behaviour (focus, Esc, Tab) is `CompareDialog`'s. It has NO merge action.
 */
export default function CompareView({
  state,
  titleId,
  closeRef,
  onClose,
}: {
  state: CompareState;
  titleId: string;
  closeRef?: React.Ref<HTMLButtonElement>;
  onClose?: () => void;
}) {
  const data = state.status === "ok" ? state.data : null;
  const both = data && data.a.status === "ok" && data.b.status === "ok" ? { a: data.a, b: data.b } : null;
  return (
    <div className="ix-cmp-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} data-compare-dialog>
      <div className="ix-cmp-head">
        <h2 id={titleId} className="ix-cmp-title">
          {LEADS_COMPARE_TITLE}
        </h2>
        <button type="button" className="ix-cmp-close" ref={closeRef} onClick={onClose}>
          {LEADS_COMPARE_CLOSE}
        </button>
      </div>
      <p className="ix-cmp-note">{LEADS_COMPARE_NOTE}</p>
      {state.status === "loading" && (
        <p role="status" className="ix-cmp-msg">
          {LEADS_COMPARE_LOADING}
        </p>
      )}
      {state.status === "failed" && (
        <p role="alert" className="ix-cmp-msg">
          {state.error || LEADS_COMPARE_FAILED}
        </p>
      )}
      {data && !both && (
        <p role="alert" className="ix-cmp-msg">
          {LEADS_COMPARE_GONE}
        </p>
      )}
      {both && (
        <>
          <table className="ix-cmp-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="lx-sr">Field</span>
                </th>
                <th scope="col">{both.a.name}</th>
                <th scope="col">{both.b.name}</th>
              </tr>
            </thead>
            <tbody>
              {compareRows(both.a, both.b).map((row) => (
                <tr key={row.key} data-same={row.same ? "" : undefined}>
                  <th scope="row">{row.label}</th>
                  <td data-failed={row.failed ? "" : undefined}>{row.a}</td>
                  <td data-failed={row.failed ? "" : undefined}>{row.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ix-cmp-links">
            <Link href={`/dashboard/leads/${both.a.id}/`} className="ix-cmp-link">
              {LEADS_COMPARE_OPEN_LEAD(both.a.name)}
            </Link>
            <Link href={`/dashboard/leads/${both.b.id}/`} className="ix-cmp-link">
              {LEADS_COMPARE_OPEN_LEAD(both.b.name)}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
