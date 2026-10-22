import { ProviderError, type MailboxProvider } from "./providers";
import { PROVIDER_FETCH_TIMEOUT_MS, withTimeout } from "@/lib/http/timeout";

/**
 * Create an unsent DRAFT in a connected mailbox. Never sends: Gmail's
 * drafts.create and Graph's POST /me/messages both leave the message in the
 * Drafts folder, where a person opens it and presses Send. This is how an
 * approved client email reaches the approver's own mail client (step 5 of
 * docs/MVP-PLAN.md), with the scopes granted at connect time (gmail.compose,
 * Mail.ReadWrite) and nothing broader.
 */

export type DraftInput = { to: string | null; subject: string; body: string };

/** RFC 5322 header values can't carry raw newlines; strip them rather than trust input. */
function header(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** MIME-encode a subject so non-ASCII (é, —, curly quotes) survives. */
function encodeSubject(subject: string): string {
  const clean = header(subject);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export function gmailRawMessage(d: DraftInput): string {
  const lines = [
    ...(d.to ? [`To: ${header(d.to)}`] : []),
    `Subject: ${encodeSubject(d.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(d.body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function createMailboxDraft(
  provider: MailboxProvider,
  args: { accessToken: string; draft: DraftInput; fetchImpl?: typeof fetch },
): Promise<{ id: string; webLink: string | null }> {
  const { accessToken, draft, fetchImpl = fetch } = args;
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };

  const res =
    provider === "google"
      ? await fetchImpl(
          "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
          withTimeout({ method: "POST", headers, body: JSON.stringify({ message: { raw: gmailRawMessage(draft) } }) }, PROVIDER_FETCH_TIMEOUT_MS),
        )
      : await fetchImpl(
          "https://graph.microsoft.com/v1.0/me/messages",
          withTimeout(
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                subject: header(draft.subject),
                body: { contentType: "Text", content: draft.body },
                toRecipients: draft.to ? [{ emailAddress: { address: header(draft.to) } }] : [],
              }),
            },
            PROVIDER_FETCH_TIMEOUT_MS,
          ),
        );

  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("Your mailbox connection needs reconnecting before drafts can be created.", "reauth");
  }
  if (!res.ok) throw new ProviderError(`Couldn't create the draft (${res.status}).`, "fetch-failed");
  const json = (await res.json()) as { id: string; message?: { id: string }; webLink?: string };
  return {
    id: json.id,
    webLink: provider === "google" ? "https://mail.google.com/mail/#drafts" : (json.webLink ?? null),
  };
}

export type DraftSummary = { subject: string; to: string[] };

const DRAFTS_PAGE = 100;
const DRAFTS_MAX_PAGES = 2;

/**
 * The newest items in a Microsoft mailbox's Drafts folder: subject and recipient addresses only, no
 * body. Read-only. Used to avoid leaving a second reply draft for a message that already has one.
 * A refused or failed read throws, so the caller can say the folder could not be checked rather than
 * assume it is empty.
 */
export async function listDraftSummaries(args: { accessToken: string; fetchImpl?: typeof fetch }): Promise<DraftSummary[]> {
  const { accessToken, fetchImpl = fetch } = args;
  let url =
    `https://graph.microsoft.com/v1.0/me/mailFolders/drafts/messages?$select=subject,toRecipients&$top=${DRAFTS_PAGE}` +
    `&$orderby=${encodeURIComponent("lastModifiedDateTime desc")}`;
  const out: DraftSummary[] = [];
  for (let page = 0; page < DRAFTS_MAX_PAGES; page += 1) {
    const res = await fetchImpl(url, withTimeout({ headers: { authorization: `Bearer ${accessToken}` } }, PROVIDER_FETCH_TIMEOUT_MS));
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("Your mailbox connection needs reconnecting before drafts can be checked.", "reauth");
    }
    if (!res.ok) throw new ProviderError(`Couldn't read the Drafts folder (${res.status}).`, "fetch-failed");
    const json = (await res.json()) as {
      value?: Array<{ subject?: string | null; toRecipients?: Array<{ emailAddress?: { address?: string | null } }> }>;
      "@odata.nextLink"?: string;
    };
    for (const m of json.value ?? []) {
      out.push({
        subject: m.subject ?? "",
        to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address?.trim().toLowerCase() ?? "").filter(Boolean),
      });
    }
    const next = json["@odata.nextLink"];
    if (!next) break;
    // Only ever follow a link back to Graph itself: a bearer token goes nowhere else.
    if (!next.startsWith("https://graph.microsoft.com/")) throw new ProviderError("The Drafts folder returned an unexpected link.", "fetch-failed");
    url = next;
  }
  return out;
}
