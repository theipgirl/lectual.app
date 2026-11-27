import { notFound } from "next/navigation";
import { resolveViewSession } from "@/lib/views/view-as";
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
import { LoadFailedCard, Notice, PageHeader, Pill } from "@/components/ui";
import { getFirmTimeZone } from "@/lib/org/profile";

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
  const session = await resolveViewSession();
  if (session.kind !== "ok") notFound();
  const canManage = hasRole(session.role, "senior_admin");
  const { connected, reconnected, unmapped, error } = await searchParams;

  const tz = await getFirmTimeZone();
  const header = (
    <PageHeader
      back={{ href: "/dashboard/settings/integrations/", label: "Integrations" }}
      title="LawPay"
      sub={
        <>
          Let clients pay the amount due at signing by card, straight into your firm&apos;s own LawPay operating account. USPTO filing fees are
          never charged at signing.
        </>
      }
    />
  );

  if (!canManage) {
    return (
      <>
        {header}
        <section className="lx-card lx-pad">
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
        <Notice tone="ok" role="status">
          LawPay {reconnected ? "reconnected" : "connected"}.{" "}
          {unmapped ? `LawPay no longer lists the ${unmapped.replace(",", " and ")} account you had chosen — choose again below.` : "Now choose your operating account below."}
        </Notice>
      )}
      {errorText && (
        <Notice tone="risk" role="alert">
          {errorText}
        </Notice>
      )}
      {!read.ok && (
        <LoadFailedCard role="alert" what="your LawPay connection" />
      )}

      <section className="lx-card lx-pad" style={{ display: "grid", gap: 12 }} aria-labelledby="lp-conn">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 id="lp-conn" className="lx-h2">
              Connection
            </h2>
            <div className="lx-note">
              {conn
                ? `${conn.display_hint ?? "LawPay merchant"} · connected ${relativeTime(conn.created_at, undefined, tz)}`
                : read.ok
                  ? "Not connected."
                  : "Status unknown."}
            </div>
          </div>
          {conn && <Pill tone={conn.status === "active" ? "ok" : "risk"}>{conn.status === "active" ? "Connected" : "Reconnect"}</Pill>}
        </div>

        {conn && (
          <details className="lx-disclosure">
            <summary>Details</summary>
            <p className="lx-note" style={{ margin: 0 }}>
              {conn.last_verified_at ? `Checked ${relativeTime(conn.last_verified_at, undefined, tz)}. ` : ""}
              {conn.mode === "test" ? "Test mode: cards are charged against LawPay's test credentials, and no real money moves." : "Live mode: cards are charged for real."}
            </p>
          </details>
        )}
        {conn && conn.mode !== deploymentMode && (
          <Notice tone="warn">{lawpayModeMismatch(conn.mode, deploymentMode)}</Notice>
        )}
        {conn && conn.status !== "active" && (
          <Notice tone="risk">
            LawPay stopped accepting this connection. {integrationErrorLine(conn.status, conn.last_error)}{" "}Clients see &ldquo;the firm will send a way to
            pay&rdquo; until you reconnect.
          </Notice>
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
            <Notice tone="risk" role="alert">
              We couldn&apos;t read which accounts you chose. Refresh to try again.
            </Notice>
          )}
          {mappings.status === "ok" && !mapped("operating") && (
            <Notice tone="warn">Clients can&apos;t pay by card until you choose the operating account.</Notice>
          )}
          {(["operating", "trust"] as const).map((kind) => {
            const current = mapped(kind);
            const choices = candidateAccounts(conn.accounts, kind, conn.mode).map((a) => ({ id: a.id, label: accountLabel(a) }));
            const currentAccount = current ? conn.accounts.find((a) => a.id === current.provider_account_id) : null;
            return (
              <section key={kind} className="lx-card lx-pad" style={{ display: "grid", gap: 12 }} aria-labelledby={`lp-${kind}`}>
                <div>
                  <h2 id={`lp-${kind}`} className="lx-h2">
                    {kind === "operating" ? "Operating account" : "Trust (IOLTA) account"}{" "}
                    <span className="lx-note">
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
                        {current.verified_at ? `Confirmed ${relativeTime(current.verified_at, undefined, tz)}` : "Not confirmed"}
                        {currentAccount ? "" : " · no longer listed by LawPay"}
                      </span>
                      <details className="lx-disclosure">
                        <summary>Account details</summary>
                        <span className="lx-note" style={{ display: "block" }}>
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
