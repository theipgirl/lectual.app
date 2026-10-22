import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import { providerCredentials, rootKeyOrNull } from "./config";
import { createMailboxDraft, type DraftInput } from "./drafts";
import { freshAccessToken, type ConnectionRow } from "./sync";
import type { MailboxProvider } from "./providers";
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

  const accessToken = await openMailboxToken(root, mine.id, mine.org_id);
  if (!accessToken) return null;
  const made = await createMailboxDraft(mine.provider as MailboxProvider, { accessToken, draft });
  return { provider: mine.provider as MailboxProvider, email: mine.email, webLink: made.webLink };
}

/**
 * The mailboxes this person may search for the stage reconciliation screen: the ones RLS shows them
 * (their own personal mailboxes plus the firm's shared ones) that are active. The sealed tokens are
 * read only when a search actually needs one, by connection id AND the org the scoped read returned,
 * exactly as draftInMyMailbox does. Read-only: nothing here writes a message.
 */
export async function searchableMailboxAccess(): Promise<{ ok: true; items: SearchableMailbox[] } | { ok: false }> {
  const root = rootKeyOrNull();
  if (!root) return { ok: true, items: [] };

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
