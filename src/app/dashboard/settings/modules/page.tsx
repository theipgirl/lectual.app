import Link from "next/link";
import { activeOrgModules } from "@/lib/org/modules";
import { MODULES } from "@/lib/settings/modules-copy";
import { FeedbackLink } from "@/components/feedback/SendFeedbackButton";
import { listConnections } from "@/lib/mailbox/connections";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { CONTACT_LECTUAL, FEATURES_NAME, FEATURES_SUBLINE_END, FEATURES_SUBLINE_START } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(FEATURES_NAME) };

export const dynamic = "force-dynamic";

/**
 * What's switched on for this firm. Read-only: crm_org.modules is Lectual's to
 * set (firms have no UPDATE policy on crm_org), because each module either
 * needs the firm's own setup or carries content written for one practice.
 * The copy for each is in `src/lib/settings/modules-copy.ts`.
 */
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
        <h1 className="lx-h1" data-tour="modules-head">{FEATURES_NAME}</h1>
        <p className="lx-sub">
          {FEATURES_SUBLINE_START} <FeedbackLink>{CONTACT_LECTUAL}</FeedbackLink> {FEATURES_SUBLINE_END}
        </p>
      </div>
      <section className="lx-card lx-int" aria-label={FEATURES_NAME}>
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
        Integrations with your own accounts, like Lawmatics, don&apos;t need to be switched on by Lectual: connect them in Integrations.
      </p>
    </>
  );
}
