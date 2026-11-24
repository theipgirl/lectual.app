import { LAWMATICS_LAST_SYNC_NOT_READY, LAWMATICS_NAME, LAWMATICS_SYNC_NOW, cantShow, integrationErrorLine, lawmaticsLastSync } from "@/lib/ui/words";
import { LoadFailedCard, Notice, PageHeader, Pill } from "@/components/ui";
import { getFirmTimeZone } from "@/lib/org/profile";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getLawmaticsConnection, getLawmaticsLastSync } from "@/lib/lawmatics/connection";
import { relativeTime } from "@/lib/relative-time";
import { orgHasModule } from "@/lib/org/modules";
import { loadLawmaticsCustomFields, loadLoeFieldsConfig } from "@/lib/proposals/loe-fields-load";
import { ClientsImport, ConnectLawmatics, DisconnectLawmatics, MattersImport, LawmaticsSyncNow } from "@/components/lawmatics/LawmaticsImport";
import { LoeFieldsForm } from "@/components/lawmatics/LoeFieldsForm";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";

export const metadata: Metadata = { title: pageTitle(LAWMATICS_NAME) };

export const dynamic = "force-dynamic";
/** "Sync from Lawmatics now" runs every step of the daily sync for the firm; the action gives it a 240 s budget. */
export const maxDuration = 300;

/**
 * Import from Lawmatics, using the firm's OWN token (lectual 0077). No module
 * gate: the token is the boundary, since a firm can only ever read the account
 * it connected. The role gate (owner/admin/senior_admin) is here for the page
 * and again in every action, because each action is its own POST.
 */
export default async function LawmaticsPage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const canManage = hasRole(session.role, "senior_admin");
  const read = await getLawmaticsConnection();
  const tz = await getFirmTimeZone();
  const conn = read.ok ? read.connection : null;
  const active = conn?.status === "active";
  // "Last complete daily sync": three states, and before lectual 0118 it says it isn't switched on yet.
  const lastSync = active ? await getLawmaticsLastSync() : null;
  const lastSyncLine =
    lastSync === null
      ? null
      : lastSync.status === "ok"
        ? lawmaticsLastSync(lastSync.value ? relativeTime(lastSync.value, undefined, tz) : null)
        : lastSync.status === "not-set-up"
          ? LAWMATICS_LAST_SYNC_NOT_READY
          : cantShow("the last daily sync");

  // "LOE fields" belongs to the proposals module and to the admin tier; for anyone else the section is not drawn.
  const showLoeFields = canManage && (await orgHasModule("proposals"));
  const [loeConfig, loeOptions] = showLoeFields ? await Promise.all([loadLoeFieldsConfig(), active ? loadLawmaticsCustomFields() : Promise.resolve(null)]) : [null, null];

  return (
    <>
      <PageHeader
        back={{ href: "/dashboard/settings/integrations/", label: "Integrations" }}
        title={LAWMATICS_NAME}
        sub={
          <>
            Bring your contacts and matters over from Lawmatics. Every run shows you exactly what will change before anything is written, and it only
            ever reads from Lawmatics.
          </>
        }
      />

      {!read.ok && (
        <LoadFailedCard role="alert" what="your Lawmatics connection" />
      )}

      <section className="lx-card lx-pad" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 className="lx-h2">
              Connection
            </h2>
            <div className="lx-note">
              {conn
                ? `Token ${conn.token_hint ?? ""} · connected ${relativeTime(conn.created_at, undefined, tz)}${conn.last_import_at ? ` · last import ${relativeTime(conn.last_import_at, undefined, tz)}` : ""}`
                : "Not connected."}
            </div>
          </div>
          {conn && (
            <Pill tone={active ? "ok" : "risk"}>{active ? "Connected" : "Reconnect"}</Pill>
          )}
          {conn && canManage && <DisconnectLawmatics />}
        </div>
        {conn && !active && (
          <Notice tone="risk">Lawmatics stopped accepting this token. Paste a new one to keep importing.</Notice>
        )}
        {conn?.last_error && active && <p className="lx-note lxi-help-problem" style={{ margin: 0 }}>{integrationErrorLine(conn.status, conn.last_error)}</p>}
        {canManage ? (
          (!conn || !active) && <ConnectLawmatics reconnect={!!conn} />
        ) : (
          <p className="lx-note" style={{ margin: 0 }}>{ADMIN_TIER_PHRASE} can connect Lawmatics and run imports.</p>
        )}
        {canManage && conn && active && (
          <details className="lx-disclosure-inline">
            <summary>Replace token</summary>
            <ConnectLawmatics reconnect />
          </details>
        )}
      </section>

      {canManage && active && (
        <>
          <section className="lx-card lx-pad" style={{ display: "grid", gap: 12 }}>
            <div>
              <h2 className="lx-h2">
                Clients
              </h2>
              <p className="lx-note" style={{ margin: 0 }}>
                Lawmatics records become leads. Anyone already here is matched by Lawmatics id, then email, and updated rather than duplicated.
              </p>
            </div>
            <ClientsImport />
          </section>
          <section className="lx-card lx-pad" style={{ display: "grid", gap: 12 }}>
            <h2 className="lx-h2">
              Matters
            </h2>
            <MattersImport />
          </section>
          <section className="lx-card lx-pad" style={{ display: "grid", gap: 12 }}>
            <h2 className="lx-h2">
              {LAWMATICS_SYNC_NOW}
            </h2>
            {lastSyncLine && (
              <p className="lx-note" role="status" style={{ margin: 0 }}>
                {lastSyncLine}
              </p>
            )}
            <LawmaticsSyncNow />
          </section>
        </>
      )}

      {showLoeFields && loeConfig && (
        <details className="lx-card lx-disclosure lx-advanced">
          <summary>Advanced</summary>
        <section className="lx-card lx-pad" style={{ display: "grid", gap: 12 }} aria-label="LOE fields">
          <div>
            <h2 className="lx-h2">
              LOE fields
            </h2>
            <p className="lx-note" style={{ margin: 0 }}>
              Off unless you switch it on. When a proposal is marked paid, the engagement letter&apos;s figures are written to the matter&apos;s custom fields in
              Lawmatics, so a Lawmatics automation can build the e-sign draft from them. The legal fee and the USPTO fees go in separate fields. Nothing here moves a
              stage or sends anything.
            </p>
          </div>
          {loeConfig.status === "unavailable" ? (
            <Notice tone="risk" role="alert">
              We couldn&apos;t read your proposal settings. Refresh to try again.
            </Notice>
          ) : (
            <>
              {loeOptions === null && (
                <Notice tone="warn">
                  {active
                    ? "Your Lawmatics custom fields couldn't be loaded just now. Your saved matches are kept; only the switch can be changed until the list loads."
                    : "Connect Lawmatics above to pick from your custom fields. Your saved matches are kept."}
                </Notice>
              )}
              <LoeFieldsForm config={loeConfig.config} options={loeOptions} />
            </>
          )}
        </section>
        </details>
      )}
    </>
  );
}
