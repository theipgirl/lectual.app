import type { Database } from "@/lib/db/types";

/**
 * Which `crm_notification_kind` value each of the app's own events is written as.
 * Pure (type import only), so producers and the renderer can both read it.
 *
 * The database enum only knows mentioned | assigned | lead_replied | time_running.
 * Consult outcomes and approval alerts therefore travel as `mentioned`, told apart
 * by `payload.source`. When lectual's migration adds dedicated values, switching a
 * producer over is the one line for its event below; describe.ts already renders
 * both forms. Do NOT put a value here that the enum in src/lib/db/types.ts lacks:
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
  consult_outcome: "mentioned",
  approval_needed: "mentioned",
};
