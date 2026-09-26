import type { Party, ThreadMessage } from "@/lib/intake/email-threads";
import { ProviderError, type MailboxProvider } from "./providers";

/**
 * New mail since the last sync, in the matcher's `ThreadMessage` shape.
 *
 * WHAT IS READ: headers (from / to / cc / subject / date) and the provider's
 * own short preview (Gmail `snippet`, Graph `bodyPreview`), cut to 300 chars.
 * Never a body, never an attachment. The preview is used only to classify the
 * message in memory; activityPayloadForMessage() stores no preview at all.
 *
 * WHERE IT RESUMES: `cursor` is opaque to callers.
 *   Gmail     the mailbox's historyId → users.history.list (messageAdded).
 *             A history id Google has expired (404) restarts the window.
 *   Microsoft {"inbox": url, "sentitems": url} — each a Graph delta or next
 *             link. An expired delta token (410) restarts that folder.
 * A null cursor is a first sync: the last LOOKBACK_DAYS of mail.
 *
 * `maxMessages` bounds one run so a large mailbox cannot starve the cron.
 * Microsoft saves the next-page link as the cursor, so a capped first sync
 * simply carries on next run; Gmail reports `truncated` and moves on.
 */

export const LOOKBACK_DAYS = 30;
export const DEFAULT_MAX_MESSAGES = 400;
const PREVIEW_MAX = 300;

export type FetchResult = {
  messages: ThreadMessage[];
  cursor: string;
  /** More mail exists than this run read. */
  truncated: boolean;
  /** The stored cursor had expired and the window was restarted. */
  restarted: boolean;
};

export type FetchArgs = {
  accessToken: string;
  /** The connected address; stamped on every message as `mailbox`. */
  mailbox: string;
  cursor: string | null;
  fetchImpl?: typeof fetch;
  now?: number;
  maxMessages?: number;
};

export function fetchNewMessages(provider: MailboxProvider, args: FetchArgs): Promise<FetchResult> {
  return provider === "google" ? fetchGmail(args) : fetchGraph(args);
}

// ── shared parsing ───────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Gmail snippets arrive HTML-escaped ("don&#39;t"). Decode the handful that occur. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function clip(text: string | null | undefined): string {
  return decodeEntities((text ?? "").replace(/\s+/g, " ").trim()).slice(0, PREVIEW_MAX);
}

/**
 * Parse an RFC 5322 address list: `"Okafor, Desmond" <d@x.com>, a@b.com`.
 * Commas inside quotes or angle brackets don't split. Malformed input yields
 * whatever parties can be recovered rather than throwing.
 */
export function parseAddressList(header: string | null | undefined): Party[] {
  if (!header) return [];
  const parts: string[] = [];
  let buf = "";
  let quoted = false;
  let angle = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angle = true;
    else if (ch === ">" && !quoted) angle = false;
    if (ch === "," && !quoted && !angle) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf);

  return parts
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^(.*?)\s*<([^>]+)>\s*$/);
      const name = m ? m[1].replace(/^"|"$/g, "").trim() : null;
      const address = (m ? m[2] : raw).trim().toLowerCase();
      return { name: name || null, address: address.includes("@") ? address : null };
    });
}

async function getJson(url: string, accessToken: string, fetchImpl: typeof fetch, headers: Record<string, string> = {}) {
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}`, ...headers } });
  if (res.status === 401 || res.status === 403) {
    // The token was just refreshed, so this is access withdrawn, not expiry.
    throw new ProviderError("Access to this mailbox was withdrawn. Reconnect to resume syncing.", "reauth");
  }
  return res;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Gmail ────────────────────────────────────────────────────────────────────

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Labels that are never correspondence with a client. */
const GMAIL_SKIP_LABELS = new Set(["DRAFT", "SPAM", "TRASH", "CHAT"]);

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};

export function gmailToThreadMessage(m: GmailMessage, mailbox: string): ThreadMessage | null {
  const labels = new Set(m.labelIds ?? []);
  if ([...labels].some((l) => GMAIL_SKIP_LABELS.has(l))) return null;
  const header = (name: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

  const outbound = labels.has("SENT");
  const from = parseAddressList(header("From"))[0] ?? { name: null, address: null };
  const ms = Number(m.internalDate);
  return {
    id: `gmail:${m.id}`,
    conversationId: m.threadId ?? null,
    mailbox,
    folder: outbound ? "sent" : "inbox",
    direction: outbound ? "outbound" : "inbound",
    at: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    from,
    to: parseAddressList(header("To")),
    cc: parseAddressList(header("Cc")),
    subject: header("Subject"),
    preview: clip(m.snippet),
    webLink: `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${m.id}`,
  };
}

async function fetchGmail(args: FetchArgs): Promise<FetchResult> {
  const { accessToken, mailbox, fetchImpl = fetch } = args;
  const cap = args.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const get = (url: string) => getJson(url, accessToken, fetchImpl);

  let ids: string[] = [];
  let cursor: string;
  let truncated = false;
  let restarted = false;

  const initialWindow = async () => {
    // Take the history id FIRST: anything that arrives while we page through
    // the window is then picked up by the next incremental run, not lost.
    const profile = await get(`${GMAIL}/profile`);
    if (!profile.ok) throw new ProviderError(`Gmail profile read failed (${profile.status}).`, "fetch-failed");
    const { historyId } = (await profile.json()) as { historyId: string };
    const found: string[] = [];
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`newer_than:${LOOKBACK_DAYS}d -in:chats -in:drafts`);
      const res = await get(`${GMAIL}/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
      if (!res.ok) throw new ProviderError(`Gmail list failed (${res.status}).`, "fetch-failed");
      const page = (await res.json()) as { messages?: { id: string }[]; nextPageToken?: string };
      found.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && found.length < cap);
    truncated = Boolean(pageToken) || found.length > cap;
    return { ids: found.slice(0, cap), historyId };
  };

  if (!args.cursor) {
    const first = await initialWindow();
    ids = first.ids;
    cursor = first.historyId;
  } else {
    let pageToken: string | undefined;
    let latest = args.cursor;
    const seen = new Set<string>();
    let expired = false;
    do {
      const url =
        `${GMAIL}/history?startHistoryId=${encodeURIComponent(args.cursor)}` +
        `&historyTypes=messageAdded&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`;
      const res = await get(url);
      if (res.status === 404) {
        expired = true;
        break;
      }
      if (!res.ok) throw new ProviderError(`Gmail history read failed (${res.status}).`, "fetch-failed");
      const page = (await res.json()) as {
        history?: { messagesAdded?: { message: { id: string } }[] }[];
        historyId?: string;
        nextPageToken?: string;
      };
      for (const h of page.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (!seen.has(added.message.id)) {
            seen.add(added.message.id);
            ids.push(added.message.id);
          }
        }
      }
      if (page.historyId) latest = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);

    if (expired) {
      const first = await initialWindow();
      ids = first.ids;
      cursor = first.historyId;
      restarted = true;
    } else {
      cursor = latest;
      if (ids.length > cap) {
        truncated = true;
        ids = ids.slice(-cap); // keep the newest
      }
    }
  }

  const headers = ["From", "To", "Cc", "Subject", "Date"].map((h) => `metadataHeaders=${h}`).join("&");
  const messages = await mapLimit(ids, 5, async (id) => {
    const res = await get(`${GMAIL}/messages/${id}?format=metadata&${headers}`);
    if (res.status === 404) return null; // deleted since it was listed
    if (!res.ok) throw new ProviderError(`Gmail message read failed (${res.status}).`, "fetch-failed");
    return gmailToThreadMessage((await res.json()) as GmailMessage, mailbox);
  });

  return { messages: messages.filter((m): m is ThreadMessage => m !== null), cursor, truncated, restarted };
}

// ── Microsoft Graph ──────────────────────────────────────────────────────────

const GRAPH = "https://graph.microsoft.com/v1.0/me/mailFolders";
const GRAPH_FOLDERS = ["inbox", "sentitems"] as const;
type GraphFolder = (typeof GRAPH_FOLDERS)[number];
const GRAPH_SELECT =
  "id,conversationId,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,webLink,isDraft";

type GraphAddress = { emailAddress?: { name?: string | null; address?: string | null } };
type GraphMessage = {
  id: string;
  "@removed"?: unknown;
  conversationId?: string;
  subject?: string | null;
  bodyPreview?: string | null;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  webLink?: string | null;
  isDraft?: boolean;
};

function graphParty(a: GraphAddress | undefined): Party {
  const address = a?.emailAddress?.address?.trim().toLowerCase() || null;
  return { name: a?.emailAddress?.name?.trim() || null, address: address && address.includes("@") ? address : null };
}

export function graphToThreadMessage(m: GraphMessage, folder: GraphFolder, mailbox: string): ThreadMessage | null {
  if (m["@removed"] || m.isDraft) return null;
  const outbound = folder === "sentitems";
  return {
    id: `graph:${m.id}`,
    conversationId: m.conversationId ?? null,
    mailbox,
    folder: outbound ? "sent" : "inbox",
    direction: outbound ? "outbound" : "inbound",
    at: (outbound ? m.sentDateTime : m.receivedDateTime) ?? m.receivedDateTime ?? null,
    from: graphParty(m.from),
    to: (m.toRecipients ?? []).map(graphParty),
    cc: (m.ccRecipients ?? []).map(graphParty),
    subject: m.subject ?? null,
    preview: clip(m.bodyPreview),
    webLink: m.webLink ?? null,
  };
}

function parseGraphCursor(cursor: string | null): Partial<Record<GraphFolder, string>> {
  if (!cursor) return {};
  try {
    const parsed = JSON.parse(cursor) as Record<string, unknown>;
    const out: Partial<Record<GraphFolder, string>> = {};
    for (const f of GRAPH_FOLDERS) {
      const v = parsed[f];
      // Only ever follow links back to Graph itself — the cursor is ours, but
      // a bearer token must never be sent anywhere a stored value points.
      if (typeof v === "string" && v.startsWith("https://graph.microsoft.com/")) out[f] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function initialGraphUrl(folder: GraphFolder, now: number): string {
  const since = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString();
  return (
    `${GRAPH}/${folder}/messages/delta?$select=${GRAPH_SELECT}` +
    `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`
  );
}

async function fetchGraph(args: FetchArgs): Promise<FetchResult> {
  const { accessToken, mailbox, fetchImpl = fetch, now = Date.now() } = args;
  const perFolderCap = Math.ceil((args.maxMessages ?? DEFAULT_MAX_MESSAGES) / GRAPH_FOLDERS.length);
  const stored = parseGraphCursor(args.cursor);
  const nextCursor: Partial<Record<GraphFolder, string>> = {};
  const messages: ThreadMessage[] = [];
  let truncated = false;
  let restarted = false;

  for (const folder of GRAPH_FOLDERS) {
    let url = stored[folder] ?? initialGraphUrl(folder, now);
    let count = 0;
    for (;;) {
      const res = await getJson(url, accessToken, fetchImpl, { prefer: "odata.maxpagesize=50" });
      // A stored delta/next link Graph no longer honours (410 Gone, or 400/404
      // for a malformed or foreign token): restart this folder's window. Only
      // the STORED link can trigger this, so it happens at most once per folder.
      if (url === stored[folder] && [400, 404, 410].includes(res.status)) {
        url = initialGraphUrl(folder, now);
        restarted = true;
        continue;
      }
      if (!res.ok) throw new ProviderError(`Outlook ${folder} read failed (${res.status}).`, "fetch-failed");
      const page = (await res.json()) as {
        value?: GraphMessage[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      };
      for (const m of page.value ?? []) {
        const tm = graphToThreadMessage(m, folder, mailbox);
        if (tm) {
          messages.push(tm);
          count += 1;
        }
      }
      if (page["@odata.deltaLink"]) {
        nextCursor[folder] = page["@odata.deltaLink"];
        break;
      }
      if (!page["@odata.nextLink"]) {
        nextCursor[folder] = url;
        break;
      }
      if (count >= perFolderCap) {
        // Resume from the next page next run — nothing is skipped.
        nextCursor[folder] = page["@odata.nextLink"];
        truncated = true;
        break;
      }
      url = page["@odata.nextLink"];
    }
  }

  return { messages, cursor: JSON.stringify(nextCursor), truncated, restarted };
}

// ── one message body, for the email-intel agent only ─────────────────────────

const BODY_MAX = 8000;

/** Crude but safe HTML → text: drop script/style, tags, collapse whitespace. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

function gmailBodyText(part: GmailPart | undefined): string {
  if (!part) return "";
  const decode = (d?: string) => (d ? Buffer.from(d, "base64url").toString("utf8") : "");
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  for (const child of part.parts ?? []) {
    const text = gmailBodyText(child);
    if (text) return text;
  }
  if (part.mimeType === "text/html" && part.body?.data) return htmlToText(decode(part.body.data));
  return "";
}

/**
 * The text of ONE already-matched message, capped at BODY_MAX characters.
 * Used only by the email-intel agent, only for a message the sync has already
 * filed on a client's record, and the text is never stored: it goes to the
 * model and is discarded. Returns null if the message no longer exists.
 */
export async function fetchMessageBody(
  provider: MailboxProvider,
  args: { accessToken: string; messageId: string; fetchImpl?: typeof fetch },
): Promise<string | null> {
  const { accessToken, fetchImpl = fetch } = args;
  const rawId = args.messageId.replace(/^(gmail|graph):/, "");
  if (!/^[A-Za-z0-9_=+\-/.]+$/.test(rawId)) return null; // never splice odd ids into a URL
  const url =
    provider === "google"
      ? `${GMAIL}/messages/${encodeURIComponent(rawId)}?format=full`
      : `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(rawId)}?$select=body`;
  const res = await getJson(url, accessToken, fetchImpl, provider === "microsoft" ? { prefer: 'outlook.body-content-type="text"' } : {});
  if (res.status === 404) return null;
  if (!res.ok) throw new ProviderError(`Message read failed (${res.status}).`, "fetch-failed");
  const json = (await res.json()) as { payload?: GmailPart; body?: { contentType?: string; content?: string } };
  const text =
    provider === "google"
      ? gmailBodyText(json.payload)
      : json.body?.contentType === "html"
        ? htmlToText(json.body.content ?? "")
        : (json.body?.content ?? "");
  return text.slice(0, BODY_MAX);
}
