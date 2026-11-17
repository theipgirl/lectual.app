import Link from "next/link";
import { compareRows, type CompareData } from "@/lib/intake/compare";
import {
  LEADS_COMPARE_FIELD_SR,
  LEADS_COMPARE_FAILED,
  LEADS_COMPARE_GONE,
  LEADS_COMPARE_LOADING,
  LEADS_COMPARE_NOTE,
  LEADS_COMPARE_OPEN_LEAD,
  LEADS_COMPARE_TITLE,
  MERGE_LEADS_LINK,
  MERGE_LEADS_LINK_TITLE,
} from "@/lib/ui/words";
import { mergeHref } from "@/lib/leads/merge-links";
import { Dialog } from "@/components/ui/Dialog";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui/SheetTable";

export type CompareState = { status: "loading" } | { status: "failed"; error: string } | { status: "ok"; data: CompareData };

const noop = () => {};

/**
 * The compare panel: the shared Dialog with the two leads side by side and a link to each. The Dialog supplies the behaviour (focus
 * in, Esc, Tab wrap, focus back on the marker that opened it). It merges nothing: for an owner or admin it links to the merge screen
 * (M5), where the merge is confirmed.
 */
export default function CompareView({ state, titleId, onClose }: { state: CompareState; titleId: string; onClose?: () => void }) {
  const data = state.status === "ok" ? state.data : null;
  const both = data && data.a.status === "ok" && data.b.status === "ok" ? { a: data.a, b: data.b } : null;
  return (
    <Dialog size="lg" title={LEADS_COMPARE_TITLE} titleId={titleId} onClose={onClose ?? noop}>
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
          <SheetCard>
            <SheetScroll>
              <SheetTable className="ix-cmp-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="lx-sr">{LEADS_COMPARE_FIELD_SR}</span>
                    </th>
                    <th scope="col">{both.a.name}</th>
                    <th scope="col">{both.b.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows(both.a, both.b).map((row) => (
                    <tr key={row.key} data-same={row.same ? "" : undefined}>
                      <th scope="row">{row.label}</th>
                      <td data-label={both.a.name} data-failed={row.failed ? "" : undefined}>
                        {row.a}
                      </td>
                      <td data-label={both.b.name} data-failed={row.failed ? "" : undefined}>
                        {row.b}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </SheetTable>
            </SheetScroll>
          </SheetCard>
          <div className="ix-cmp-links">
            <Link href={`/dashboard/leads/${both.a.id}/`} className="ix-cmp-link">
              {LEADS_COMPARE_OPEN_LEAD(both.a.name)}
            </Link>
            <Link href={`/dashboard/leads/${both.b.id}/`} className="ix-cmp-link">
              {LEADS_COMPARE_OPEN_LEAD(both.b.name)}
            </Link>
            {data?.merge && (
              <Link href={mergeHref(both.a.id, both.b.id)} className="ix-cmp-link" title={MERGE_LEADS_LINK_TITLE}>
                {MERGE_LEADS_LINK}
              </Link>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
