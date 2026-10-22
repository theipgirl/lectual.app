import { notesSummaryLine } from "@/lib/reconcile/describe";
import { CONFIDENCE_LABEL, type Confidence, type ReconcileSummary } from "@/lib/reconcile/types";

const ORDER: Confidence[] = ["agree", "sheet_only", "single_source", "conflict", "no_evidence"];

function lawmaticsLine(s: ReconcileSummary["lawmatics"]): string {
  if (s.status === "ok") return `Lawmatics: read (${s.records} records, ${s.matched} matched)`;
  if (s.status === "not-connected") return `Lawmatics: not connected. ${s.reason}`;
  return `Lawmatics: unavailable. ${s.reason}`;
}

function emailLine(s: ReconcileSummary["email"]): string {
  if (s.status === "ok") return `Email / calendar: read (${s.leadsWithMail} leads with synced mail)`;
  return `Email / calendar: unavailable. ${s.reason}`;
}

/** The counts under the table's heading: confidence, source availability, and what was left out. */
export function SummaryStrip({ summary }: { summary: ReconcileSummary }) {
  const { sheet } = summary;
  return (
    <section className="lx-card rc-strip" aria-label="Summary">
      <span>
        <b>{summary.fileName}</b>
        {`: ${sheet.rowsRead} rows read, ${sheet.intakeRows} intake leads, ${sheet.blankRows} blank`}
      </span>
      {ORDER.map((c) => (
        <span key={c} data-count={c}>
          {`${CONFIDENCE_LABEL[c]}: `}
          <b>{summary.confidence[c] ?? 0}</b>
        </span>
      ))}
      {summary.sectionsLine ? <span data-sections>{summary.sectionsLine}</span> : null}
      {summary.mappingNote ? (
        <span className="rc-warn" data-mapping-note>
          {summary.mappingNote}
        </span>
      ) : null}
      <span data-count="needs_matter">
        {"Needs a matter: "}
        <b>{summary.needsMatter}</b>
      </span>
      <span data-count="already">
        {"Already in the proposed stage: "}
        <b>{summary.alreadyThere}</b>
      </span>
      <span data-source="sheet">Sheet: read</span>
      <span data-source="lawmatics" data-status={summary.lawmatics.status}>
        {lawmaticsLine(summary.lawmatics)}
      </span>
      <span data-source="email" data-status={summary.email.status}>
        {emailLine(summary.email)}
      </span>
      {summary.email.status === "ok" && summary.email.note ? <span>{summary.email.note}</span> : null}
      {summary.notes ? (
        <span data-source="notes" data-status={summary.notes.status} className={summary.notes.status === "unavailable" ? "rc-warn" : undefined}>
          {notesSummaryLine(summary.notes)}
        </span>
      ) : null}
      {summary.mailbox ? (
        <span data-source="mailbox" className={summary.mailbox.note ? "rc-warn" : undefined}>
          {summary.mailbox.note ? `Mailbox search: ${summary.mailbox.note}` : `Mailbox search: ${summary.mailbox.searched} people searched`}
        </span>
      ) : null}
      <span data-count="no-lead">{`${summary.sheetRowsWithoutLead.length} sheet rows have no lead in the app`}</span>
      <span data-count="refused">{`${summary.refused.length} sheet rows were not used`}</span>
      {summary.ambiguousLeads > 0 ? (
        <span data-count="ambiguous">{`${summary.ambiguousLeads} leads could not be matched to one sheet row`}</span>
      ) : null}
      {summary.leadsTruncated ? (
        <span className="lx-pill lx-pill-warn" data-truncated="true">
          Only part of the lead list was read
        </span>
      ) : null}
    </section>
  );
}

/** The sheet rows left out: ones with no lead (never created) and ones the parser refused, each with why. */
export function LeftOutLists({ summary }: { summary: ReconcileSummary }) {
  // "Not in Lectual yet" lists these people with a Create lead button; this list is only for a summary without it.
  const noLead = summary.notInLectual ? [] : summary.sheetRowsWithoutLead;
  const refused = summary.refused;
  if (noLead.length === 0 && refused.length === 0) return null;
  return (
    <div className="rc-wrap">
      {noLead.length > 0 ? (
        <details className="lx-card" style={{ padding: "12px 16px" }}>
          <summary>{`${noLead.length} sheet rows have no lead in the app`}</summary>
          <p className="lx-note">These are listed, not created. The sheet importer files new leads.</p>
          <ul className="rc-lines">
            {noLead.map((r) => (
              <li key={r.row}>{`Row ${r.row}: ${r.owner}${r.mark ? ` (${r.mark})` : ""}, ${r.status}`}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {refused.length > 0 ? (
        <details className="lx-card" style={{ padding: "12px 16px" }}>
          <summary>{`${refused.length} sheet rows were not used`}</summary>
          <ul className="rc-lines">
            {refused.map((r) => (
              <li key={r.row}>{`Row ${r.row}${r.status ? `, "${r.status}"` : ""}: ${r.reason}`}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
