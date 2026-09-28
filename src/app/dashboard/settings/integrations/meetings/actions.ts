"use server";

import { revalidatePath } from "next/cache";
import { hasRole } from "@/lib/auth/roles";
import { getAdminClient } from "@/lib/db/admin";
import { resolveFirmSession } from "@/lib/firm/session";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { checkFathomKeyShape, verifyFathomKey } from "@/lib/meetings/fathom";
import { disconnectMeetingSource, ownConnectionSecrets, saveFathomKey } from "@/lib/meetings/connection";
import { zoomClientCredentials } from "@/lib/meetings/config";
import { importConnection } from "@/lib/meetings/import";
import { PROVIDER_LABEL, isMeetingProvider } from "@/lib/meetings/types";

/**
 * Settings → Integrations → Meetings. owner / admin / senior_admin only,
 * re-checked in every action (each is its own POST), and RLS (0077) refuses
 * anyone else underneath. The org and user always come from the session.
 */

const PAGE = "/dashboard/settings/integrations/meetings/";

export type MeetingsSettingsState = { ok?: boolean; error?: string; notice?: string };

async function adminSession() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !hasRole(session.role, "senior_admin")) return null;
  return session;
}

function refresh() {
  revalidatePath(PAGE);
  revalidatePath("/dashboard/settings/integrations/");
  revalidatePath("/dashboard/meetings/");
}

export async function connectFathomAction(_prev: MeetingsSettingsState, formData: FormData): Promise<MeetingsSettingsState> {
  const session = await adminSession();
  if (!session) return { error: "Only owners and admins can connect Fathom." };
  const root = rootKeyOrNull();
  if (!root) return { error: "Integrations aren't set up on this deployment yet (no encryption key)." };

  const shape = checkFathomKeyShape(String(formData.get("key") ?? ""));
  if (!shape.ok) return { error: shape.reason };
  const verified = await verifyFathomKey(shape.key);
  if (!verified.ok) return { error: verified.reason };

  const saved = await saveFathomKey({ root, orgId: session.org.id, userId: session.user.id, key: shape.key });
  if (!saved.ok) return { error: saved.reason };
  refresh();
  return { ok: true, notice: saved.reconnected ? "Fathom key replaced." : "Fathom connected. Import your recent meetings below." };
}

export async function disconnectMeetingSourceAction(_prev: MeetingsSettingsState, formData: FormData): Promise<MeetingsSettingsState> {
  const provider = formData.get("provider");
  if (!isMeetingProvider(provider)) return { error: "Unknown connection." };
  if (!(await adminSession())) return { error: `Only owners and admins can disconnect ${PROVIDER_LABEL[provider]}.` };
  const result = await disconnectMeetingSource(provider, { root: rootKeyOrNull(), zoomCreds: zoomClientCredentials() });
  if (!result.ok) return { error: result.reason };
  refresh();
  return { ok: true, notice: `${PROVIDER_LABEL[provider]} disconnected. Meetings already imported stay.` };
}

export async function importNowAction(_prev: MeetingsSettingsState, formData: FormData): Promise<MeetingsSettingsState> {
  const provider = formData.get("provider");
  if (!isMeetingProvider(provider)) return { error: "Unknown connection." };
  const session = await adminSession();
  if (!session) return { error: "Only owners and admins can run an import." };
  const root = rootKeyOrNull();
  if (!root) return { error: "Integrations aren't set up on this deployment yet (no encryption key)." };

  // The connection row comes from the caller's own RLS read; its secrets are
  // then read by that row's (id, org_id), and every write stamps that org_id.
  const conn = await ownConnectionSecrets(provider);
  if (!conn) return { error: `${PROVIDER_LABEL[provider]} isn't connected for your firm.` };
  if (conn.status !== "active") return { error: `${PROVIDER_LABEL[provider]} needs reconnecting before it can import.` };

  const out = await importConnection({ admin: getAdminClient(), root, zoomCreds: zoomClientCredentials() }, conn, { importedBy: session.user.id });
  refresh();
  if (!out.ok) {
    return {
      error:
        out.status === "reauth"
          ? `${PROVIDER_LABEL[provider]} no longer accepts your firm's connection. Reconnect it above.`
          : `The import didn't finish: ${out.error}`,
    };
  }
  const { inserted, updated, linked, suggested } = out.counts;
  const parts = [`${inserted} new meeting${inserted === 1 ? "" : "s"}`];
  if (updated) parts.push(`${updated} refreshed`);
  if (linked) parts.push(`${linked} linked to a client automatically`);
  if (suggested) parts.push(`${suggested} with a suggested link to check`);
  return { ok: true, notice: `Imported: ${parts.join(", ")}.${out.truncated ? " There were more than one run reads; the rest follow on the next run." : ""}` };
}
