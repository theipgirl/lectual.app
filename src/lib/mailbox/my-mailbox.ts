import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import { providerCredentials, rootKeyOrNull } from "./config";
import { createMailboxDraft, type DraftInput } from "./drafts";
import { freshAccessToken, type ConnectionRow } from "./sync";
import { hasSendScope, sendScopeRequested, type MailboxProvider } from "./providers";
import { sendCheckedDraft, type SendCheck } from "./outlook-send";
import type { SearchableMailbox } from "@/lib/reconcile/mailbox-search";

/**
 * A usable access token for one connection the CALLER's scoped read has already shown them. The sealed
 * token columns have no grant for signed-in roles, so this is the one place that reads them: by connection id
 * AND the org the scoped read returned, then refreshed if it is about to expire. Null when the row is gone.
 */
async function openMailboxToken(root: Buffer, id: string, orgId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data: row } = await admin
    .from("mailbox_connection")
    .select("id, org_id, provider, email, status, access_token_enc, refresh_token_enc, token_expires_at, sync_cursor, matched_count, scopes")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!row) return null;
  return freshAccessToken({ admin, root, credentials: providerCredentials }, row as ConnectionRow);
}

/**
 * Put an approved client email into the APPROVER'S OWN mailbox as a draft.
 *
 * Which mailbox is decided by the caller's RLS-scoped read: 0075 only shows a
 * personal row to its owner, so this can only ever find the signed-in
 * person's own Gmail/Outlook. Only then does the service-role client read
 * that row's sealed tokens, by id AND the org_id the scoped read returned.
 *
 * Returns null when the approver has no active personal mailbox.
 */
export async function draftInMyMailbox(draft: DraftInput): Promise<{ provider: MailboxProvider; email: string; webLink: string | null; id: string } | null> {
  const root = rootKeyOrNull();
  if (!root) return null;

  const supabase = await getScopedClient();
  const { data: mine } = await supabase
    .from("mailbox_connection")
    .select("id, org_id, provider, email")
    .eq("scope", "personal")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!mine) return null;

  const accessToken = await openMailboxToken(root, mine.id, mine.org_id);
  if (!accessToken) return null;
  const made = await createMailboxDraft(mine.provider as MailboxProvider, { accessToken, draft });
  return { provider: mine.provider as MailboxProvider, email: mine.email, webLink: made.webLink, id: made.id };
}

/**
 * Can "Send from Outlook now" be offered to this person? Only when the deployment asks for the send permission, and the
 * mailbox `draftInMyMailbox` would use (the caller's own first active personal connection, found by their scoped read)
 * is Microsoft AND its stored scopes granted it. Any failed read is `unavailable`, never "ready".
 */
export type MySendAccess = "ready" | "switched-off" | "no-mailbox" | "not-outlook" | "needs-permission" | "unavailable";

async function myDraftMailbox(): Promise<{ ok: true; row: { id: string; org_id: string; provider: string; scopes: unknown } | null } | { ok: false }> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("mailbox_connection")
      .select("id, org_id, provider, scopes")
      .eq("scope", "personal")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false };
    return { ok: true, row: data ?? null };
  } catch {
    return { ok: false };
  }
}

function accessOf(row: { provider: string; scopes: unknown } | null): MySendAccess {
  if (!row) return "no-mailbox";
  if (row.provider !== "microsoft") return "not-outlook";
  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : null;
  return hasSendScope("microsoft", scopes) ? "ready" : "needs-permission";
}

export async function mySendAccess(): Promise<MySendAccess> {
  if (!sendScopeRequested()) return "switched-off";
  if (!rootKeyOrNull()) return "unavailable";
  const mine = await myDraftMailbox();
  return mine.ok ? accessOf(mine.row) : "unavailable";
}

/**
 * Send one approved draft that sits in the caller's OWN Outlook Drafts, by its id. The connection is re-read through
 * the caller's scoped client on every call (only their own personal row is visible), the send permission is checked on
 * its stored scopes, and `sendCheckedDraft` reads the message back (still a draft, addressed to `recipient`) before it
 * sends. The caller (the deck's send action) has already checked the item was approved by this same person.
 */
export async function sendFromMyOutlook(args: { draftId: string; recipient: string | null; subject: string | null; approvedAt: string | null }): Promise<SendCheck | { ok: false; reason: MySendAccess }> {
  if (!sendScopeRequested()) return { ok: false, reason: "switched-off" };
  const root = rootKeyOrNull();
  if (!root) return { ok: false, reason: "unavailable" };
  const mine = await myDraftMailbox();
  if (!mine.ok) return { ok: false, reason: "unavailable" };
  const access = accessOf(mine.row);
  if (access !== "ready" || !mine.row) return { ok: false, reason: access };
  let accessToken: string | null;
  try {
    accessToken = await openMailboxToken(root, mine.row.id, mine.row.org_id);
  } catch {
    return { ok: false, reason: "reauth" };
  }
  if (!accessToken) return { ok: false, reason: "no-mailbox" };
  return sendCheckedDraft({ accessToken, draftId: args.draftId, recipient: args.recipient, subject: args.subject, approvedAt: args.approvedAt });
}

/**
 * The mailboxes this person may search for the stage reconciliation screen: the ones RLS shows them
 * (their own personal mailboxes plus the firm's shared ones) that are active. The sealed tokens are
 * read only when a search actually needs one, by connection id AND the org the scoped read returned,
 * exactly as draftInMyMailbox does. Read-only: nothing here writes a message.
 */
export async function searchableMailboxAccess(): Promise<{ ok: true; items: SearchableMailbox[] } | { ok: false }> {
  // Not configured is "can't tell", never "no mailbox is connected".
  const root = rootKeyOrNull();
  if (!root) return { ok: false };

  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("mailbox_connection")
    .select("id, org_id, provider, email, status, scopes")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) return { ok: false };

  const items = (data ?? []).map((mine): SearchableMailbox => ({
    id: mine.id,
    email: mine.email,
    provider: mine.provider as MailboxProvider,
    scopes: Array.isArray(mine.scopes) ? (mine.scopes as string[]) : null,
    accessToken: async () => {
      const token = await openMailboxToken(root, mine.id, mine.org_id);
      if (!token) throw new Error("mailbox gone");
      return token;
    },
  }));
  return { ok: true, items };
}
