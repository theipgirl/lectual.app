import { LoadFailedLine } from "@/components/ui/LoadFailed";
import type { LeadStepView } from "@/lib/lead-step/view-model";
import { LEAD_PAGE_DID_ALL, LEAD_STEP_DID_EMPTY, LEAD_STEP_DID_TITLE, LEAD_STEP_DID_UNDONE } from "@/lib/ui/words";
import { UndoAgentMoveButton } from "./StageKeeperControls";
import "./lead-step.css";

/** How many rows show before "Show all". */
export const DID_SHOWN = 3;

type Did = LeadStepView["did"];
type Row = Extract<Did, { status: "ok" }>["rows"][number];

function DidRow({ leadId, row }: { leadId: string; row: Row }) {
  return (
    <li>
      <time dateTime={row.at}>{row.when}</time>
      <span>
        {row.text}
        {row.undone ? <span className="ls-undone"> · {LEAD_STEP_DID_UNDONE}</span> : null}
        {row.undo ? <UndoAgentMoveButton leadId={leadId} activityId={row.undo.activityId} /> : null}
      </span>
    </li>
  );
}

/**
 * "What Lectual did", newest first. Undo only on a row the engine offered it for (the Stage Keeper's own Undo, through the
 * existing action). A failed read says so and is never "Nothing yet"; a list cut at the read's cap says so.
 */
export function WhatLectualDid({ leadId, did }: { leadId: string; did: Did }) {
  return (
    <section className="ls-did" aria-label={LEAD_STEP_DID_TITLE}>
      <h2 className="lx-label">{LEAD_STEP_DID_TITLE}</h2>
      {did.status === "unavailable" ? (
        <LoadFailedLine refresh={false}>{did.text}</LoadFailedLine>
      ) : did.rows.length === 0 ? (
        <p className="lx-note">{LEAD_STEP_DID_EMPTY}</p>
      ) : (
        <>
          <ul>
            {did.rows.slice(0, DID_SHOWN).map((r) => (
              <DidRow key={r.id} leadId={leadId} row={r} />
            ))}
          </ul>
          {did.rows.length > DID_SHOWN && (
            <details className="ls-more">
              <summary>{LEAD_PAGE_DID_ALL(did.rows.length)}</summary>
              <ul>
                {did.rows.slice(DID_SHOWN).map((r) => (
                  <DidRow key={r.id} leadId={leadId} row={r} />
                ))}
              </ul>
            </details>
          )}
          {did.note && <p className="lx-note">{did.note}</p>}
        </>
      )}
    </section>
  );
}
