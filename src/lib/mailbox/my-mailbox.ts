import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import { providerCredentials, rootKeyOrNull } from "./config";
import { createMailboxDraft, type DraftInput } from "./drafts";
import { freshAccessToken, type ConnectionRow } from "./sync";
import { hasDraftScope, hasSendScope, sendScopeRequested, type MailboxProvider } from "./providers";
import { postedConnectionAllowed, type MyOutlookDraftAccess } from "@/lib/queue/draft-handoff";
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

/* ─────────────── Sprint 4: the drafter's own Outlook ─────────────── */

/**
 * The caller's own personal, active Microsoft connection, by THEIR scoped read (lectual 0075 shows a personal row only
 * to its owner, so this can only ever be the signed-in person's own). Never a connection id from the browser.
 */
async function myOwnOutlookRow(): Promise<{ ok: true; row: { id: string; org_id: string; scopes: unknown } | null; anyOther: boolean } | { ok: false }> {
  try {
    const supabase = await getScopedClient();
    // The session's own user: RLS already shows a personal row only to its owner, and the filter says so as well.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return { ok: false };
    const { data, error } = await supabase
      .from("mailbox_connection")
      .select("id, org_id, provider, scopes")
      .eq("scope", "personal")
      .eq("status", "active")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) return { ok: false };
    const rows = (data ?? []) as { id: string; org_id: string; provider: string; scopes: unknown }[];
    const outlook = rows.find((r) => r.provider === "microsoft") ?? null;
    return { ok: true, row: outlook ? { id: outlook.id, org_id: outlook.org_id, scopes: outlook.scopes } : null, anyOther: rows.length > 0 };
  } catch {
    return { ok: false };
  }
}

function draftAccessOf(mine: Awaited<ReturnType<typeof myOwnOutlookRow>>): MyOutlookDraftAccess {
  if (!mine.ok) return "unavailable";
  if (!mine.row) return mine.anyOther ? "not-outlook" : "no-mailbox";
  const scopes = Array.isArray(mine.row.scopes) ? (mine.row.scopes as string[]) : null;
  return hasDraftScope("microsoft", scopes) ? "ready" : "needs-permission";
}

/**
 * Can "Make the draft in my Outlook" run for the signed-in person? A failed read is `unavailable`, never "no mailbox".
 * A connection id the browser posted that is not the caller's own is `not-yours` (checked before anything is written).
 */
export async function myOutlookDraftAccess(postedConnectionId?: unknown): Promise<MyOutlookDraftAccess | "not-yours"> {
  if (!rootKeyOrNull()) return "unavailable";
  const mine = await myOwnOutlookRow();
  if (!postedConnectionAllowed(postedConnectionId, mine.ok && mine.row ? mine.row.id : null)) return "not-yours";
  return draftAccessOf(mine);
}

export type OwnOutlookDraft =
  | { ok: true; id: string; webLink: string | null }
  | { ok: false; reason: MyOutlookDraftAccess | "not-yours" | "reauth" | "failed" };

/**
 * Make one DRAFT in the caller's OWN Outlook Drafts (never sends; `createMailboxDraft` posts to /me/messages, which
 * leaves the message in Drafts). The connection is the caller's scoped read, re-read on every call; `postedConnectionId`,
 * if the browser sent one, must be that same id (another person's id is refused, never used). Its stored scopes must
 * allow a draft. The sealed token is read by id AND the org the scoped read returned, exactly as `draftInMyMailbox` does.
 */
export async function draftInMyOwnOutlook(args: { draft: DraftInput; postedConnectionId?: unknown }): Promise<OwnOutlookDraft> {
  const root = rootKeyOrNull();
  if (!root) return { ok: false, reason: "unavailable" };
  const mine = await myOwnOutlookRow();
  const access = draftAccessOf(mine);
  const ownId = mine.ok && mine.row ? mine.row.id : null;
  if (!postedConnectionAllowed(args.postedConnectionId, ownId)) return { ok: false, reason: "not-yours" };
  if (access !== "ready" || !mine.ok || !mine.row) return { ok: false, reason: access };
  let accessToken: string | null;
  try {
    accessToken = await openMailboxToken(root, mine.row.id, mine.row.org_id);
  } catch {
    return { ok: false, reason: "reauth" };
  }
  if (!accessToken) return { ok: false, reason: "no-mailbox" };
  try {
    const made = await createMailboxDraft("microsoft", { accessToken, draft: args.draft });
    return { ok: true, id: made.id, webLink: made.webLink };
  } catch (err) {
    // The code only: a provider error can carry addresses or message text.
    const code = (err as { code?: unknown } | null)?.code;
    return { ok: false, reason: code === "reauth" ? "reauth" : "failed" };
  }
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
