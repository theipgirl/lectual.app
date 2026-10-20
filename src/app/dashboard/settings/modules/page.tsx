import Link from "next/link";
import { activeOrgModules, type OrgModule } from "@/lib/org/modules";
import { listConnections } from "@/lib/mailbox/connections";

export const dynamic = "force-dynamic";

/**
 * What's switched on for this firm. Read-only: crm_org.modules is Lectual's to
 * set (firms have no UPDATE policy on crm_org), because each module either
 * needs the firm's own setup or carries content written for one practice.
 * lectual-only modules (inbox, lawmatics-import) aren't listed: this app has
 * no surface behind them.
 */
const MODULES: Array<{ key: OrgModule; name: string; what: string }> = [
  { key: "mailbox", name: "Mailboxes", what: "Connect Gmail and Outlook, match client mail to leads and matters, and use My Mail." },
  { key: "agents", name: "Agents", what: "Scheduled agents that triage intake, pull client details from email and draft post-consult follow-ups into the approval queue." },
  { key: "document-center", name: "Document Center", what: "Generate engagement and opinion letters from your firm's templates, into the approval queue." },
  { key: "agent-toolkit", name: "Agent toolkit", what: "Welcome emails and filing follow-ups on matters, written in your firm's voice." },
  { key: "proposals", name: "Client proposals", what: "The trademark proposal a client reviews and accepts after their strategy call: brand names, marks and classes, approved by a named approver before it is sent." },
  { key: "litigation", name: "Litigation", what: "Litigation matters, with court case numbers, hearings and case details." },
];

type ModuleStatus = { label: string; tone: "ok" | "warn" | "risk" | "mute" };

/**
 * A switched-on Mailboxes module with nothing connected is not a working one,
 * and a failed read is neither "connected" nor "none". Counts only active
 * connections the caller can see: the firm's mailboxes plus their own.
 */
async function mailboxStatus(enabled: boolean): Promise<ModuleStatus & { connected: number | null }> {
  if (!enabled) return { label: "Off", tone: "mute", connected: null };
  const result = await listConnections().catch(() => ({ ok: false as const, error: "unreadable" }));
  if (!result.ok) return { label: "On · couldn't check connections", tone: "risk", connected: null };
  const connected = result.connections.filter((c) => c.status === "active").length;
  return connected > 0
    ? { label: `On · ${connected} connected`, tone: "ok", connected }
    : { label: "On · none connected", tone: "warn", connected };
}

export default async function ModulesPage() {
  const on = await activeOrgModules();
  const mailbox = await mailboxStatus(on.includes("mailbox"));
  return (
    <>
      <div>
        <div className="lx-label">Settings</div>
        <h1 className="lx-h1">Modules</h1>
        <p className="lx-sub">Parts of Lectual that are switched on firm by firm. To add one, contact Lectual and we&apos;ll set it up with you.</p>
      </div>
      <section className="lx-card lx-int" aria-label="Modules">
        {MODULES.map((m) => {
          const enabled = on.includes(m.key);
          const status: ModuleStatus = m.key === "mailbox" ? mailbox : { label: enabled ? "On" : "Off", tone: enabled ? "ok" : "mute" };
          return (
            <div key={m.key} className="lx-int-row">
              <div className="lx-int-summary">
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="lx-int-name">{m.name}</span>
                  <span className="lx-note" style={{ display: "block" }}>
                    {m.what}
                  </span>
                  {m.key === "mailbox" && enabled && (
                    <span className="lx-note" style={{ display: "block" }}>
                      Colleagues&apos; personal mailboxes are private to them, so this count is the firm&apos;s mailboxes plus your own.
                      {mailbox.connected === 0 && (
                        <>
                          {" "}
                          <Link href="/dashboard/settings/mailboxes/">Connect a mailbox</Link>
                        </>
                      )}
                    </span>
                  )}
                </span>
                <span className={`lx-pill lx-pill-${status.tone}`}>{status.label}</span>
              </div>
            </div>
          );
        })}
      </section>
      <p className="lx-note" style={{ margin: 0 }}>
        Integrations with your own accounts, like Lawmatics, don&apos;t need a module: connect them in Integrations.
      </p>
    </>
  );
}
