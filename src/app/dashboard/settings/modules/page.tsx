import { activeOrgModules, type OrgModule } from "@/lib/org/modules";

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
  { key: "litigation", name: "Litigation", what: "Litigation matters, with court case numbers, hearings and case details." },
];

export default async function ModulesPage() {
  const on = await activeOrgModules();
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
          return (
            <div key={m.key} className="lx-int-row">
              <div className="lx-int-summary">
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="lx-int-name">{m.name}</span>
                  <span className="lx-note" style={{ display: "block" }}>
                    {m.what}
                  </span>
                </span>
                <span className={`lx-pill ${enabled ? "lx-pill-ok" : "lx-pill-mute"}`}>{enabled ? "On" : "Off"}</span>
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
