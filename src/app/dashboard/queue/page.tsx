import Link from "next/link";
import { loadActiveQueue } from "@/lib/queue/load";
import { QueueUnavailable } from "@/components/queue/QueueUnavailable";
import { getFirmTimeZone } from "@/lib/org/profile";
import { markNearDuplicates } from "@/lib/queue/hygiene";
import { loadQueueViewContext } from "@/lib/queue/view-context";
import { classifyQueueItem, countsByPerson, filterByWho, kindLabel, ownerText, parseWho } from "@/lib/queue/routing";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { dismissableFollowups } from "@/lib/queue/dismiss";
import { PersonSwitch } from "@/components/queue/PersonSwitch";
import { DismissFollowups } from "@/components/queue/DismissFollowups";
import { STATUS_PILL, agentLabel, fmtWhen, parseQueueStatus, preview, typeLabel, type QueueStatus } from "@/components/queue/format";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { APPROVALS_NAME } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(APPROVALS_NAME) };

const TABS: { status: QueueStatus; label: string }[] = [
  { status: "pending", label: "Waiting on you" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
];

const EMPTY: Record<QueueStatus, { title: string; body: string }> = {
  pending: { title: "All caught up", body: "Nothing is waiting for review. New drafts from the assistants land here." },
  approved: { title: "Nothing approved yet", body: "Approved drafts show up here once something has been reviewed." },
  rejected: { title: "Nothing rejected", body: "Rejected drafts and their notes show up here." },
};

/**
 * The approval queue: the only way anything reaches a client. Holds no data
 * of its own — reads go to the lawmatics-mcp queue API through
 * @/lib/queue/load, which returns ok / unconfigured / unavailable and never a
 * bare empty list, so an outage can't pass for "all caught up".
 */
export default async function QueuePage({ searchParams }: { searchParams: Promise<{ status?: string | string[]; who?: string | string[] }> }) {
  const params = await searchParams;
  const status = parseQueueStatus(params.status);
  const [load, tz, view] = await Promise.all([loadActiveQueue(status), getFirmTimeZone(), loadQueueViewContext()]);
  const { viewer, routing } = view;
  const members = view.members ?? [];
  // Mine is the default only for someone who can hold work; anyone else starts on Everyone.
  const mineEnabled = !!viewer && QUEUE_EDIT_ROLES.includes(viewer.role);
  const who = parseWho(Array.isArray(params.who) ? params.who[0] : params.who, { mineEnabled, members });
  const allItems = load.status === "ok" ? load.items : [];
  const counts = countsByPerson(allItems, routing, members, viewer);
  const shown = load.status === "ok" ? filterByWho(allItems, who, routing, members, viewer) : [];
  const waitingOnOthers = allItems.length - shown.length;
  const dismissable = status === "pending" && load.status === "ok" ? dismissableFollowups(allItems, { routing, viewer, now: view.now }).length : 0;
  // Only what is still waiting can be approved twice.
  const possibleDuplicates = status === "pending" && load.status === "ok" ? markNearDuplicates(allItems) : new Set<string>();

  return (
    <>
      <div className="lx-page-head lx-page-head-list">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="lx-h1" data-tour="queue-head">{APPROVALS_NAME}</h1>
          <p className="lx-sub">
            Everything an assistant drafted for a client, newest first. Approving puts the message in a mail client for a
            person to send — nothing reaches a client on its own.
          </p>
        </div>
        <nav aria-label="Approval status" className="lx-segs">
          {TABS.map((t) => (
            <Link key={t.status} href={`/dashboard/queue/?status=${t.status}`} aria-current={t.status === status ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {load.status === "ok" && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <PersonSwitch status={status} who={who} counts={counts} mineEnabled={mineEnabled} />
          {dismissable > 0 && <DismissFollowups count={dismissable} />}
        </div>
      )}
      {view.routingFailed && load.status === "ok" && (
        <p role="status" className="lx-note" style={{ margin: 0 }}>
          Assignments couldn&apos;t be loaded. Showing everything to the usual approvers.
        </p>
      )}

      {load.status !== "ok" ? (
        <QueueUnavailable status={load.status} reason={load.reason} />
      ) : allItems.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {EMPTY[status].title}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {EMPTY[status].body}
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {who.kind === "me" ? "Nothing for you right now" : "Nothing here"}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {who.kind === "me" ? `Nothing is waiting on you. ${waitingOnOthers} ${waitingOnOthers === 1 ? "is" : "are"} waiting on others.` : "Nothing is assigned to this person."}{" "}
            <Link href={`/dashboard/queue/?status=${status}&who=all`}>Show everyone</Link>
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl lx-stack">
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
              {shown.map((item) => (
                <tr key={item.id}>
                  <td className="wrap pri">
                    <Link href={`/dashboard/queue/${item.id}/`} className="lx-rowlink">
                      {item.headline}
                    </Link>
                    {possibleDuplicates.has(item.id) && (
                      <span className="lx-pill lx-pill-warn" style={{ marginLeft: 8 }} title="Nearly identical to a draft that was queued minutes earlier">
                        Possible duplicate
                      </span>
                    )}
                    <div className="lx-note">
                      {kindLabel(classifyQueueItem(item))} · {ownerText(item, routing, members)} · {typeLabel(item.type)} · {preview(item, 90)}
                    </div>
                  </td>
                  <td data-label="Client">{item.client_name ?? "—"}</td>
                  <td data-label="From">{agentLabel(item.agent)}</td>
                  <td data-label="Status">
                    <span className={`lx-pill ${STATUS_PILL[item.status].tone}`}>{STATUS_PILL[item.status].label}</span>
                  </td>
                  <td className="lx-num" data-label="Queued">{fmtWhen(item.created_at, tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
