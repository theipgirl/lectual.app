import { roleLabel } from "@/lib/auth/roles";
import "@/app/dashboard/proposals/proposals.css";
import Link from "next/link";
import { CONSULT_BASIS_LABEL, MARK_TYPE_LABEL, formatClassLines } from "@/lib/consult/vocab";
import type { ConsultStripState } from "@/lib/proposals/consult-strip";
import { formatFirmStamp } from "@/lib/quotes/labels";

/**
 * The linked lead's latest consult, above a proposal, so the approver can check
 * the offer against what was said. It takes an already-read state (see
 * `consultStripState`), so a failed read is drawn as "couldn't be loaded" and
 * never as "No consult recorded".
 *
 * It is a record of what was said, not advice. Details nobody has reviewed are
 * labelled "not yet reviewed" and are not presented as fact; a filing basis the
 * call did not settle is shown as unknown.
 */

const SOURCE_NAME: Record<string, string> = { fathom: "Fathom", zoom: "Zoom", manual: "Entered by hand" };

function sourceName(source: string | null): string {
  if (!source) return "Consult notes";
  return SOURCE_NAME[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function ConsultStrip({ state, leadId, tz }: { state: ConsultStripState; leadId: string; tz: string }) {
  const lead = <Link href={`/dashboard/leads/${leadId}/`}>Open the lead</Link>;

  if (state.status === "unavailable") {
    return (
      <section className="lx-banner lx-banner-warn pe-consult" role="status" aria-label="Latest consult">
        <strong>Latest consult couldn&apos;t be loaded</strong>
        <span>
          {state.unreadable
            ? "The details saved on the newest consult couldn't be read, so none are shown. "
            : "Can't show this right now. Refresh to try again. "}
          {lead}
        </span>
      </section>
    );
  }

  if (state.status === "none") {
    return (
      <section className="lx-card pe-consult" aria-label="Latest consult">
        <div className="lx-label">Latest consult</div>
        <p className="lx-note" style={{ margin: 0 }}>
          No consult recorded for this lead yet, so there is nothing here to check the offer against. {lead}
        </p>
      </section>
    );
  }

  const { details } = state;
  const review = details.review;
  return (
    <section className="lx-card pe-consult" aria-label="Latest consult">
      <div className="pe-consult-head">
        <div className="lx-label">Latest consult</div>
        <span className="lx-note">
          {formatFirmStamp(state.createdAt, tz)} · {sourceName(state.source)}
        </span>
        {state.reviewed ? (
          <span className="lx-pill lx-pill-ok">Reviewed</span>
        ) : (
          <span className="lx-pill lx-pill-warn">not yet reviewed</span>
        )}
        {lead}
      </div>
      {review ? (
        <span className="lx-note">
          Reviewed by {review.reviewed_by_name ?? "a teammate"}
          {review.reviewed_by_role ? ` (${roleLabel(review.reviewed_by_role)})` : ""} · {formatFirmStamp(review.reviewed_at, tz)}
        </span>
      ) : (
        <span className="lx-note">Not yet reviewed by a person, so treat these as what the notes appear to say, not as fact.</span>
      )}
      {details.marks.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>No marks were recorded for this consult.</p>
      ) : (
        <ul className="pe-consult-marks">
          {details.marks.map((m) => (
            <li key={m.id}>
              <b>{m.mark}</b>
              <span className="lx-note">
                {MARK_TYPE_LABEL[m.mark_type]} · Filing basis{" "}
                {m.filing_basis === "unknown" ? "unknown (not stated on the call)" : CONSULT_BASIS_LABEL[m.filing_basis]}
              </span>
              {m.classes.length > 0 && (
                <span className="lx-note" style={{ whiteSpace: "pre-line" }}>
                  {formatClassLines(m.classes)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {(details.recommended_package || details.discount_discussed) && (
        <span className="lx-note">
          {[details.recommended_package && `Package discussed: ${details.recommended_package}`, details.discount_discussed && `Discount discussed: ${details.discount_discussed}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
    </section>
  );
}
