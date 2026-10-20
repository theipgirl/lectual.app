import Link from "next/link";
import { listMinePage, PAGE_SIZE, type NotificationPage } from "@/lib/notifications";
import { loadActorNames } from "@/components/notifications/NotificationBell";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import { toRowViews } from "@/components/notifications/view";

type Tab = "all" | "unread";

const TABS: { tab: Tab; label: string }[] = [
  { tab: "all", label: "All" },
  { tab: "unread", label: "Unread" },
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
}

const hrefFor = (tab: Tab, page: number) => `/dashboard/notifications/?tab=${tab}${page > 1 ? `&page=${page}` : ""}`;

/**
 * Everything the app has told the signed-in person, newest first. In-app only:
 * nothing here is emailed or texted, and none of it reaches a client. A read
 * that fails says so; "all caught up" appears only when the read worked and
 * found nothing.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const tab: Tab = one(params.tab) === "unread" ? "unread" : "all";
  const page = parsePage(one(params.page));

  let loaded: NotificationPage | null = null;
  try {
    loaded = await listMinePage({ unreadOnly: tab === "unread", offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
  } catch {
    loaded = null;
  }
  const names = loaded ? await loadActorNames() : {};
  const rows = loaded ? toRowViews(loaded.rows, names) : [];
  const anyUnread = rows.some((row) => row.unread);

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Inbox</div>
          <h1 className="lx-h1">Notifications</h1>
          <p className="lx-sub">
            What changed on your leads and matters, and drafts waiting for your approval. These stay inside Lectual.
            Nothing here is emailed, texted or sent to a client.
          </p>
        </div>
        <nav aria-label="Notification filter" className="lx-segs">
          {TABS.map((t) => (
            <Link key={t.tab} href={hrefFor(t.tab, 1)} aria-current={t.tab === tab ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {!loaded ? (
        <div role="alert" className="lx-banner lx-banner-risk">
          Your notifications couldn&apos;t be loaded. This isn&apos;t the same as having none. Try refreshing in a moment.
        </div>
      ) : rows.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {page > 1 ? "Nothing on this page" : tab === "unread" ? "No unread notifications" : "You're all caught up"}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {page > 1 ? (
              <Link href={hrefFor(tab, 1)}>Back to the newest</Link>
            ) : (
              "New assignments, mentions, replies and drafts to approve show up here."
            )}
          </p>
        </div>
      ) : (
        <div className="lx-card">
          {anyUnread && (
            <div className="lx-bell-head" style={{ justifyContent: "flex-end" }}>
              <MarkAllReadButton />
            </div>
          )}
          <ul className="lx-notif-list" style={{ maxHeight: "none" }}>
            {rows.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} />
              </li>
            ))}
          </ul>
          {(page > 1 || loaded.hasMore) && (
            <nav aria-label="Pages" className="lx-bell-foot">
              {page > 1 ? <Link href={hrefFor(tab, page - 1)}>Newer</Link> : <span />}
              {loaded.hasMore && <Link href={hrefFor(tab, page + 1)}>Older</Link>}
            </nav>
          )}
        </div>
      )}
    </>
  );
}
