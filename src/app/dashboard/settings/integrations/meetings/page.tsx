import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { listMeetingConnections, type MeetingConnection } from "@/lib/meetings/connection";
import { fathomReady, zoomSetup } from "@/lib/meetings/config";
import { relativeTime } from "@/lib/relative-time";
import { ConnectFathomForm, DisconnectSourceButton, ImportNowButton } from "@/components/meetings/MeetingForms";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  forbidden: "Only owners and admins can connect Zoom.",
  unconfigured: "Zoom sign-in isn't set up on this deployment yet.",
  denied: "Zoom sign-in was cancelled. Nothing was connected.",
  expired: "That sign-in took too long or was started elsewhere. Try again.",
  "wrong-session": "You switched account or firm during sign-in, so nothing was connected. Try again.",
  "save-failed": "Zoom signed you in, but we couldn't save the connection. Try again.",
  failed: "Zoom sign-in didn't complete. Try again.",
};

function StatusLine({ c }: { c: MeetingConnection }) {
  return (
    <div className="lx-note">
      {c.account_hint ?? "Connected"} · connected {relativeTime(c.created_at)}
      {c.last_import_at ? ` · last import ${relativeTime(c.last_import_at)}` : " · not imported yet"}
    </div>
  );
}

/**
 * Settings → Integrations → Meetings. Each firm connects ITS OWN Fathom
 * account (API key) or Zoom account (sign-in); there is no deployment-wide
 * credential, so no module gate (lectual 0081). The role gate
 * (owner/admin/senior_admin) is here for the controls and again in every action.
 */
export default async function MeetingsIntegrationPage({ searchParams }: { searchParams: Promise<{ connected?: string; reconnected?: string; error?: string }> }) {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const canManage = hasRole(session.role, "senior_admin");
  const { connected, reconnected, error } = await searchParams;
  const read = await listMeetingConnections();
  const conns = read.ok ? read.connections : [];
  const fathom = conns.find((c) => c.provider === "fathom") ?? null;
  const zoom = conns.find((c) => c.provider === "zoom") ?? null;
  const zoomReady = zoomSetup().ready;
  const canSeal = fathomReady();

  return (
    <>
      <Link href="/dashboard/settings/integrations/" className="lx-back">
        ← Integrations
      </Link>
      <div>
        <div className="lx-label">Integrations</div>
        <h1 className="lx-h1">Meetings</h1>
        <p className="lx-sub">
          Bring your consult recordings from Fathom or Zoom into Lectual: summary, transcript and who was on the call, filed on the client&apos;s lead or
          matter. Lectual only reads from these accounts.
        </p>
      </div>

      {connected === "zoom" && (
        <div role="status" className="lx-banner lx-banner-ok">
          Zoom {reconnected ? "reconnected" : "connected"}. Import your recent meetings below.
        </div>
      )}
      {error && ERRORS[error] && (
        <div role="alert" className="lx-banner lx-banner-risk">
          {ERRORS[error]}
        </div>
      )}
      {!read.ok && (
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t check your firm&apos;s meeting connections. Try again shortly.
        </div>
      )}

      <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-labelledby="fathom-title">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 id="fathom-title" className="lx-h2" style={{ fontSize: 23 }}>
              Fathom
            </h2>
            {fathom ? <StatusLine c={fathom} /> : <div className="lx-note">Not connected.</div>}
          </div>
          {fathom && <span className={`lx-pill ${fathom.status === "active" ? "lx-pill-ok" : "lx-pill-risk"}`}>{fathom.status === "active" ? "Connected" : "Reconnect"}</span>}
          {fathom && canManage && <DisconnectSourceButton provider="fathom" label="Fathom" />}
        </div>
        {fathom?.status === "reauth" && (
          <p className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
            Fathom stopped accepting this key. Paste a new one to keep importing.
          </p>
        )}
        {fathom?.last_error && fathom.status === "active" && (
          <p className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>
            Last run: {fathom.last_error}
          </p>
        )}
        {!canManage ? (
          <p className="lx-note" style={{ margin: 0 }}>Owners and admins connect Fathom and run imports.</p>
        ) : !canSeal ? (
          <p className="lx-note" style={{ margin: 0 }}>Not available yet: this deployment has no encryption key for stored credentials.</p>
        ) : fathom?.status === "active" ? (
          <>
            <ImportNowButton provider="fathom" />
            <details className="lx-disclosure-inline">
              <summary>Replace key</summary>
              <ConnectFathomForm reconnect />
            </details>
          </>
        ) : (
          <>
            <p className="lx-note" style={{ margin: 0 }}>
              In Fathom, open <b>Settings → API Access</b> and generate a key. The key sees the meetings its owner recorded or that were shared with
              them or their team, so generate it from the account that records your consults.
            </p>
            <ConnectFathomForm reconnect={!!fathom} />
          </>
        )}
      </section>

      <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-labelledby="zoom-title">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 id="zoom-title" className="lx-h2" style={{ fontSize: 23 }}>
              Zoom
            </h2>
            {zoom ? <StatusLine c={zoom} /> : <div className="lx-note">Not connected.</div>}
          </div>
          {zoom && <span className={`lx-pill ${zoom.status === "active" ? "lx-pill-ok" : "lx-pill-risk"}`}>{zoom.status === "active" ? "Connected" : "Reconnect"}</span>}
          {zoom && canManage && <DisconnectSourceButton provider="zoom" label="Zoom" />}
        </div>
        {zoom?.last_error && (
          <p className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>
            {zoom.status === "active" ? "Last run: " : ""}
            {zoom.last_error}
          </p>
        )}
        {!zoomReady ? (
          <p className="lx-note" style={{ margin: 0 }}>
            Not available yet — Lectual&apos;s Zoom sign-in isn&apos;t set up on this deployment. Fathom works today.
          </p>
        ) : !canManage ? (
          <p className="lx-note" style={{ margin: 0 }}>Owners and admins connect Zoom and run imports.</p>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
            {zoom?.status === "active" && <ImportNowButton provider="zoom" />}
            {zoom?.status !== "active" && (
              <a href="/api/meetings/zoom/connect/" className="lx-btn lx-btn-pri lx-btn-sm">
                {zoom ? "Reconnect Zoom" : "Connect Zoom"}
              </a>
            )}
          </div>
        )}
        <p className="lx-note" style={{ margin: 0 }}>
          Imports cloud recordings of meetings the signed-in Zoom user hosted, with their transcript once Zoom has made one (cloud recording and
          audio transcripts must be on in Zoom).
        </p>
      </section>

      <section className="lx-card lx-facts">
        <div>
          <div className="lx-label">What we store</div>
          <p>Title, time, who attended (names and emails), the summary and the transcript. Recordings stay in Fathom or Zoom; we keep a link.</p>
        </div>
        <div>
          <div className="lx-label">Who sees it</div>
          <p>Your firm&apos;s members only. Transcripts are privileged client content and never leave your firm&apos;s workspace.</p>
        </div>
        <div>
          <div className="lx-label">How often</div>
          <p>Once a day automatically, or whenever an admin presses Import. A meeting is filed on a client when exactly one lead or matter shares an attendee&apos;s email.</p>
        </div>
      </section>
    </>
  );
}
