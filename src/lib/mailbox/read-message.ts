import { safeMailLink, type ClientRef } from "./my-mail";
import { LIVE_MESSAGE_ID, type LiveInboxResult, type MessageToRead } from "./fetch";
import { ProviderError, type MailboxProvider } from "./providers";

/**
 * The My Mail reading pane and the live Inbox tab: the rules and states, with every read injected so the access
 * rules are tested with fakes (see tests/mailbox/read-message.test.ts). The live wiring is read-message-live.ts.
 *
 * Access, on EVERY request:
 *   stored mail  ?m=<activity id>   the crm_activity row is read through the scoped client; the provider message
 *                                   id and the connection id come ONLY from that row, never from the URL.
 *   live mail    ?box=<connection id>&live=<provider message id>   the connection must be one the person's own
 *                                   scoped read returns (active, visible); the id must pass LIVE_MESSAGE_ID.
 * Either way the message is then fetched through that one connection's token and shown as plain text.
 * Nothing about the message is stored, cached or logged. `m` wins when both are present.
 */

export type ReadableMailbox = {
  id: string;
  email: string;
  provider: MailboxProvider;
  accessToken(): Promise<string>;
};

export type StoredMailRow = { id: string; type: string; payload: unknown };

export type MailReadDeps = {
  readActivity(id: string): Promise<{ ok: true; row: StoredMailRow | null } | { ok: false }>;
  mailboxes(): Promise<{ ok: true; items: ReadableMailbox[] } | { ok: false }>;
  fetchMessage(provider: MailboxProvider, args: { accessToken: string; messageId: string }): Promise<MessageToRead | null>;
  fetchInbox(provider: MailboxProvider, args: { accessToken: string; mailbox: string }): Promise<LiveInboxResult>;
  /** Client tags for live messages that match a stored activity row. Best effort. */
  tagsFor(messageIds: readonly string[]): Promise<ReadonlyMap<string, ClientRef>>;
};

export type ReadState =
  | { status: "ok"; message: MessageToRead; mailbox: string; provider: MailboxProvider; openUrl: string | null }
  /** Not visible to this person, not a mail row, or an unusable id: the same words for all of them. */
  | { status: "not-available" }
  /** The mailbox has no such message any more (the provider said 404). */
  | { status: "gone" }
  /** Token or permission problem: only a reconnect fixes it. */
  | { status: "reauth" }
  | { status: "failed" };

export const READ_MESSAGES = {
  "not-available": "This message is no longer available.",
  gone: "This message is no longer in the mailbox.",
  reauth: "We can't read this mailbox right now. Its connection needs to be renewed.",
  failed: "This message couldn't be read. Refresh to try again.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const MAIL_TYPES = new Set(["email_received", "email_sent"]);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

async function readThrough(mailbox: ReadableMailbox, messageId: string, deps: MailReadDeps, openUrl: string | null): Promise<ReadState> {
  try {
    const accessToken = await mailbox.accessToken();
    const message = await deps.fetchMessage(mailbox.provider, { accessToken, messageId });
    if (!message) return { status: "gone" };
    return { status: "ok", message, mailbox: mailbox.email, provider: mailbox.provider, openUrl };
  } catch (e) {
    return e instanceof ProviderError && e.code === "reauth" ? { status: "reauth" } : { status: "failed" };
  }
}

/** `?m=<activity id>`: the message the sync filed, read live from the mailbox it came from. */
export async function loadStoredMessage(m: unknown, deps: MailReadDeps): Promise<ReadState> {
  if (!isUuid(m)) return { status: "not-available" };
  const activity = await deps.readActivity(m).catch(() => ({ ok: false as const }));
  if (!activity.ok) return { status: "failed" };
  const row = activity.row;
  if (!row || !MAIL_TYPES.has(row.type)) return { status: "not-available" };
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const connectionId = str(p.connection_id);
  const messageId = str(p.message_id);
  if (!connectionId || !messageId) return { status: "not-available" };

  const boxes = await deps.mailboxes().catch(() => ({ ok: false as const }));
  if (!boxes.ok) return { status: "failed" };
  const mailbox = boxes.items.find((b) => b.id === connectionId);
  if (!mailbox) return { status: "not-available" };
  return readThrough(mailbox, messageId, deps, safeMailLink(str(p.web_link)));
}

/** `?box=<connection id>&live=<provider message id>`: a message from the live Inbox tab. */
export async function loadLiveMessage(box: unknown, live: unknown, deps: MailReadDeps): Promise<ReadState> {
  if (!isUuid(box) || typeof live !== "string" || !LIVE_MESSAGE_ID.test(live)) return { status: "not-available" };
  const boxes = await deps.mailboxes().catch(() => ({ ok: false as const }));
  if (!boxes.ok) return { status: "failed" };
  const mailbox = boxes.items.find((b) => b.id === box);
  if (!mailbox) return { status: "not-available" };
  return readThrough(mailbox, live, deps, null);
}

export type LiveInboxRow = {
  /** The provider's own id, without the "graph:" / "gmail:" prefix: what `live=` carries. */
  id: string;
  from: string;
  subject: string;
  at: string | null;
  preview: string;
  client: ClientRef | null;
};

export type LiveInboxState =
  | { status: "ok"; mailbox: ReadableMailbox; rows: LiveInboxRow[]; truncated: boolean }
  | { status: "no-mailbox" }
  | { status: "not-available" }
  | { status: "reauth" }
  | { status: "failed" };

export const INBOX_MESSAGES = {
  "no-mailbox": "There is no connected mailbox to show an inbox for.",
  "not-available": "That mailbox is no longer available.",
  reauth: "We can't read this inbox right now. Its connection needs to be renewed.",
  failed: "The inbox couldn't be read. Refresh to try again.",
} as const;

/** The newest 50 of one mailbox the person can see (the chosen `box`, else the first). Read live; nothing is stored. */
export async function loadLiveInbox(box: unknown, deps: MailReadDeps): Promise<LiveInboxState> {
  const boxes = await deps.mailboxes().catch(() => ({ ok: false as const }));
  if (!boxes.ok) return { status: "failed" };
  if (boxes.items.length === 0) return { status: "no-mailbox" };
  let mailbox: ReadableMailbox | undefined;
  if (box === undefined || box === null || box === "") mailbox = boxes.items[0];
  else mailbox = isUuid(box) ? boxes.items.find((b) => b.id === box) : undefined;
  if (!mailbox) return { status: "not-available" };
  try {
    const accessToken = await mailbox.accessToken();
    const result = await deps.fetchInbox(mailbox.provider, { accessToken, mailbox: mailbox.email });
    const messages = [...result.messages].sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? "") || 0);
    const tags = await deps.tagsFor(messages.map((m) => m.id)).catch(() => new Map<string, ClientRef>());
    const rows = messages.map((m): LiveInboxRow => ({
      id: m.id.replace(/^(gmail|graph):/, ""),
      from: m.from.name ?? m.from.address ?? "Unknown sender",
      subject: m.subject?.trim() || "(no subject)",
      at: m.at,
      preview: m.preview,
      client: tags.get(m.id) ?? null,
    }));
    return { status: "ok", mailbox, rows, truncated: result.truncated };
  } catch (e) {
    return e instanceof ProviderError && e.code === "reauth" ? { status: "reauth" } : { status: "failed" };
  }
}
