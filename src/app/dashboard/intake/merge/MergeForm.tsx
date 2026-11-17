"use client";

import { useActionState, useRef } from "react";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { choiceName, type MergeField, type MergeSide } from "@/lib/leads/merge";
import {
  MERGE_BUTTON,
  MERGE_CONFIRM,
  MERGE_CONFIRM_LABEL,
  MERGE_EMPTY_VALUE,
  MERGE_FIELD_LABELS,
  MERGE_FIELDS_HEADING,
  MERGE_FIELDS_NOTE,
  MERGE_FIELDS_SAME,
  MERGE_INTO_KEEPER,
  MERGE_KEEPING,
  MERGE_PENDING,
} from "@/lib/ui/words";
import { mergeLeadsAction, type MergeActionState } from "./actions";

export type MergeFormRow = { field: MergeField; keeper: string | null; loser: string | null; same: boolean; choice: MergeSide };

/**
 * The field choices and the one Merge button. Only the rows where the two leads differ get a choice; the rest
 * are left to the database's own rule. Nothing is posted until Confirm (InlineConfirm). A refusal is drawn as
 * the action's fixed sentence.
 */
export function MergeForm({
  keeperId,
  loserId,
  keeperName,
  loserName,
  rows,
}: {
  keeperId: string;
  loserId: string;
  keeperName: string;
  loserName: string;
  rows: MergeFormRow[];
}) {
  const [state, action, pending] = useActionState<MergeActionState, FormData>(mergeLeadsAction, {});
  const formRef = useRef<HTMLFormElement | null>(null);
  const differing = rows.filter((r) => !r.same);
  const shown = (v: string | null) => (v && v.trim() ? v : MERGE_EMPTY_VALUE);
  return (
    <form ref={formRef} action={action} className="mg-form">
      <input type="hidden" name="keeper" value={keeperId} />
      <input type="hidden" name="loser" value={loserId} />
      <section className="lx-card mg-card" aria-labelledby="mg-fields">
        <h2 id="mg-fields" className="lx-h2">
          {MERGE_FIELDS_HEADING}
        </h2>
        <p className="lx-note">{MERGE_FIELDS_NOTE}</p>
        {differing.length === 0 ? (
          <p className="lx-note">{MERGE_FIELDS_SAME}</p>
        ) : (
          <table className="ix-cmp-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="lx-sr">{MERGE_FIELDS_HEADING}</span>
                </th>
                <th scope="col">
                  {MERGE_KEEPING}: {keeperName}
                </th>
                <th scope="col">
                  {MERGE_INTO_KEEPER}: {loserName}
                </th>
              </tr>
            </thead>
            <tbody>
              {differing.map((r) => (
                <tr key={r.field}>
                  <th scope="row">{MERGE_FIELD_LABELS[r.field]}</th>
                  {(["keeper", "loser"] as const).map((side) => (
                    <td key={side}>
                      <label className="mg-choice">
                        <input type="radio" name={choiceName(r.field)} value={side} defaultChecked={r.choice === side} />
                        <span>{shown(side === "keeper" ? r.keeper : r.loser)}</span>
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {state.error && (
        <p role="alert" className="lx-note">
          {state.error}
        </p>
      )}
      <div className="mg-actions">
        <InlineConfirm
          label={pending ? MERGE_PENDING : MERGE_BUTTON}
          question={MERGE_CONFIRM(loserName, keeperName)}
          confirmLabel={MERGE_CONFIRM_LABEL}
          pending={pending}
          className="lx-btn lx-btn-pri"
          onConfirm={() => formRef.current?.requestSubmit()}
        />
      </div>
    </form>
  );
}
