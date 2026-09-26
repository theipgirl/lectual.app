import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getLawmaticsConnection } from "@/lib/lawmatics/connection";
import { relativeTime } from "@/lib/relative-time";
import { ClientsImport, ConnectLawmatics, DisconnectLawmatics, MattersImport } from "@/components/lawmatics/LawmaticsImport";

export const dynamic = "force-dynamic";

/**
 * Import from Lawmatics, using the firm's OWN token (lectual 0059). No module
 * gate: the token is the boundary, since a firm can only ever read the account
 * it connected. The role gate (owner/admin/senior_admin) is here for the page
 * and again in every action, because each action is its own POST.
 */
export default async function LawmaticsPage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const canManage = hasRole(session.role, "senior_admin");
  const read = await getLawmaticsConnection();
  const conn = read.ok ? read.connection : null;
  const active = conn?.status === "active";

  return (
    <>
      <Link href="/dashboard/settings/integrations/" className="lx-back">
        ← Integrations
      </Link>
      <div>
        <div className="lx-label">Integrations</div>
        <h1 className="lx-h1">Import from Lawmatics</h1>
        <p className="lx-sub">
          Bring your contacts and matters over from Lawmatics. Every run shows you exactly what will change before anything is written, and it only
          ever reads from Lawmatics.
        </p>
      </div>

      {!read.ok && (
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t check your firm&apos;s Lawmatics connection. Try again shortly.
        </div>
      )}

      <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 className="lx-h2" style={{ fontSize: 23 }}>
              Connection
            </h2>
            <div className="lx-note">
              {conn
                ? `Token ${conn.token_hint ?? ""} · connected ${relativeTime(conn.created_at)}${conn.last_import_at ? ` · last import ${relativeTime(conn.last_import_at)}` : ""}`
                : "Not connected."}
            </div>
          </div>
          {conn && (
            <span className={`lx-pill ${active ? "lx-pill-ok" : "lx-pill-risk"}`}>{active ? "Connected" : "Reconnect"}</span>
          )}
          {conn && canManage && <DisconnectLawmatics />}
        </div>
        {conn && !active && (
          <p className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
            Lawmatics stopped accepting this token. Paste a new one to keep importing.
          </p>
        )}
        {conn?.last_error && active && <p className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>Last run: {conn.last_error}</p>}
        {canManage ? (
          (!conn || !active) && <ConnectLawmatics reconnect={!!conn} />
        ) : (
          <p className="lx-note" style={{ margin: 0 }}>Owners and admins connect Lawmatics and run imports.</p>
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
          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
            <div>
              <h2 className="lx-h2" style={{ fontSize: 23 }}>
                Clients
              </h2>
              <p className="lx-note" style={{ margin: "4px 0 0" }}>
                Lawmatics records become leads. Anyone already here is matched by Lawmatics id, then email, and updated rather than duplicated.
              </p>
            </div>
            <ClientsImport />
          </section>
          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
            <h2 className="lx-h2" style={{ fontSize: 23 }}>
              Matters
            </h2>
            <MattersImport />
          </section>
        </>
      )}
    </>
  );
}
