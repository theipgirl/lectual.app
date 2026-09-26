import Link from "next/link";
import { notFound } from "next/navigation";
import { getQueueItem, type QueueItem } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { getScopedClient } from "@/lib/db/scoped-client";
import { QUEUE_APPROVE_ROLES, QUEUE_EDIT_ROLES, resolveQueueRole } from "@/lib/queue/roles";
import { QueueUnavailable } from "@/components/queue/QueueUnavailable";
import { ReviewPanel } from "@/components/queue/ReviewPanel";
import { STATUS_PILL, agentLabel, fmtWhen, isUnconfiguredError, outcomeText, typeLabel } from "@/components/queue/format";

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
  const [approveRole, editRole] = await Promise.all([
    resolveQueueRole(supabase, QUEUE_APPROVE_ROLES),
    resolveQueueRole(supabase, QUEUE_EDIT_ROLES),
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
          <section className="lx-card" style={{ padding: 20 }}>
            {resolved ? (
              <>
                <div className="lx-label" style={{ marginBottom: 8 }}>
                  {item.final_body && item.final_body !== item.draft_body ? "Final, as approved" : "Draft"}
                </div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, color: "var(--body)" }}>{item.final_body ?? item.draft_body}</div>
              </>
            ) : (
              <ReviewPanel id={item.id} initialBody={item.final_body ?? item.draft_body} canApprove={approveRole !== null} canEdit={editRole !== null} />
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
          <Meta label="Send at" value={item.proposed_send_at ? fmtWhen(item.proposed_send_at) : null} />
          <Meta label="Attachments" value={item.attachments?.length ? item.attachments.map((a) => a.name).join(", ") : null} />
          <Meta label="Queued" value={fmtWhen(item.created_at)} />
          {resolved && (
            <>
              <Meta label="Resolved" value={fmtWhen(item.resolved_at)} />
              <Meta label="By" value={item.resolved_by} />
              <Meta label="Note" value={item.resolution_note} />
            </>
          )}
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
