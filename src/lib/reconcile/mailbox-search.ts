import { isPlaceholderEmail, SENSITIVE_PHRASES } from "@/lib/intake/email-match";
import { PROVIDER_FETCH_TIMEOUT_MS, withTimeout } from "@/lib/http/timeout";
import { classifyMail, type Milestone } from "./milestones";
import type { MailboxSearchState } from "./types";

/**
 * An on-demand, read-only search of the firm's connected Microsoft mailboxes for mail to or from one
 * address in the last 120 days. Pure of the framework: everything it needs (the module flag, the
 * mailboxes and a token for each) is handed in, so every state is testable with a fake Graph.
 *
 * What is asked of Graph: a `$filter` on the sender or recipient address and a date, and a `$select`
 * of subject, date and the other party's address. NOT the body, NOT the preview, NOT attachments, and
 * no message is ever fetched by id. Only direction, date and subject survive (the subject only to be
 * classified in memory and shown on this screen); nothing is stored.
 *
 * NOT VERIFIED against a live mailbox: the filter syntax comes from the Graph reference. Any answer
 * that is not a 2xx is a named state, and a state is never "no mail".
 */

export const SEARCH_DAYS = 120;
export const MAX_MESSAGES_PER_PERSON = 25;
/** Most people searched in one preview; the rest are named `limit`, not read as "no mail". */
export const MAX_PEOPLE_PER_PREVIEW = 40;

export type SearchableMailbox = {
  id: string;
  email: string;
  provider: "google" | "microsoft";
  /** What the account consented to; null when the list was never recorded. */
  scopes: string[] | null;
  accessToken: () => Promise<string>;
};

export type MailboxDeps = {
  /** The firm holds the Mailboxes module: true / false, or null when it could not be read. */
  moduleOn: boolean | null;
  mailboxes: { ok: true; items: SearchableMailbox[] } | { ok: false };
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type MailHit = { direction: "sent" | "received"; at: string | null; subject: string | null };

export type MailboxSearch = { state: MailboxSearchState; hits: MailHit[] };

const unavailable = (code: Extract<MailboxSearchState, { status: "unavailable" }>["code"], reason: string): MailboxSearch => ({
  state: { status: "unavailable", code, reason },
  hits: [],
});

export const MAILBOX_REASONS = {
  noAddress: "This person has no real email address to search for.",
  moduleOff: "Mailboxes isn't switched on for your firm yet (or that couldn't be checked), so no mailbox was searched.",
  failed: "The mailboxes couldn't be searched. Refresh to try again.",
  noMailbox: "No mailbox is connected, so no mail was searched.",
  gmailOnly: "Only Gmail mailboxes are connected and they aren't searched here. Connect an Outlook mailbox to search mail.",
  scopeMissing: "The connected Outlook mailbox hasn't granted permission to read mail. Reconnect it.",
  reauth: "Outlook refused access. Reconnect the mailbox in Settings, then try again.",
  limit: `Not searched: a preview searches the mail of the first ${MAX_PEOPLE_PER_PREVIEW} people only.`,
  notRun: "The mailbox search was not run.",
} as const;

const GRAPH = "https://graph.microsoft.com/v1.0/me";
const ADDRESS = /^[^\s@'"<>,;]+@[^\s@'"<>,;]+\.[^\s@'"<>,;]+$/;

export function searchableAddress(email: string | null | undefined): string | null {
  const value = (email ?? "").trim().toLowerCase();
  if (!value || isPlaceholderEmail(value) || !ADDRESS.test(value)) return null;
  return value;
}

function hasMailScope(scopes: string[] | null): boolean {
  if (!Array.isArray(scopes)) return true;
  const have = scopes.map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "").trim().toLowerCase());
  return have.includes("mail.read") || have.includes("mail.readwrite");
}

type GraphAddress = { emailAddress?: { address?: string | null } };
type GraphMessage = { subject?: string | null; receivedDateTime?: string | null; sentDateTime?: string | null; isDraft?: boolean; from?: GraphAddress; toRecipients?: GraphAddress[] };
type GraphPage = { value?: GraphMessage[]; "@odata.nextLink"?: string };

class SearchFailure extends Error {
  constructor(readonly code: "reauth" | "failed") {
    super(code);
  }
}

async function getPage(url: string, token: string, fetchImpl: typeof fetch): Promise<GraphPage> {
  const res = await fetchImpl(url, withTimeout({ headers: { authorization: `Bearer ${token}` } }, PROVIDER_FETCH_TIMEOUT_MS));
  if (res.status === 401 || res.status === 403) throw new SearchFailure("reauth");
  if (!res.ok) throw new SearchFailure("failed");
  return (await res.json()) as GraphPage;
}

/** The first page only, newest first: more than 25 means `truncated`, never a second request. */
async function searchOneMailbox(address: string, token: string, since: string, fetchImpl: typeof fetch): Promise<{ hits: MailHit[]; truncated: boolean }> {
  const top = MAX_MESSAGES_PER_PERSON;
  const received =
    `${GRAPH}/messages?$select=${encodeURIComponent("subject,receivedDateTime,isDraft,from")}` +
    `&$filter=${encodeURIComponent(`receivedDateTime ge ${since} and from/emailAddress/address eq '${address}'`)}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}&$top=${top}`;
  const sent =
    `${GRAPH}/mailFolders/sentitems/messages?$select=${encodeURIComponent("subject,sentDateTime,isDraft,toRecipients")}` +
    `&$filter=${encodeURIComponent(`sentDateTime ge ${since} and toRecipients/any(r:r/emailAddress/address eq '${address}')`)}` +
    `&$top=${top}`;
  const [inbound, outbound] = await Promise.all([getPage(received, token, fetchImpl), getPage(sent, token, fetchImpl)]);
  const hits: MailHit[] = [];
  for (const m of inbound.value ?? []) {
    if (m.isDraft) continue;
    hits.push({ direction: "received", at: m.receivedDateTime ?? null, subject: m.subject ?? null });
  }
  for (const m of outbound.value ?? []) {
    if (m.isDraft) continue;
    hits.push({ direction: "sent", at: m.sentDateTime ?? null, subject: m.subject ?? null });
  }
  const truncated =
    (inbound.value?.length ?? 0) >= top || (outbound.value?.length ?? 0) >= top || !!inbound["@odata.nextLink"] || !!outbound["@odata.nextLink"];
  return { hits, truncated };
}

/** Why no mailbox can be searched at all, or the mailboxes that can be. Decided once per preview. */
export function searchableMailboxes(deps: MailboxDeps): { ok: true; items: SearchableMailbox[] } | { ok: false; search: MailboxSearch } {
  if (deps.moduleOn !== true) return { ok: false, search: unavailable("module-off", MAILBOX_REASONS.moduleOff) };
  if (!deps.mailboxes.ok) return { ok: false, search: unavailable("failed", MAILBOX_REASONS.failed) };
  const all = deps.mailboxes.items;
  if (all.length === 0) return { ok: false, search: unavailable("no-mailbox", MAILBOX_REASONS.noMailbox) };
  const microsoft = all.filter((m) => m.provider === "microsoft");
  if (microsoft.length === 0) return { ok: false, search: unavailable("gmail-only", MAILBOX_REASONS.gmailOnly) };
  const withScope = microsoft.filter((m) => hasMailScope(m.scopes));
  if (withScope.length === 0) return { ok: false, search: unavailable("scope-missing", MAILBOX_REASONS.scopeMissing) };
  return { ok: true, items: withScope };
}

/** Search every searchable mailbox for one address. Never throws. */
export async function searchPersonMail(email: string | null | undefined, deps: MailboxDeps): Promise<MailboxSearch> {
  const address = searchableAddress(email);
  if (!address) return unavailable("no-address", MAILBOX_REASONS.noAddress);
  const usable = searchableMailboxes(deps);
  if (!usable.ok) return usable.search;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now?.() ?? Date.now();
  const since = new Date(now - SEARCH_DAYS * 86_400_000).toISOString();

  const results = await Promise.all(
    usable.items.map(async (mailbox) => {
      try {
        return { ok: true as const, ...(await searchOneMailbox(address, await mailbox.accessToken(), since, fetchImpl)) };
      } catch (err) {
        return { ok: false as const, code: err instanceof SearchFailure ? err.code : ("failed" as const) };
      }
    }),
  );
  const good = results.flatMap((r) => (r.ok ? [r] : []));
  if (good.length === 0) {
    const reauth = results.some((r) => !r.ok && r.code === "reauth");
    return reauth ? unavailable("reauth", MAILBOX_REASONS.reauth) : unavailable("failed", MAILBOX_REASONS.failed);
  }

  const all = good.flatMap((r) => r.hits).sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? "") || 0);
  const hits = all.slice(0, MAX_MESSAGES_PER_PERSON);
  const truncated = good.some((r) => r.truncated) || all.length > MAX_MESSAGES_PER_PERSON;
  return {
    state: {
      status: "ok",
      messages: hits.length,
      sent: hits.filter((h) => h.direction === "sent").length,
      received: hits.filter((h) => h.direction === "received").length,
      truncated,
      mailboxes: good.length,
      unread: results.length - good.length,
    },
    hits,
  };
}

/** Milestones the hits stand for (a dispute thread says nothing). Subjects are classified here, in memory, and dropped. */
export function milestonesOfHits(hits: readonly MailHit[]): Array<{ at: string | null; direction: "sent" | "received"; milestones: Milestone[] }> {
  return hits.map((h) => {
    const folded = (h.subject ?? "").toLowerCase();
    const sensitive = SENSITIVE_PHRASES.some((p) => folded.includes(p));
    return { at: h.at, direction: h.direction, milestones: sensitive ? [] : classifyMail({ subject: h.subject, direction: h.direction === "sent" ? "sent" : "received" }) };
  });
}
