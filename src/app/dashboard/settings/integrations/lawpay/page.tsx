import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { relativeTime } from "@/lib/relative-time";
import { lawPayDeploymentMode, lawPaySetup } from "@/lib/payments/lawpay-config";
import { getLawPayConnection } from "@/lib/payments/lawpay-connection";
import { listLawPayMappings } from "@/lib/payments/accounts";
import { accountLabel, accountShortLabel, candidateAccounts } from "@/lib/payments/lawpay-accounts";
import { DisconnectLawPayButton, MapAccountForm, RefreshAccountsButton, UnmapButton } from "@/components/lawpay/LawPayForms";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { integrationErrorLine, LAWPAY_NOT_ISSUED, lawpayModeMismatch } from "@/lib/ui/words";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";

export const metadata: Metadata = { title: pageTitle("LawPay") };

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  unconfigured: "LawPay card payments aren't switched on yet, so nothing was connected. Until then, record payments by hand on each quote.",
  forbidden: `${ADMIN_TIER_PHRASE} can connect LawPay.`,
  denied: "LawPay sign-in was cancelled. Nothing was connected.",
  expired: "That LawPay sign-in expired or couldn't be verified. Start again with Connect LawPay.",
  "wrong-session": "You switched firm or account during LawPay sign-in, so nothing was connected. Start again from this firm.",
  "no-accounts": "LawPay didn't return any accounts Lectual can use for this merchant. Nothing was connected.",
  "save-failed": "LawPay accepted the sign-in, but the connection couldn't be saved. Try again.",
  failed: "Connecting LawPay didn't finish. Nothing was saved — try again.",
};

/**
 * Settings → Integrations → LawPay. Each firm connects ITS OWN LawPay account by
 * signing in to LawPay (OAuth) — never by pasting a key — and then chooses,
 * explicitly, which of its accounts is the OPERATING account (required for
 * clients to pay by card) and, optionally, which is the TRUST account.
 *
 * Owner / admin / senior_admin only: checked here and again in every action.
 * Staff below that see a short explanation, not the controls.
 */
export default async function LawPayPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; reconnected?: string; unmapped?: string; error?: string }>;
}) {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const canManage = hasRole(session.role, "senior_admin");
  const { connected, reconnected, unmapped, error } = await searchParams;

  const header = (
    <>
      <Link href="/dashboard/settings/integrations/" className="lx-back">
        ← Integrations
      </Link>
      <div>
        <div className="lx-label">Integrations</div>
        <h1 className="lx-h1">LawPay</h1>
        <p className="lx-sub">
          Let clients pay the amount due at signing by card, straight into your firm&apos;s own LawPay operating account. USPTO filing fees are
          never charged at signing.
        </p>
      </div>
    </>
  );

  if (!canManage) {
    return (
      <>
        {header}
        <section className="lx-card" style={{ padding: 18 }}>
          <p className="lx-note" style={{ margin: 0 }}>
            {ADMIN_TIER_PHRASE}{" "}can connect LawPay and choose the firm&apos;s payment accounts.
          </p>
        </section>
      </>
    );
  }

  const setup = lawPaySetup();
  const [read, mappings] = await Promise.all([getLawPayConnection(), listLawPayMappings()]);
  const conn = read.ok ? read.connection : null;
  const deploymentMode = lawPayDeploymentMode();
  const errorText = error ? (ERRORS[error] ?? ERRORS.failed) : null;
  const mapped = (kind: "operating" | "trust") => (mappings.status === "ok" ? mappings.rows.find((r) => r.account_kind === kind) ?? null : null);

  return (
    <>
      {header}

      {connected && (
        <div role="status" className="lx-banner lx-banner-ok">
          LawPay {reconnected ? "reconnected" : "connected"}.{" "}
          {unmapped ? `LawPay no longer lists the ${unmapped.replace(",", " and ")} account you had chosen — choose again below.` : "Now choose your operating account below."}
        </div>
      )}
      {errorText && (
        <div role="alert" className="lx-banner lx-banner-risk">
          {errorText}
        </div>
      )}
      {!read.ok && (
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t check your firm&apos;s LawPay connection just now. Refresh to try again.
        </div>
      )}

      <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-labelledby="lp-conn">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 id="lp-conn" className="lx-h2" style={{ fontSize: 23 }}>
              Connection
            </h2>
            <div className="lx-note">
              {conn
                ? `${conn.display_hint ?? "LawPay merchant"} · connected ${relativeTime(conn.created_at)}`
                : read.ok
                  ? "Not connected."
                  : "Status unknown."}
            </div>
          </div>
          {conn && <span className={`lx-pill ${conn.status === "active" ? "lx-pill-ok" : "lx-pill-risk"}`}>{conn.status === "active" ? "Connected" : "Reconnect"}</span>}
        </div>

        {conn && (
          <details className="lx-disclosure">
            <summary>Details</summary>
            <p className="lx-note" style={{ margin: "6px 0 0" }}>
              {conn.last_verified_at ? `Checked ${relativeTime(conn.last_verified_at)}. ` : ""}
              {conn.mode === "test" ? "Test mode: cards are charged against LawPay's test credentials, and no real money moves." : "Live mode: cards are charged for real."}
            </p>
          </details>
        )}
        {conn && conn.mode !== deploymentMode && (
          <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
            {lawpayModeMismatch(conn.mode, deploymentMode)}
          </p>
        )}
        {conn && conn.status !== "active" && (
          <p className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
            LawPay stopped accepting this connection. {integrationErrorLine(conn.status, conn.last_error)}{" "}Clients see &ldquo;the firm will send a way to
            pay&rdquo; until you reconnect.
          </p>
        )}

        {!setup.ready ? (
          <div style={{ display: "grid", gap: 8 }}>
            <span className="lx-btn lx-btn-pri" aria-disabled="true" style={{ opacity: 0.5, cursor: "not-allowed", justifySelf: "start" }}>
              Connect LawPay
            </span>
            <p className="lx-note" style={{ margin: 0 }}>
              {LAWPAY_NOT_ISSUED}{" "}You don&apos;t need to do anything, and you&apos;ll never be asked to paste a LawPay key.
            </p>
          </div>
        ) : !conn ? (
          <div style={{ display: "grid", gap: 8 }}>
            {/* A plain link: the flow is a series of top-level redirects. */}
            <a href="/api/lawpay/connect/" className="lx-btn lx-btn-pri" style={{ justifySelf: "start" }}>
              Connect LawPay
            </a>
            <p className="lx-note" style={{ margin: 0 }}>
              You&apos;ll sign in to LawPay and approve Lectual. Lectual never sees your LawPay password, and card numbers never touch Lectual.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {conn.status !== "active" && (
              <a href="/api/lawpay/connect/" className="lx-btn lx-btn-pri lx-btn-sm">
                Reconnect
              </a>
            )}
            <RefreshAccountsButton />
            <DisconnectLawPayButton merchant={conn.display_hint ?? "LawPay"} />
          </div>
        )}
      </section>

      {conn && conn.status === "active" && (
        <>
          {mappings.status !== "ok" && (
            <div role="alert" className="lx-banner lx-banner-risk">
              We couldn&apos;t read which accounts you chose. Try again shortly.
            </div>
          )}
          {mappings.status === "ok" && !mapped("operating") && (
            <div className="lx-banner lx-banner-warn">Clients can&apos;t pay by card until you choose the operating account.</div>
          )}
          {(["operating", "trust"] as const).map((kind) => {
            const current = mapped(kind);
            const choices = candidateAccounts(conn.accounts, kind, conn.mode).map((a) => ({ id: a.id, label: accountLabel(a) }));
            const currentAccount = current ? conn.accounts.find((a) => a.id === current.provider_account_id) : null;
            return (
              <section key={kind} className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-labelledby={`lp-${kind}`}>
                <div>
                  <h2 id={`lp-${kind}`} className="lx-h2" style={{ fontSize: 23 }}>
                    {kind === "operating" ? "Operating account" : "Trust (IOLTA) account"}{" "}
                    <span className="lx-note" style={{ fontSize: 13 }}>
                      {kind === "operating" ? "required" : "optional"}
                    </span>
                  </h2>
                  <p className="lx-note" style={{ margin: "4px 0 0" }}>
                    {kind === "operating"
                      ? "Where the amount due at signing goes. It's an earned flat fee, so it always goes to operating — never trust."
                      : "Lectual never charges a signing fee into trust. Choosing it here records which account it is, so nothing is ever mixed up."}{" "}
                    Only accounts LawPay lists as {kind === "trust" ? "trust" : "not trust"} are offered.
                  </p>
                </div>
                {current && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ flex: 1, minWidth: 200 }}>
                      <b style={{ color: "var(--ink)" }}>{currentAccount ? accountShortLabel(currentAccount) : "An account LawPay no longer lists"}</b>
                      <span className="lx-note" style={{ display: "block" }}>
                        {current.verified_at ? `Confirmed ${relativeTime(current.verified_at)}` : "Not confirmed"}
                        {currentAccount ? "" : " · no longer listed by LawPay"}
                      </span>
                      <details className="lx-disclosure">
                        <summary>Account details</summary>
                        <span className="lx-note" style={{ display: "block", margin: "6px 0 0" }}>
                          {currentAccount ? accountLabel(currentAccount) : `Account ···${current.provider_account_id.slice(-4)}`} · {conn.mode} mode
                        </span>
                      </details>
                    </span>
                    <UnmapButton kind={kind} />
                  </div>
                )}
                {choices.length > 0 ? (
                  <MapAccountForm kind={kind} choices={choices} current={current?.provider_account_id ?? null} />
                ) : (
                  <p className="lx-note" style={{ margin: 0 }}>
                    LawPay lists no {kind === "trust" ? "trust" : "non-trust"} account in {conn.mode} mode for this merchant.
                  </p>
                )}
              </section>
            );
          })}
        </>
      )}

      <p className="lx-upl" style={{ margin: 0 }}>
        {NOT_A_LAW_FIRM_DISCLAIMER}{" "}
        Which account a payment belongs in is your firm&apos;s decision; Lectual only follows the mapping you set here.
      </p>
    </>
  );
}
