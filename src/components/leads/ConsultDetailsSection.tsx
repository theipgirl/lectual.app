import { roleLabel } from "@/lib/auth/roles";
import type { ReactNode } from "react";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadConsultEntries, type ConsultDb, type ConsultEntry } from "@/lib/consult/store";
import { CONSULT_BASIS_LABEL, MARK_TYPE_LABEL, formatClassLines, type StoredConsultDetails } from "@/lib/consult/vocab";
import { relativeTime } from "@/lib/relative-time";
import { ConsultDetailsForm } from "./ConsultDetailsForm";

/**
 * The lead page's "Consult details" card: per mark, what the call said about
 * word vs design, classes with goods/services, and the filing basis, for a
 * person to review before anything relies on it.
 *
 * Three states, never two: details, none, and "couldn't be loaded". A failed
 * read says so — it is never drawn as a lead with no consult. An unreviewed
 * record is labelled as such, `unknown` is shown as unknown, and an unreadable
 * saved value is reported rather than hidden.
 *
 * This is a record of what was said, not advice. Which filing basis applies is
 * the attorney's determination; nothing here recommends one.
 */

const SOURCE_LABEL: Record<string, string> = {
  "post-consult-agent": "Read from the consult notes by the post-consult drafter",
  "meeting-follow-up": "Read from the meeting when its follow-up was drafted",
};

function Provenance({ entry, details }: { entry: ConsultEntry; details: StoredConsultDetails | null }) {
  const source = entry.source ? entry.source.charAt(0).toUpperCase() + entry.source.slice(1) : "Consult";
  const how = details ? (details.extracted ? SOURCE_LABEL[details.extracted.source] : "Entered by hand") : null;
  return (
    <span className="lx-note">
      {source} · {relativeTime(entry.createdAt)}
      {how ? ` · ${how}` : ""}
    </span>
  );
}

function ReviewPill({ details }: { details: StoredConsultDetails }) {
  if (!details.review) {
    return <span className="lx-pill lx-pill-warn">Needs review</span>;
  }
  const who = details.review.reviewed_by_name ?? "a teammate";
  return (
    <span className="lx-pill lx-pill-ok" title={`Reviewed by ${who} ${relativeTime(details.review.reviewed_at)}`}>
      Reviewed
    </span>
  );
}

function ReadOnly({ details }: { details: StoredConsultDetails }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {details.marks.length === 0 && <p className="lx-note" style={{ margin: 0 }}>No marks recorded.</p>}
      {details.marks.map((m) => (
        <div key={m.id} style={{ display: "grid", gap: 2 }}>
          <b>{m.mark}</b>
          <span className="lx-note">
            {MARK_TYPE_LABEL[m.mark_type]} · {CONSULT_BASIS_LABEL[m.filing_basis]}
            {m.first_use_date ? ` · first use ${m.first_use_date}` : ""}
          </span>
          {m.classes.length > 0 && (
            <span className="lx-note" style={{ whiteSpace: "pre-line" }}>
              {formatClassLines(m.classes)}
            </span>
          )}
        </div>
      ))}
      {(details.recommended_package || details.discount_discussed) && (
        <span className="lx-note">
          {[details.recommended_package && `Package: ${details.recommended_package}`, details.discount_discussed && `Discount discussed: ${details.discount_discussed}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
    </div>
  );
}

export async function ConsultDetailsSection({ leadId, canWrite }: { leadId: string; canWrite: boolean }) {
  const supabase = await getScopedClient();
  const read = await loadConsultEntries(supabase as unknown as ConsultDb, leadId);

  const shell = (children: ReactNode) => (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 14 }} aria-labelledby="consult-details-title">
      <div>
        <div className="lx-label">From the consultation</div>
        <h2 id="consult-details-title" className="lx-h2" style={{ fontSize: 23 }}>
          Consult details
        </h2>
        <p className="lx-note" style={{ margin: "6px 0 0" }}>
          A record of what was said about each mark, for you to check. Which filing basis applies is the attorney&apos;s call; nothing here recommends one,
          and nothing is relied on until it&apos;s marked reviewed.
        </p>
      </div>
      {children}
    </section>
  );

  if (read.status === "unavailable") {
    return shell(<p className="lx-note" style={{ margin: 0 }}>Consult details couldn&apos;t be loaded just now. Nothing is shown rather than a guess.</p>);
  }

  if (read.entries.length === 0) {
    if (!canWrite) return null;
    return (
      <details className="lx-card lx-disclosure">
        <summary>Record consult details by hand</summary>
        <div style={{ padding: "0 18px 18px" }}>
          <ConsultDetailsForm leadId={leadId} noteId={null} details={null} />
        </div>
      </details>
    );
  }

  const shown = read.entries.slice(0, 3);
  return shell(
    [...shown.map((entry, idx) => {
      const body =
        entry.read.kind === "invalid" ? (
          <p className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
            The details saved on this consult couldn&apos;t be read, so they aren&apos;t shown or carried anywhere. Ask Lectual to take a look.
          </p>
        ) : entry.read.kind === "none" ? (
          canWrite ? (
            <ConsultDetailsForm key={`${entry.noteId}:none`} leadId={leadId} noteId={entry.noteId} details={null} />
          ) : (
            <p className="lx-note" style={{ margin: 0 }}>No mark details have been recorded for this consult.</p>
          )
        ) : canWrite ? (
          <ConsultDetailsForm key={`${entry.noteId}:${entry.read.details.rev}`} leadId={leadId} noteId={entry.noteId} details={entry.read.details} />
        ) : (
          <ReadOnly details={entry.read.details} />
        );
      return (
        <div key={entry.noteId} style={{ display: "grid", gap: 10, paddingTop: idx === 0 ? 0 : 14, borderTop: idx === 0 ? "none" : "1px solid var(--line-2)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {entry.read.kind === "ok" && <ReviewPill details={entry.read.details} />}
            <Provenance entry={entry} details={entry.read.kind === "ok" ? entry.read.details : null} />
          </div>
          {entry.read.kind === "ok" && entry.read.details.review && (
            <span className="lx-note">
              Reviewed by {entry.read.details.review.reviewed_by_name ?? "a teammate"}
              {entry.read.details.review.reviewed_by_role ? ` (${roleLabel(entry.read.details.review.reviewed_by_role)})` : ""} ·{" "}
              {relativeTime(entry.read.details.review.reviewed_at)}
            </span>
          )}
          {body}
        </div>
      );
    }),
    read.entries.length > shown.length && (
      <p key="older" className="lx-note" style={{ margin: 0 }}>
        {read.entries.length - shown.length} older consult{read.entries.length - shown.length === 1 ? "" : "s"} not shown.
      </p>
    )],
  );
}
