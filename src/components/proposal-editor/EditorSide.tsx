import { Fragment } from "react";
import { formatCents } from "@/lib/quotes/money";
import { packageLineTitle } from "@/lib/proposals/name-package";
import type { ProposalQuote } from "@/lib/proposals/types";
import { EDITOR_WORDS, checkTheseHeading } from "@/lib/proposal-editor/vocabulary";
import { blockingCount, type ChecklistItem } from "@/lib/proposal-editor/checklist";
import { UnsavedPriceNote } from "./UnsavedGuard";

/**
 * The side column's two cards. Both are server components over data the page already has: the saved prices from
 * `quoteProposal`, and the issues from `validateContent(..., forApproval)`. Preview, Save and "Save and create link"
 * are `EditorActions` (a client component), drawn last in the same column.
 */

/** "What the client pays": the SAVED prices. While the page has unsaved changes it says they update when you save. */
export function PayBox({ quote, general, valueOverFee }: { quote: ProposalQuote; general: boolean; valueOverFee: { value_cents: number } | null }) {
  return (
    <section className="lx-card pe-totals" aria-label={EDITOR_WORDS.clientPays}>
      <div className="lx-label">{EDITOR_WORDS.clientPays}</div>
      {general ? (
        <>
          <dl>
            {quote.general?.items.map((it, n) => (
              <div key={n} className="pe-line pe-line-mute">
                <dt>
                  {it.label}
                  {typeof it.hours === "number" ? ` (${it.hours} ${it.hours === 1 ? "hr" : "hrs"})` : ""}
                </dt>
                <dd>{formatCents(it.value_cents)}</dd>
              </div>
            ))}
            {valueOverFee && (
              <div className="pe-line pe-line-mute">
                <dt>Value of the work</dt>
                <dd>{formatCents(valueOverFee.value_cents)}</dd>
              </div>
            )}
            <div className="pe-line">
              <dt>Flat fee</dt>
              <dd>{formatCents(quote.legal_subtotal_cents)}</dd>
            </div>
            <Credits quote={quote} />
            <div className="pe-line pe-line-total">
              <dt>Legal fee, due when accepted</dt>
              <dd>{formatCents(quote.legal_total_cents)}</dd>
            </div>
          </dl>
          <p className="lx-note" style={{ margin: 0 }}>
            Worked out from the saved fee. A flat fee: no packages, classes or USPTO fees.
          </p>
        </>
      ) : (
        <>
          <dl>
            {quote.names.map((n) => (
              <Fragment key={n.id}>
                <div className="pe-line">
                  <dt>{packageLineTitle(n)}</dt>
                  <dd>{n.included ? formatCents(n.legal_cents) : "none selected"}</dd>
                </div>
                {n.included && n.custom_discount_cents ? (
                  <div className="pe-line pe-line-mute">
                    <dt>{`${n.custom_discount_label || "Discount"} (in the fee above)`}</dt>
                    <dd>−{formatCents(n.custom_discount_cents)}</dd>
                  </div>
                ) : null}
              </Fragment>
            ))}
            <Credits quote={quote} />
            <div className="pe-line pe-line-total">
              <dt>Legal fee, due when accepted</dt>
              <dd>{formatCents(quote.legal_total_cents)}</dd>
            </div>
            <div className="pe-line pe-line-mute">
              <dt>
                USPTO fees, due at filing
                {quote.gov_class_count > 0 ? ` (${quote.gov_class_count} ${quote.gov_class_count === 1 ? "filing" : "filings"})` : ""}
              </dt>
              <dd>{formatCents(quote.gov_total_cents)}</dd>
            </div>
          </dl>
          <p className="lx-note" style={{ margin: 0 }}>
            Worked out from the saved prices. The client can untick marks and classes; their total follows.
          </p>
        </>
      )}
      <UnsavedPriceNote text={EDITOR_WORDS.pricesUpdateOnSave} />
    </section>
  );
}

function Credits({ quote }: { quote: ProposalQuote }) {
  return (
    <>
      {quote.adjustments
        .filter((a) => a.discount_cents > 0)
        .map((a) => (
          <div key={a.id} className="pe-line pe-line-mute">
            <dt>{a.label || "Adjustment"}</dt>
            <dd>−{formatCents(a.discount_cents)}</dd>
          </div>
        ))}
    </>
  );
}

/** "Ready to send?": what blocks the link, each item a link to its field. Shown from the first load, before any save. */
export function ReadyChecklist({ items }: { items: ChecklistItem[] }) {
  const blocking = blockingCount(items);
  const main = items.filter((i) => i.level !== "check");
  const checks = items.filter((i) => i.level === "check");
  return (
    <section className="lx-card pe-ready" aria-label={EDITOR_WORDS.readyHeading} data-ready>
      <div className="lx-label">{EDITOR_WORDS.readyHeading}</div>
      {items.length === 0 ? (
        <p className="lx-note pe-ready-ok" role="status">
          {EDITOR_WORDS.readyNothing}
        </p>
      ) : (
        <>
          <p className="lx-note" style={{ margin: 0 }}>
            {blocking > 0
              ? `${blocking} ${blocking === 1 ? "thing blocks" : "things block"} the link${items.length > blocking ? `, and ${items.length - blocking} to check` : ""}. Based on what is saved.`
              : `${items.length} ${items.length === 1 ? "thing" : "things"} to check. None blocks the link.`}
          </p>
          {main.length > 0 && <ChecklistList items={main} />}
          {checks.length > 0 && (
            <>
              <p className="pe-ready-sub" data-ready-checks>
                {checkTheseHeading(checks.length)}
              </p>
              <ChecklistList items={checks} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function ChecklistList({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="pe-ready-list">
      {items.map((it, i) => (
        <li key={i} data-level={it.level}>
          <a className="pe-ready-link" href={it.href}>
            <span className="pe-issue-tag">{it.level === "error" ? "Fix" : "Check"}</span>
            {it.where ? <span className="pe-issue-where">{it.where}: </span> : null}
            {it.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
