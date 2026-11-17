import Link from "next/link";
import { listMinePage, PAGE_SIZE, type NotificationPage } from "@/lib/notifications";
import { loadActorNames } from "@/components/notifications/NotificationBell";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import "@/components/notifications/notifications.css";
import { toRowViews } from "@/components/notifications/view";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { PageHeader } from "@/components/ui";
import { LoadFailedCard } from "@/components/ui/LoadFailed";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewToggle } from "@/components/ViewToggle";
import { getFirmTimeZone } from "@/lib/org/profile";
import { REFRESH_TO_TRY_AGAIN, SHOW_MORE } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle("Notifications") };

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
  const tz = await getFirmTimeZone();
  const rows = loaded ? toRowViews(loaded.rows, names, undefined, tz) : [];
  const anyUnread = rows.some((row) => row.unread);

  return (
    <>
      <PageHeader
        title="Notifications"
        sub="Updates on your leads and matters, and drafts waiting for you."
        actions={
          <ViewToggle
            label="Notification filter"
            value={tab}
            views={TABS.map((t) => ({ value: t.tab, label: t.label }))}
            hrefFor={(t: Tab) => hrefFor(t, 1)}
          />
        }
      />

      {!loaded ? (
        <LoadFailedCard role="alert" what="notifications" body={REFRESH_TO_TRY_AGAIN} />
      ) : rows.length === 0 ? (
        <EmptyState title={page > 1 ? "Nothing on this page" : tab === "unread" ? "No unread notifications" : "You're all caught up"}>
          {page > 1 ? (
            <Link href={hrefFor(tab, 1)}>Back to the newest</Link>
          ) : (
            "New assignments, mentions, replies and drafts to approve show up here."
          )}
        </EmptyState>
      ) : (
        <div className="lx-card">
          {anyUnread && (
            <div className="lx-bell-head lx-bell-head-end">
              <MarkAllReadButton />
            </div>
          )}
          <ul className="lx-notif-list lx-notif-list-full">
            {rows.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} />
              </li>
            ))}
          </ul>
          {(page > 1 || loaded.hasMore) && (
            <nav aria-label="Pages" className="lx-bell-foot">
              {page > 1 ? <Link href={hrefFor(tab, page - 1)}>Newer</Link> : <span />}
              {loaded.hasMore && <Link href={hrefFor(tab, page + 1)}>{SHOW_MORE}</Link>}
            </nav>
          )}
        </div>
      )}
      <p className="lx-note">
        These stay inside Lectual. Nothing here is emailed, texted or sent to a client.
      </p>
    </>
  );
}
