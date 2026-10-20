import Link from "next/link";
import { notFound } from "next/navigation";
import { getQueueItem, type QueueItem } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { getScopedClient } from "@/lib/db/scoped-client";
import { QUEUE_APPROVE_ROLES, QUEUE_EDIT_ROLES, resolveQueueRole } from "@/lib/queue/roles";
import { QueueUnavailable } from "@/components/queue/QueueUnavailable";
import { ReviewPanel } from "@/components/queue/ReviewPanel";
import { getFirmTimeZone } from "@/lib/org/profile";
import { STATUS_PILL, agentLabel, fmtWhen, isUnconfiguredError, outcomeText, typeLabel } from "@/components/queue/format";
import { checkDraftStaleness, type StaleCheck } from "@/lib/queue/stale";
import { staleWarning } from "@/components/queue/stale-warning";
import { Markdown } from "@/components/markdown/Markdown";
import { LinkedProposalPanel } from "@/components/queue/LinkedProposalPanel";
import { loadLinkedPanel } from "@/lib/consult-proposal/link";
import { loadAuditContext } from "@/lib/queue/audit-context";

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="lx-meta">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default async function QueueItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ resolved?: string; send?: string }>;
}) {
  const { id } = await params;
  const { resolved: justResolved, send } = await searchParams;

  // Outside the try on purpose: notFound() throws a control-flow error that a
  // catch would turn into "couldn't reach the queue" (a lesson from lectual).
  const qKey = await activeQueueOrgKey();
  if (!qKey) notFound();

  let item: QueueItem | null = null;
  let loadError: unknown = null;
  try {
    item = await getQueueItem(qKey, id);
  } catch (err) {
    loadError = err;
  }

  const supabase = await getScopedClient();
  const [approveRole, editRole, tz] = await Promise.all([
    resolveQueueRole(supabase, QUEUE_APPROVE_ROLES),
    resolveQueueRole(supabase, QUEUE_EDIT_ROLES),
    getFirmTimeZone(),
  ]);

  const back = (
    <Link href="/dashboard/queue/" className="lx-back">
      ← Approval queue
    </Link>
  );
  if (loadError) {
    return (
      <>
        {back}
        <QueueUnavailable status={isUnconfiguredError(loadError) ? "unconfigured" : "unavailable"} reason="env" />
      </>
    );
  }
  if (!item) notFound();

  const outcome = outcomeText(justResolved, send);
  const resolved = item.status !== "pending";

  // SOP §2.5: has this client signed, paid or become a client since the
  // draft was queued? Never auto-rejects — a person decides, with the fact in
  // front of them, and the action re-checks before it approves.
  const stale = resolved ? ({ status: "not_applicable" } as StaleCheck) : await checkDraftStaleness(item);
  const warning = staleWarning(stale, tz);
  // The proposal the consult agent drafted with this email, if any.
  const linkedProposal = await loadLinkedPanel(item.id);
  // Who signed it, and what is still left in it, is only worth checking while it can still be approved.
  const auditContext = resolved ? null : await loadAuditContext();

  return (
    <>
      {back}
      <div className="lx-split">
        <div className="lx-col">
          {outcome && (
            <div role="status" className={`lx-banner lx-banner-${outcome.tone === "ok" ? "ok" : outcome.tone === "risk" ? "risk" : "mute"}`}>
              {outcome.text}
            </div>
          )}
          <div>
            <div className="lx-label">
              {typeLabel(item.type)} · {agentLabel(item.agent)}
            </div>
            <h1 className="lx-h1" style={{ fontSize: 32 }}>
              {item.headline}
            </h1>
          </div>
          {warning && (
            <div
              role="alert"
              className={`lx-banner ${stale.status === "stale" ? "lx-banner-risk" : "lx-banner-warn"}`}
              style={{ display: "grid", gap: 6 }}
            >
              <strong style={{ fontSize: 16 }}>{warning.headline}</strong>
              <span>{warning.detail}</span>
              {stale.status !== "unavailable" && "leadIds" in stale && stale.leadIds[0] && (
                <Link href={`/dashboard/leads/${stale.leadIds[0]}/`}>Open {stale.leadName ?? "the lead"}</Link>
              )}
            </div>
          )}
          {stale.status === "unlinked" && (
            <p className="lx-note" style={{ margin: 0 }}>
              This draft isn&apos;t linked to a lead, so Lectual couldn&apos;t check whether the client has signed or paid since it
              was queued. Check before approving.
            </p>
          )}
          <section className="lx-card" style={{ padding: 20 }}>
            {resolved ? (
              <>
                <div className="lx-label" style={{ marginBottom: 8 }}>
                  {item.final_body && item.final_body !== item.draft_body ? "Final, as approved" : "Draft"}
                </div>
                <Markdown text={item.final_body ?? item.draft_body} />
              </>
            ) : (
              <ReviewPanel
                id={item.id}
                initialBody={item.final_body ?? item.draft_body}
                canApprove={approveRole !== null}
                canEdit={editRole !== null}
                confirmStale={warning ? warning.confirm : null}
                audit={auditContext ? { type: item.type, ...auditContext } : undefined}
              />
            )}
          </section>
        </div>
        <aside className="lx-card lx-aside">
          <span className={`lx-pill ${STATUS_PILL[item.status].tone}`} style={{ justifySelf: "start" }}>
            {STATUS_PILL[item.status].label}
          </span>
          <Meta label="Client" value={item.client_name} />
          <Meta label="To" value={item.recipient} />
          <Meta label="Subject" value={item.subject} />
          <Meta label="Send at" value={item.proposed_send_at ? fmtWhen(item.proposed_send_at, tz) : null} />
          <Meta label="Attachments" value={item.attachments?.length ? item.attachments.map((a) => a.name).join(", ") : null} />
          <Meta label="Queued" value={fmtWhen(item.created_at, tz)} />
          {resolved && (
            <>
              <Meta label="Resolved" value={fmtWhen(item.resolved_at, tz)} />
              <Meta label="By" value={item.resolved_by} />
              <Meta label="Note" value={item.resolution_note} />
            </>
          )}
          <LinkedProposalPanel panel={linkedProposal} pending={!resolved} />
          {item.summary && (
            <div>
              <div className="lx-label" style={{ fontSize: 11, marginBottom: 4 }}>
                For the reviewer
              </div>
              <p className="lx-note" style={{ margin: 0, color: "var(--body)" }}>
                {item.summary}
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
