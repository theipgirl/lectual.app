import { evidenceLines, lastTouchLine, mailboxLine, rowNotesLine } from "@/lib/reconcile/describe";
import type { EvidenceItem, MailboxSearchState, ReconcileRow } from "@/lib/reconcile/types";

/**
 * What a person's proposal rests on: each piece of evidence with its source and date, the proposed
 * last touch, and the state of the two reads that can fail (Lawmatics notes, the mailbox search).
 * A read that failed says so in the warn tone; it never reads as "nothing found".
 */
export function EvidenceBlock({
  evidence,
  lastTouch,
  mailbox,
  notes,
}: {
  evidence: readonly EvidenceItem[] | undefined;
  lastTouch: string | null | undefined;
  mailbox: MailboxSearchState | undefined;
  notes?: ReconcileRow["notes"];
}) {
  const lines = evidenceLines(evidence);
  const mail = mailboxLine(mailbox);
  const noteState = rowNotesLine(notes);
  const mailBad = mailbox?.status === "unavailable" && mailbox.code !== "no-address";
  const notesBad = notes?.status === "unavailable";
  return (
    <div className="rc-cell" data-evidence>
      {lines.length > 0 ? (
        <ul className="rc-evidence" aria-label="Evidence">
          {lines.map((l, i) => (
            <li key={i}>
              {l.text}
              {l.snippet ? (
                <>
                  {" "}
                  <q>{l.snippet}</q>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <small>No dated evidence.</small>
      )}
      <div className="rc-touch" data-last-touch>
        {lastTouchLine(lastTouch)}
      </div>
      {noteState ? <small className={notesBad ? "rc-warn" : undefined}>{noteState}</small> : null}
      {mail ? <small className={mailBad ? "rc-warn" : undefined}>{mail}</small> : null}
    </div>
  );
}
