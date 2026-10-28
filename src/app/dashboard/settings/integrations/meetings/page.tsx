import { integrationErrorLine } from "@/lib/ui/words";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { listMeetingConnections, type MeetingConnection } from "@/lib/meetings/connection";
import { fathomReady, zoomSetup } from "@/lib/meetings/config";
import { relativeTime } from "@/lib/relative-time";
import { ConnectFathomForm, DisconnectSourceButton, ImportNowButton } from "@/components/meetings/MeetingForms";
import { HelpText } from "@/components/integrations/HelpText";
import { IntegrationHeader } from "@/components/integrations/IntegrationHeader";
import { stateForStatus, type IntegrationState } from "@/components/integrations/states";
import { ZOOM_NOT_SWITCHED_ON } from "@/lib/integrations/copy";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Meetings integration") };

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  forbidden: "Only owners and admins can connect Zoom.",
  unconfigured: "Zoom isn't switched on for your firm yet. Lectual will turn it on.",
  denied: "Zoom sign-in was cancelled. Nothing was connected.",
  expired: "That sign-in took too long or was started elsewhere. Try again.",
  "wrong-session": "You switched account or firm during sign-in, so nothing was connected. Try again.",
  "save-failed": "Zoom signed you in, but we couldn't save the connection. Try again.",
  failed: "Zoom sign-in didn't complete. Try again.",
};

function statusLine(c: MeetingConnection): string {
  return `${c.account_hint ?? "Connected"} · connected ${relativeTime(c.created_at)}${
    c.last_import_at ? ` · last import ${relativeTime(c.last_import_at)}` : " · not imported yet"
  }`;
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
  // A failed read is "couldn't check", never "not connected".
  const fathomState: IntegrationState = fathom ? stateForStatus(fathom.status) : read.ok ? "not-connected" : "couldnt-check";
  const zoomState: IntegrationState = zoom ? stateForStatus(zoom.status) : !zoomReady ? "not-available" : read.ok ? "not-connected" : "couldnt-check";

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

      <section className="lx-card lxi-card" aria-labelledby="fathom-title">
        <IntegrationHeader
          id="fathom-title"
          title="Fathom"
          state={fathomState}
          help={fathom ? statusLine(fathom) : read.ok ? "Not connected." : "We couldn't check this connection just now."}
        >
          {fathom && canManage && <DisconnectSourceButton provider="fathom" label="Fathom" />}
        </IntegrationHeader>
        {fathom?.status === "reauth" && (
          <p className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
            Fathom stopped accepting this key. Paste a new one to keep importing.
          </p>
        )}
        {fathom?.last_error && fathom.status === "active" && (
          <HelpText tone="problem">{integrationErrorLine(fathom.status, fathom.last_error)}</HelpText>
        )}
        {!canManage ? (
          <HelpText>Owners and admins connect Fathom and run imports.</HelpText>
        ) : !canSeal ? (
          <HelpText>Not available yet. Lectual will turn it on.</HelpText>
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
            <HelpText>
              In Fathom, open <b>Settings → API Access</b> and generate a key. The key sees the meetings its owner recorded or that were shared with
              them or their team, so generate it from the account that records your consults.
            </HelpText>
            <ConnectFathomForm reconnect={!!fathom} />
          </>
        )}
      </section>

      <section className="lx-card lxi-card" aria-labelledby="zoom-title">
        <IntegrationHeader
          id="zoom-title"
          title="Zoom"
          state={zoomState}
          help={zoom ? statusLine(zoom) : read.ok ? "Not connected." : "We couldn't check this connection just now."}
        >
          {zoom && canManage && <DisconnectSourceButton provider="zoom" label="Zoom" />}
        </IntegrationHeader>
        {zoom?.last_error && <HelpText tone="problem">{integrationErrorLine(zoom.status, zoom.last_error)}</HelpText>}
        {!zoomReady ? (
          <HelpText>{ZOOM_NOT_SWITCHED_ON}</HelpText>
        ) : !canManage ? (
          <HelpText>Owners and admins connect Zoom and run imports.</HelpText>
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
        <HelpText>
          Imports cloud recordings of meetings the signed-in Zoom user hosted, with their transcript once Zoom has made one (cloud recording and
          audio transcripts must be on in Zoom).
        </HelpText>
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
