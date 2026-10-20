"use server";

import { revalidatePath } from "next/cache";
import { markAllRead, markRead } from "@/lib/notifications";
import { UUID } from "@/lib/queue/link-rules";

export type NotificationActionResult = { ok: true } | { error: string };

/**
 * Mark one notification, or all of them, read. Both go through the caller's own
 * scoped client (RLS pins the rows to them), so neither takes a user id or an org
 * id: there is nothing to forge. A database error is logged, never shown.
 */
export async function markNotificationRead(id: string): Promise<NotificationActionResult> {
  if (typeof id !== "string" || !UUID.test(id)) return { error: "That notification isn't valid." };
  try {
    await markRead(id);
  } catch (err) {
    console.warn(`[notifications] mark read failed: ${err instanceof Error ? err.message : String(err)}`);
    return { error: "Couldn't mark that notification read. Try again shortly." };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  try {
    await markAllRead();
  } catch (err) {
    console.warn(`[notifications] mark all read failed: ${err instanceof Error ? err.message : String(err)}`);
    return { error: "Couldn't mark your notifications read. Try again shortly." };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
