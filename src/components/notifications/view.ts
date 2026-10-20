import { describeNotification, type NotificationIcon } from "@/lib/notifications/describe";
import { relativeTime } from "@/lib/relative-time";

/** One notification as the bell and the page draw it: strings only, safe to hand to a client component. */
export type NotificationRowView = {
  id: string;
  unread: boolean;
  icon: NotificationIcon;
  label: string;
  sentence: string;
  href: string | null;
  when: string;
};

type RowLike = {
  id: string;
  kind: string;
  lead_id: string | null;
  matter_id: string | null;
  actor_id: string | null;
  payload: unknown;
  read_at: string | null;
  created_at: string;
};

/** A first name for a sentence ("Taylor assigned you…"); null when the person is unknown. */
export function firstNameOf(member: { displayName: string | null; email: string | null }): string | null {
  const name = member.displayName?.trim() || member.email?.split("@")[0]?.trim() || "";
  return name.split(/\s+/)[0] || null;
}

/** `names` maps user id to a first name; a missing actor reads as "Someone", never a uuid. */
export function toRowViews(rows: RowLike[], names: Record<string, string>, now = Date.now()): NotificationRowView[] {
  return rows.map((row) => {
    const described = describeNotification(row, { actorName: row.actor_id ? (names[row.actor_id] ?? null) : null });
    return {
      id: row.id,
      unread: row.read_at === null,
      icon: described.icon,
      label: described.label,
      sentence: described.sentence,
      href: described.href,
      when: relativeTime(row.created_at, now),
    };
  });
}
