"use server";

import { refresh } from "next/cache";
import { orgHasModule } from "@/lib/org/modules";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { disconnect } from "@/lib/mailbox/connections";

export type DisconnectState = { ok?: boolean; error?: string; revoked?: boolean };

/**
 * A server action is its own POST entry point and never renders the page's
 * guard, so the module check is repeated here (AGENTS.md "Gate the PAGE and
 * the ACTION"). Who may remove WHICH mailbox is left to RLS: disconnect()
 * deletes through the caller's scoped client and reports 0 rows as refused.
 */
export async function disconnectMailboxAction(
  _prev: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  if (!(await orgHasModule("mailbox"))) return { error: "Not available." };
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Unknown mailbox." };

  const result = await disconnect({ root: rootKeyOrNull(), id });
  if (!result.ok) return { error: result.message };
  refresh();
  return { ok: true, revoked: result.revoked };
}
