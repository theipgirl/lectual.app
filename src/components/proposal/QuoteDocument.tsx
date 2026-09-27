"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  fullProjectCost,
  isLineSelected,
  lineAmountCents,
  quoteReadiness,
  quoteTotals,
  tierGroups,
  type QuoteLineInput,
} from "@/lib/quotes/pricing";
import { formatQuoteExpiry } from "@/lib/quotes/status";
import { formatCents } from "@/lib/quotes/money";
// Types only — the module itself is server-only and never reaches the browser.
import type { PublicQuoteLine, PublicQuoteView } from "@/lib/quotes/public";
import { acceptQuoteAction, declineQuoteAction, saveSelectionAction } from "@/app/q/[token]/actions";
import { FirmHeader } from "./FirmHeader";

/**
 * The live proposal — the only state with accept and decline controls.
 *
 * ── ONE DOCUMENT, ONE SIGNATURE ─────────────────────────────────────────────
 * The priced lines and the engagement terms are presented as one article, and
 * the typed name signs both. A client who has to click through to a second
 * document to find the fee agreement has not read it.
 *
 * ── THE SPLIT ───────────────────────────────────────────────────────────────
 * "Due today" and "Due later, at filing (USPTO fees)" are separate figures;
 * the full project cost is labelled as neither and says it is not due today.
 * There is no row on this page that reads "Total".
 *
 * ── WHAT IS SIGNED IS WHAT WAS ON SCREEN ────────────────────────────────────
 * The signature carries the choices ticked and the fingerprint the server
 * computed for THIS render. If the firm re-priced a line or edited the terms
 * while the page was open, the server refuses and the page refreshes to the
 * current figures — the client is told which half changed.
 *
 * Everything the client or the firm typed is rendered as text (pre-wrap),
 * never as HTML: this route has no login and no sanitiser.
 */
export function QuoteDocument({ token, view }: { token: string; view: PublicQuoteView }) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    view.lines.filter((line) => isSelectable(line) && line.selected).map((line) => line.id),
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [saving, startSaving] = useTransition();
  const [accepting, startAccepting] = useTransition();
  const [declining, startDeclining] = useTransition();

  const lines: PublicQuoteLine[] = useMemo(
    () => view.lines.map((line) => (isSelectable(line) ? { ...line, selected: selectedIds.includes(line.id) } : line)),
    [view.lines, selectedIds],
  );
  const totals = useMemo(() => quoteTotals(lines as readonly QuoteLineInput[], view.currency), [lines, view.currency]);
  const readiness = useMemo(() => quoteReadiness(lines as readonly QuoteLineInput[]), [lines]);
  const groups = useMemo(() => tierGroups(lines as readonly QuoteLineInput[]), [lines]);

  const optionalLines = lines.filter((line) => line.selection === "optional");
  const standingLines = lines.filter((line) => !isSelectable(line));
  const expiry = formatQuoteExpiry(view.expiresAt);
  const busy = accepting || declining;

  const disabledReason: string | null = accepting
    ? "Submitting…"
    : !readiness.ready
      ? readiness.message
      : !name.trim()
        ? "Type your full name to sign."
        : !email.trim()
          ? "Enter an email address."
          : null;

  function persistSelection(next: string[]) {
    startSaving(async () => {
      const result = await saveSelectionAction(token, next);
      if (result.ok) {
        setStaleMessage(null);
        return;
      }
      setStaleMessage(
        result.reason === "unknown_line" || result.reason === "not_found"
          ? "This proposal was updated while you had it open. Reload the page to see the current version."
          : result.reason === "not_live"
            ? "This proposal is no longer open for acceptance. Reload the page."
            : "We couldn't save that choice just now. Your selection is still on screen and will be checked again when you accept.",
      );
    });
  }

  function chooseTier(group: string, lineId: string) {
    const groupIds = new Set(
      lines.filter((line) => line.selection === "tier_option" && (line.tier_group ?? "").trim() === group).map((l) => l.id),
    );
    const next = [...selectedIds.filter((id) => !groupIds.has(id)), lineId];
    setSelectedIds(next);
    persistSelection(next);
  }

  function toggleAddOn(lineId: string) {
    const next = selectedIds.includes(lineId) ? selectedIds.filter((id) => id !== lineId) : [...selectedIds, lineId];
    setSelectedIds(next);
    persistSelection(next);
  }

  function accept() {
    setAcceptError(null);
    startAccepting(async () => {
      const result = await acceptQuoteAction({ token, name, email, lineIds: selectedIds, linesFingerprint: view.linesFingerprint });
      if (result.ok || result.reason === "already_resolved") {
        router.refresh();
        return;
      }
      if (result.reason === "quote_changed" || result.reason === "terms_changed") {
        setStaleMessage(
          result.reason === "terms_changed"
            ? "This agreement was updated while you had it open. The engagement terms below are the firm's current wording — please read them before signing."
            : "This proposal was updated while you had it open. The amounts below are the firm's current figures — please read them before signing.",
        );
        setAcceptError(acceptMessage(result.reason, result.message));
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
      <FirmHeader firm={view.firm} />

      <article className="lx-card" style={{ padding: "28px 26px", display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <h1 className="lx-h1" style={{ fontSize: 34 }}>
            {view.title}
          </h1>
          {expiry && <span className="lx-note">Open for acceptance until {expiry}</span>}
        </div>

        {view.introBody && (
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 15.5, lineHeight: 1.65, color: "var(--body)" }}>{view.introBody}</p>
        )}

        {staleMessage && (
          <p role="status" className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
            {staleMessage}
          </p>
        )}

        {standingLines.length > 0 && (
          <Section title="Included">
            {standingLines.map((line) => (
              <LineRow key={line.id} line={line} currency={view.currency} />
            ))}
          </Section>
        )}

        {groups.map((group) => (
          <Section key={group.group} title={`Choose your ${group.group}`}>
            {group.options.map((option) => {
              const line = option as PublicQuoteLine;
              return (
                <ChoiceRow
                  key={line.id}
                  type="radio"
                  name={`tier-${group.group}`}
                  checked={selectedIds.includes(line.id)}
                  disabled={saving || busy}
                  onChange={() => chooseTier(group.group, line.id)}
                  line={line}
                  currency={view.currency}
                />
              );
            })}
          </Section>
        ))}

        {optionalLines.length > 0 && (
          <Section title="Optional add-ons">
            {optionalLines.map((line) => (
              <ChoiceRow
                key={line.id}
                type="checkbox"
                checked={selectedIds.includes(line.id)}
                disabled={saving || busy}
                onChange={() => toggleAddOn(line.id)}
                line={line}
                currency={view.currency}
              />
            ))}
          </Section>
        )}

        <div style={{ display: "grid", gap: 12, padding: "18px 20px", borderRadius: 12, background: "var(--well)" }}>
          <Amount label="Due today" caption="When you sign the engagement terms." value={formatCents(totals.dueAtSigning, totals.currency)} emphasis />
          <Amount
            label="Due later, at filing (USPTO fees)"
            caption="Government filing fees, charged when your application is filed — not today."
            value={formatCents(totals.dueAtFiling, totals.currency)}
          />
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <Amount
              label="Full project cost"
              caption="The two amounts above added together. This is not an amount due today."
              value={formatCents(fullProjectCost(totals), totals.currency)}
              muted
            />
          </div>
        </div>

        {view.termsBody && (
          <div style={{ display: "grid", gap: 8, paddingTop: 18, borderTop: "1px solid var(--line-2)" }}>
            <span className="lx-label">Engagement terms</span>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.65, color: "var(--body)" }}>{view.termsBody}</p>
          </div>
        )}
      </article>

      <section className="lx-card" style={{ padding: "26px 24px", display: "grid", gap: 14 }}>
        <h2 className="lx-h2">Accept this proposal</h2>
        <p style={{ margin: 0, color: "var(--body)", fontSize: 15, lineHeight: 1.6 }}>
          {view.termsBody
            ? `Typing your name below signs the engagement terms above and the fees itemised with them, as your agreement with ${view.firm.name}.`
            : `Typing your name below signs this agreement with ${view.firm.name}.`}{" "}
          <strong style={{ fontWeight: 500 }}>Nothing is charged on this page.</strong> Your acceptance is recorded on{" "}
          {view.firm.name}&rsquo;s file.
        </p>

        <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          <label className="lx-field">
            <span className="lx-label">Full name</span>
            <input className="lx-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200} disabled={busy} />
          </label>
          <label className="lx-field">
            <span className="lx-label">Email</span>
            <input className="lx-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={320} disabled={busy} />
          </label>
        </div>

        <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
          <button type="button" className="lx-btn lx-btn-pri" onClick={accept} disabled={disabledReason !== null || busy} aria-describedby="accept-reason" style={{ height: 44, padding: "0 22px" }}>
            {accepting ? "Signing…" : "Accept and sign"}
          </button>
          {/* A live region, so the reason is announced when it changes. */}
          <p id="accept-reason" role="status" className="lx-note" style={{ margin: 0, minHeight: 20 }}>
            {disabledReason ?? ""}
          </p>
          {acceptError && (
            <p role="alert" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
              {acceptError}
            </p>
          )}
        </div>

        <p className="lx-note" style={{ margin: 0, fontSize: 12.5 }}>
          Your name, email address, IP address and browser are recorded with your acceptance as the signing record.
        </p>

        <div style={{ display: "grid", gap: 8, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}>
          {confirmDecline ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "var(--body)", fontSize: 14.5 }}>Decline this proposal? {view.firm.name} will see that you declined.</span>
              <button type="button" className="lx-btn lx-btn-danger lx-btn-sm" onClick={decline} disabled={busy}>
                {declining ? "Declining…" : "Yes, decline"}
              </button>
              <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setConfirmDecline(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" style={{ justifySelf: "start" }} onClick={() => setConfirmDecline(true)} disabled={busy}>
              Decline this proposal
            </button>
          )}
          {declineError && (
            <p role="alert" className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>
              {declineError}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

/* ── small pieces ─────────────────────────────────────────────────────────── */

function isSelectable(line: PublicQuoteLine): boolean {
  return line.selection === "optional" || line.selection === "tier_option";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <span className="lx-label">{title}</span>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </section>
  );
}

/** "charged later, at filing" / "no charge" — the timing a client needs to read
 * beside the figure. A government fee is always at filing (pricing.ts buckets
 * it there even if a row says otherwise). */
function timingNote(line: PublicQuoteLine): string | null {
  if (line.kind === "government_fee" || line.charge_at === "filing") return "charged later, at filing";
  if (line.charge_at === "not_charged") return "no charge";
  return null;
}

const rowBox: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  padding: "11px 13px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "var(--paper)",
};

function LineText({ line, suffix }: { line: PublicQuoteLine; suffix?: string }) {
  const note = timingNote(line);
  return (
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ color: "var(--ink)", fontWeight: 500, fontSize: 15 }}>{line.label}</span>
      {suffix && <span className="lx-note"> {suffix}</span>}
      {line.description && <span style={{ display: "block", fontSize: 13.5, color: "var(--body)", marginTop: 2, whiteSpace: "pre-wrap" }}>{line.description}</span>}
      {note && (
        <span className="lx-note" style={{ display: "block", fontSize: 12.5, marginTop: 2 }}>
          {note}
        </span>
      )}
    </span>
  );
}

function LineRow({ line, currency }: { line: PublicQuoteLine; currency: string }) {
  const included = isLineSelected(line as QuoteLineInput);
  return (
    <div style={rowBox}>
      <LineText line={line} suffix={included ? undefined : "— not included"} />
      <span className="lx-num" style={{ whiteSpace: "nowrap", color: "var(--ink)" }}>
        {formatCents(lineAmountCents(line as QuoteLineInput), currency)}
      </span>
    </div>
  );
}

function ChoiceRow(props: {
  type: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  line: PublicQuoteLine;
  currency: string;
}) {
  return (
    <label
      style={{
        ...rowBox,
        gap: 12,
        cursor: props.disabled ? "wait" : "pointer",
        borderColor: props.checked ? "var(--ox)" : "var(--line)",
        background: props.checked ? "rgba(106, 31, 43, 0.05)" : "var(--card)",
      }}
    >
      <input
        type={props.type}
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
        style={{ marginTop: 4, accentColor: "var(--ox)" }}
      />
      <LineText line={props.line} />
      <span className="lx-num" style={{ whiteSpace: "nowrap", color: "var(--ink)" }}>
        {formatCents(lineAmountCents(props.line as QuoteLineInput), props.currency)}
      </span>
    </label>
  );
}

function Amount(props: { label: string; caption: string; value: string; emphasis?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span>
        <span style={{ display: "block", fontSize: props.emphasis ? 16 : 14.5, fontWeight: 500, color: props.muted ? "var(--muted)" : "var(--ink)" }}>{props.label}</span>
        <span className="lx-note" style={{ display: "block", fontSize: 12.5, marginTop: 2 }}>
          {props.caption}
        </span>
      </span>
      <span
        className="lx-num"
        style={{
          whiteSpace: "nowrap",
          fontSize: props.emphasis ? 22 : 15,
          fontWeight: props.emphasis ? 700 : 400,
          color: props.muted ? "var(--muted)" : "var(--ink)",
        }}
      >
        {props.value}
      </span>
    </div>
  );
}

function acceptMessage(reason: string | undefined, message: string | undefined): string {
  switch (reason) {
    case "not_ready":
      return message ?? "Make your selections before signing.";
    case "invalid_name":
      return "Type your full name to sign.";
    case "invalid_email":
      return "Enter an email address we can send a copy to.";
    case "quote_changed":
      return "Nothing was signed: the amounts on this proposal changed while you had it open. Check the updated figures above, then sign again if you still agree.";
    case "terms_changed":
      return "Nothing was signed: the engagement terms changed while you had this open. Read the updated terms above, then sign again if you still agree.";
    case "unknown_line":
    case "invalid_tier":
    case "not_found":
      return "This proposal was updated while you had it open. Reload the page and check it before signing.";
    case "not_live":
      return "This proposal is no longer open for acceptance. Reload the page.";
    case "unconfigured":
    case "unavailable":
      return "We couldn't reach the firm's records just now. Nothing was signed — please try again in a moment.";
    default:
      return message ?? "We couldn't complete that just now. Nothing was signed.";
  }
}
