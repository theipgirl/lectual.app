import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import { providerCredentials, rootKeyOrNull } from "./config";
import { createMailboxDraft, type DraftInput } from "./drafts";
import { freshAccessToken, type ConnectionRow } from "./sync";
import type { MailboxProvider } from "./providers";

/**
 * Put an approved client email into the APPROVER'S OWN mailbox as a draft.
 *
 * Which mailbox is decided by the caller's RLS-scoped read: 0057 only shows a
 * personal row to its owner, so this can only ever find the signed-in
 * person's own Gmail/Outlook. Only then does the service-role client read
 * that row's sealed tokens, by id AND the org_id the scoped read returned.
 *
 * Returns null when the approver has no active personal mailbox.
 */
export async function draftInMyMailbox(draft: DraftInput): Promise<{ provider: MailboxProvider; email: string; webLink: string | null } | null> {
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

  const admin = getAdminClient();
  const { data: row } = await admin
    .from("mailbox_connection")
    .select("id, org_id, provider, email, status, access_token_enc, refresh_token_enc, token_expires_at, sync_cursor, matched_count")
    .eq("id", mine.id)
    .eq("org_id", mine.org_id)
    .maybeSingle();
  if (!row) return null;

  const accessToken = await freshAccessToken({ admin, root, credentials: providerCredentials }, row as ConnectionRow);
  const made = await createMailboxDraft(mine.provider as MailboxProvider, { accessToken, draft });
  return { provider: mine.provider as MailboxProvider, email: mine.email, webLink: made.webLink };
}
