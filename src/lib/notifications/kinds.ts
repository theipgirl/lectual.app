import type { Database } from "@/lib/db/types";

/**
 * Which `crm_notification_kind` value each of the app's own events is written as.
 * Pure (type import only), so producers and the renderer can both read it.
 *
 * lectual 0094 is applied (dev and prod): the enum is mentioned | assigned |
 * lead_replied | time_running | consult_outcome | approval_needed, so consult
 * outcomes and approval alerts are written under their own kinds. Rows written
 * before the switch are the old form (`mentioned` + `payload.source`); describe.ts
 * renders both. Do NOT put a value here that the enum in src/lib/db/types.ts lacks:
 * the insert would be refused and the notification lost (it is best-effort).
 */
export type NotificationKindValue = Database["public"]["Enums"]["crm_notification_kind"];

export type NotificationEvent =
  | "assigned"
  | "mentioned"
  | "lead_replied"
  | "time_running"
  | "consult_outcome"
  | "approval_needed";

export const NOTIFICATION_KIND_FOR: Record<NotificationEvent, NotificationKindValue> = {
  assigned: "assigned",
  mentioned: "mentioned",
  lead_replied: "lead_replied",
  time_running: "time_running",
  consult_outcome: "consult_outcome",
  approval_needed: "approval_needed",
};
