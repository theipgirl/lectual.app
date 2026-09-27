"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fullProjectCost, lineAmountCents, quoteReadiness, quoteTotals, type QuoteLineInput } from "@/lib/quotes/pricing";
import { applyClientChoice, packageBlurb, readOffer } from "@/lib/quotes/packages";
import { formatQuoteExpiry } from "@/lib/quotes/status";
import { formatCents } from "@/lib/quotes/money";
// Types only — the module itself is server-only and never reaches the browser.
import type { PublicQuoteView } from "@/lib/quotes/public";
import { acceptQuoteAction, declineQuoteAction } from "@/app/q/[token]/actions";
import { FirmHeader } from "./FirmHeader";

/**
 * The live proposal — the only state with accept and decline controls. The
 * right-hand screen of design/Quote_Builder_Prototype.dc.html: the intro, the
 * packages to pick from, the add-ons, "Due today" and "Due later, at filing",
 * and a typed-name signature.
 *
 * ── WHAT THE CLIENT SEES IS THE OFFER ───────────────────────────────────────
 * `view.lines` holds only what the firm offered (packages.ts): withheld
 * packages and add-ons never reach this page. The client's pick lives here, in
 * state, and goes to the server once — with the signature — where it is
 * validated against the offer as it stands then.
 *
 * ── THE SPLIT ───────────────────────────────────────────────────────────────
 * "Due today" and "Due later, at filing" are separate figures; the full project
 * cost is labelled as neither and says it is not due today. There is no row on
 * this page that reads "Total". Nothing is charged here — no card, no payment
 * step — and the page says so rather than promising one.
 *
 * ── WHAT IS SIGNED IS WHAT WAS ON SCREEN ────────────────────────────────────
 * The signature carries the pick and the fingerprint the server computed for
 * THIS render. If the firm re-priced a line, switched a package off, or edited
 * the terms while the page was open, the server refuses and the page refreshes
 * to the current offer — the client is told which half changed.
 *
 * Everything the client or the firm typed is rendered as text (pre-wrap),
 * never as HTML: this route has no login and no sanitiser.
 */
export function QuoteDocument({ token, view, ready }: { token: string; view: PublicQuoteView; ready: boolean }) {
  const router = useRouter();
  const offer = useMemo(() => readOffer(view.lines, view.currency), [view.lines, view.currency]);
  const [pick, setPick] = useState<string | null>(() => (offer.packages.length === 1 ? offer.packages[0].name : null));
  const [addOns, setAddOns] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [accepting, startAccepting] = useTransition();
  const [declining, startDeclining] = useTransition();
  const busy = accepting || declining;

  // The pick, projected onto the offered lines — the same function the server
  // runs on the signature, so the figures here are the figures it will freeze.
  const chosen = useMemo(() => {
    const projected = applyClientChoice(view.lines, { package: pick, addOns });
    if (projected.ok) return projected.lines;
    // A pick the current offer no longer contains (the page refreshed under
    // it) counts as no pick — never as every package at once.
    const bare = applyClientChoice(view.lines, { package: null, addOns: [] });
    return bare.ok ? bare.lines : [];
  }, [view.lines, pick, addOns]);
  const totals = useMemo(() => quoteTotals(chosen as readonly QuoteLineInput[], view.currency), [chosen, view.currency]);
  const readiness = useMemo(() => quoteReadiness(chosen as readonly QuoteLineInput[]), [chosen]);

  const hasPackages = offer.packages.length > 0;
  const picked = hasPackages ? offer.packages.find((pkg) => pkg.name === pick) ?? null : null;
  const choiceMade = !hasPackages || picked !== null;
  const nameOk = name.trim().replace(/\s+/g, " ").length >= 2;
  const canAccept = ready && readiness.ready && nameOk && !busy;
  const expiry = formatQuoteExpiry(view.expiresAt);

  const hint = !ready
    ? "This proposal isn't ready to sign yet. Contact the firm that sent it."
    : !choiceMade
      ? "Pick a package to see what is due today."
      : !readiness.ready
        ? readiness.message
        : !nameOk
          ? "Type your full name to enable signing."
          : "Nothing is charged on this page. Signing records your acceptance with the firm.";

  function toggleAddOn(id: string) {
    setAddOns((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  function accept() {
    if (!canAccept) return;
    setAcceptError(null);
    startAccepting(async () => {
      const result = await acceptQuoteAction({
        token,
        name,
        choice: { package: hasPackages ? pick : null, addOns },
        linesFingerprint: view.linesFingerprint,
      });
      if (result.ok || result.reason === "already_resolved") {
        router.refresh();
        return;
      }
      if (result.reason === "quote_changed" || result.reason === "terms_changed" || result.reason === "unknown_line") {
        setStaleMessage(
          result.reason === "terms_changed"
            ? "This agreement was updated while you had it open. The engagement terms below are the firm's current wording — please read them before signing."
            : "This proposal was updated while you had it open. What you see now is the firm's current offer — please check it before signing.",
        );
        setAcceptError(acceptMessage(result.reason, result.message));
        setPick(null);
        setAddOns([]);
        router.refresh();
        return;
      }
      setAcceptError(acceptMessage(result.reason, result.message));
    });
  }

  function decline() {
    setDeclineError(null);
    startDeclining(async () => {
      const result = await declineQuoteAction(token);
      if (result.ok || result.reason === "not_live" || result.reason === "already_resolved") {
        // Declined — or it had already left `sent` (signed, withdrawn, expired).
        // Either way the page's next render is the true state.
        router.refresh();
        return;
      }
      setDeclineError(
        result.reason === "not_found"
          ? "This proposal was updated while you had it open. Reload the page."
          : "We couldn't record that just now. Nothing was changed — please try again in a moment.",
      );
    });
  }

  return (
    <>
      <FirmHeader firmName={view.firm.name} note="Sent to you by link. No account, no login." />

      <div className="qp-body">
        <div>
          <h1 className="qp-title">{view.title}</h1>
          {view.introBody && <p className="qp-intro">{view.introBody}</p>}
          {expiry && <div className="qp-meta">Open for acceptance until {expiry}</div>}
        </div>

        {staleMessage && (
          <p role="status" className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
            {staleMessage}
          </p>
        )}

        {offer.common.length > 0 && hasPackages && (
          <p className="qp-common">
            <span className="qp-kicker" style={{ display: "block", marginBottom: 4 }}>
              Included with every package
            </span>
            {packageBlurb(offer.common)}
          </p>
        )}

        {hasPackages ? (
          <div className="qp-pkgs" role="radiogroup" aria-label="Packages">
            {offer.packages.map((pkg) => {
              const on = pick === pkg.name;
              const blurb = packageBlurb(pkg.lines);
              return (
                <button
                  key={pkg.name}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="qp-pkg"
                  disabled={busy}
                  onClick={() => setPick(pkg.name)}
                >
                  <span className="qp-pkg-head">
                    <span className="qp-pkg-name">{pkg.name}</span>
                    <span className="qp-pkg-price">{formatCents(pkg.totals.dueAtSigning, view.currency)}</span>
                  </span>
                  {blurb && <span className="qp-pkg-blurb" style={{ display: "block" }}>{blurb}</span>}
                  {pkg.totals.dueAtFiling !== 0 && (
                    <span className="qp-pkg-filing" style={{ display: "block" }}>
                      + {formatCents(pkg.totals.dueAtFiling, view.currency)} USPTO fees, at filing
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          offer.common.length > 0 && (
            <div className="qp-pkg" role="group" aria-label="What this proposal includes" style={{ cursor: "default" }}>
              <span className="qp-pkg-head">
                <span className="qp-pkg-name">What&rsquo;s included</span>
                <span className="qp-pkg-price">{formatCents(offer.commonTotals.dueAtSigning, view.currency)}</span>
              </span>
              <span className="qp-pkg-blurb" style={{ display: "block" }}>
                {packageBlurb(offer.common)}
              </span>
            </div>
          )
        )}

        {offer.addOns.length > 0 && (
          <div className="qp-addons">
            <div className="qp-kicker">Optional, add if you want it</div>
            {offer.addOns.map(({ line }) => {
              const on = addOns.includes(line.id);
              const atFiling = line.kind === "government_fee" || line.charge_at === "filing";
              return (
                <button
                  key={line.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className="qp-addon"
                  disabled={busy}
                  onClick={() => toggleAddOn(line.id)}
                >
                  <span className="qp-box" aria-hidden="true" />
                  <span className="qp-addon-label">
                    {line.label}
                    {atFiling ? " (at filing)" : ""}
                  </span>
                  <span className="qp-addon-price">{formatCents(lineAmountCents(line), view.currency)}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="qp-due">
          <div className="qp-due-now" data-empty={!choiceMade}>
            {choiceMade ? formatCents(totals.dueAtSigning, view.currency) : "—"}
          </div>
          <div className="qp-due-label">Due today</div>
          <div className="qp-due-note">
            {choiceMade
              ? `Legal fees${picked ? ` for ${picked.name}` : ""}${addOns.length ? ", with your add-ons" : ""}. Due when you sign — the firm invoices you; nothing is charged on this page.`
              : "Choose a package above before accepting."}
          </div>
          <div className="qp-due-later">{formatCents(totals.dueAtFiling, view.currency)}</div>
          <div className="qp-due-later-label">Due later, at filing</div>
          <div className="qp-due-note">USPTO government fees. Quoted now, collected when the applications are filed — not today.</div>
          {choiceMade && (
            <div className="qp-project">Full project cost {formatCents(fullProjectCost(totals), view.currency)} — not an amount due today</div>
          )}
        </div>

        {view.termsBody && (
          <div className="qp-terms">
            <div className="qp-kicker">Engagement terms — read before signing</div>
            <p className="qp-terms-body">{view.termsBody}</p>
          </div>
        )}

        <div className="qp-sign">
          <label className="qp-name">
            <span className="qp-kicker">Type your full name to sign</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={200}
              disabled={busy}
              placeholder="Your full name"
            />
          </label>
          <button
            type="button"
            className="qp-accept"
            data-ready={canAccept}
            onClick={accept}
            aria-disabled={!canAccept}
            aria-describedby="qp-accept-hint"
          >
            {accepting ? "Signing…" : "Accept and sign"}
          </button>
          <p id="qp-accept-hint" role="status" className="qp-hint">
            {hint}
          </p>
          {acceptError && (
            <p role="alert" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
              {acceptError}
            </p>
          )}
          <p className="qp-small" style={{ textAlign: "center" }}>
            {view.termsBody
              ? `Typing your name signs the engagement terms above and the fees you chose, as your agreement with ${view.firm.name}.`
              : `Typing your name signs this agreement with ${view.firm.name}.`}{" "}
            Your name, IP address and browser are recorded with your acceptance.
          </p>

          {confirmDecline ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, color: "var(--body)" }}>Decline this proposal? {view.firm.name} will see that you did.</span>
              <button type="button" className="lx-btn lx-btn-danger lx-btn-sm" onClick={decline} disabled={busy}>
                {declining ? "Declining…" : "Yes, decline"}
              </button>
              <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setConfirmDecline(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="qp-decline" onClick={() => setConfirmDecline(true)} disabled={busy}>
              Decline this proposal
            </button>
          )}
          {declineError && (
            <p role="alert" className="qp-small" style={{ color: "var(--wine)", textAlign: "center" }}>
              {declineError}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function acceptMessage(reason: string | undefined, message: string | undefined): string {
  switch (reason) {
    case "not_ready":
      return message ?? "Make your selections before signing.";
    case "invalid_name":
      return "Type your full name to sign.";
    case "invalid_email":
      return message ?? "That email address doesn't look complete.";
    case "quote_changed":
      return "Nothing was signed: this proposal changed while you had it open. Check the current offer above, then sign again if you still agree.";
    case "terms_changed":
      return "Nothing was signed: the engagement terms changed while you had this open. Read the updated terms above, then sign again if you still agree.";
    case "unknown_line":
    case "not_found":
      return "Nothing was signed: this proposal was updated while you had it open. Choose again from what is shown now.";
    case "not_live":
      return "This proposal is no longer open for acceptance. Reload the page.";
    case "unconfigured":
    case "unavailable":
      return "We couldn't reach the firm's records just now. Nothing was signed — please try again in a moment.";
    default:
      return message ?? "We couldn't complete that just now. Nothing was signed.";
  }
}
