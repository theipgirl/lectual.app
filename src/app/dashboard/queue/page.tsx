import Link from "next/link";
import { loadActiveQueue } from "@/lib/queue/load";
import { QueueUnavailable } from "@/components/queue/QueueUnavailable";
import { STATUS_PILL, agentLabel, fmtWhen, parseQueueStatus, preview, typeLabel, type QueueStatus } from "@/components/queue/format";

const TABS: { status: QueueStatus; label: string }[] = [
  { status: "pending", label: "Waiting on you" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
];

const EMPTY: Record<QueueStatus, { title: string; body: string }> = {
  pending: { title: "All caught up", body: "Nothing is waiting for review. New drafts from the agents land here." },
  approved: { title: "Nothing approved yet", body: "Approved drafts show up here once something has been reviewed." },
  rejected: { title: "Nothing rejected", body: "Rejected drafts and their notes show up here." },
};

/**
 * The approval queue: the only way anything reaches a client. Holds no data
 * of its own — reads go to the lawmatics-mcp queue API through
 * @/lib/queue/load, which returns ok / unconfigured / unavailable and never a
 * bare empty list, so an outage can't pass for "all caught up".
 */
export default async function QueuePage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const status = parseQueueStatus((await searchParams).status);
  const load = await loadActiveQueue(status);

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Review</div>
          <h1 className="lx-h1">Approval queue</h1>
          <p className="lx-sub">
            Everything an agent drafted for a client, newest first. Approving puts the message in a mail client for a
            person to send — nothing reaches a client on its own.
          </p>
        </div>
        <nav aria-label="Queue status" className="lx-segs">
          {TABS.map((t) => (
            <Link key={t.status} href={`/dashboard/queue/?status=${t.status}`} aria-current={t.status === status ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {load.status !== "ok" ? (
        <QueueUnavailable status={load.status} reason={load.reason} />
      ) : load.items.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {EMPTY[status].title}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {EMPTY[status].body}
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl">
            <thead>
              <tr>
                <th>Draft</th>
                <th>Client</th>
                <th>From</th>
                <th>Status</th>
                <th>Queued</th>
              </tr>
            </thead>
            <tbody>
              {load.items.map((item) => (
                <tr key={item.id}>
                  <td className="wrap pri">
                    <Link href={`/dashboard/queue/${item.id}/`} className="lx-rowlink">
                      {item.headline}
                    </Link>
                    <div className="lx-note">
                      {typeLabel(item.type)} · {preview(item, 90)}
                    </div>
                  </td>
                  <td>{item.client_name ?? "—"}</td>
                  <td>{agentLabel(item.agent)}</td>
                  <td>
                    <span className={`lx-pill ${STATUS_PILL[item.status].tone}`}>{STATUS_PILL[item.status].label}</span>
                  </td>
                  <td className="lx-num">{fmtWhen(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
