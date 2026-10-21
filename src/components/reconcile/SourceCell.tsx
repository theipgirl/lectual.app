import { SOURCE_LABEL, type SourceName, type SourceSignal } from "@/lib/reconcile/types";

/**
 * One source's reading of one lead. The five states read differently on purpose: a source that
 * could not be read says "Unavailable" with why, and is never shown as "None" (which means it was
 * read and had nothing to say).
 */
export function SourceCell({ source, signal }: { source: SourceName; signal: SourceSignal }) {
  switch (signal.kind) {
    case "stage":
      return (
        <div className="rc-cell" data-state="stage">
          <b>{signal.stageName}</b>
          <small>{`${SOURCE_LABEL[source]} says "${signal.wording}"`}</small>
        </div>
      );
    case "unavailable":
      return (
        <div className="rc-cell" data-state="unavailable">
          <span className="rc-state rc-state-unavailable">Unavailable</span>
          <small>{signal.reason}</small>
        </div>
      );
    case "unmapped":
      return (
        <div className="rc-cell" data-state="unmapped">
          <span className="rc-state rc-state-unmapped">{`Unmapped: ${signal.wording}`}</span>
          <small>Not one of this firm&apos;s stages, so it doesn&apos;t count.</small>
        </div>
      );
    case "needs_matter":
      return (
        <div className="rc-cell" data-state="needs-matter">
          <span className="rc-state rc-state-matter">{source === "lawmatics" ? "Hired" : "Client"}</span>
          <small>{`${SOURCE_LABEL[source]} says "${signal.wording}"`}</small>
        </div>
      );
    case "none":
      return (
        <div className="rc-cell" data-state="none">
          <span className="rc-state rc-state-none">None</span>
          {signal.note ? <small>{signal.note}</small> : null}
        </div>
      );
  }
}
