import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { getLawmaticsConnection } from "@/lib/lawmatics/connection";
import { listConnections } from "@/lib/mailbox/connections";
import { describeAvailability, type ConnectionCheck } from "@/lib/reconcile/availability";
import { canReconcile } from "@/lib/reconcile/roles";
import { ListHeader } from "@/components/list-page/ListHeader";
import { Explanation } from "@/components/reconcile/Explanation";
import { ReconcileScreen } from "@/components/reconcile/ReconcileScreen";
import "../intake.css";
import "./reconcile.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Reconcile stages") };

export const dynamic = "force-dynamic";
// Preview pulls the firm's Lawmatics book, and Apply moves leads one at a time.
export const maxDuration = 300;

async function lawmaticsCheck(): Promise<ConnectionCheck> {
  try {
    const read = await getLawmaticsConnection();
    if (!read.ok) return { ok: false };
    return { ok: true, active: read.connection?.status === "active" ? 1 : 0 };
  } catch {
    return { ok: false };
  }
}

async function mailboxCheck(): Promise<ConnectionCheck> {
  try {
    const read = await listConnections();
    if (!read.ok) return { ok: false };
    return { ok: true, active: read.connections.filter((c) => c.status === "active").length };
  } catch {
    return { ok: false };
  }
}

/**
 * Stage reconciliation (Intake). Owner, admin and senior admin only: any other role, and a signed-out
 * visitor, get the not-found page, which says nothing about what this page is. The two actions
 * behind it check the role again on every call.
 */
export default async function ReconcilePage() {
  const session = await resolveFirmSession({ signInNext: "/dashboard/intake/reconcile/" });
  if (session.kind !== "ok" || !canReconcile(session.role)) notFound();

  const [lawmatics, mailboxes] = await Promise.all([lawmaticsCheck(), mailboxCheck()]);

  return (
    <div className="intake-root">
      <div className="intake-content">
        <ListHeader
          title="Reconcile stages"
          tour="reconcile-head"
          sub="Check each lead's stage against your intake sheet, Lawmatics and synced mail, then move the ones you agree with."
        />
        <Explanation availability={describeAvailability(lawmatics, mailboxes)} />
        <ReconcileScreen />
      </div>
    </div>
  );
}
