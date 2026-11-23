import { fetchWithTimeout } from "@/lib/http/timeout";

/**
 * THE one Resend caller in this app (a grep test holds it: `api.resend.com` appears only here). It sends:
 *  - INTERNAL mail (agent failure alerts, "Send feedback");
 *  - the master-class worksheet's two emails (src/lib/worksheet/: the firm's notice, to addresses from an env var, and the
 *    attendee's own copy, sent only to the address they typed and only when they ticked the box asking for it);
 *  - the TWO owner-approved client emails of the emailed engagement-letter link (spec decision 7, lectual 0117): the signing
 *    link, sent because the client pressed the button, to the proposal's own client email (src/lib/loe/email-signing/), and
 *    (Sprint B) the signed copy. Nothing else here reaches a firm's client.
 *
 * Never throws and never returns or logs Resend's response body or an exception message: the result is
 * `sent` or `failed` plus the HTTP status (null when no response came back). The caller decides what
 * to tell a person; a failure here is one content-free log line.
 */

const RESEND_URL = "https://api.resend.com/emails";
/** Short on purpose: the alert runs inside the cron's 270 s wall budget. */
export const INTERNAL_MAIL_TIMEOUT_MS = 10_000;

export type InternalMail = {
  apiKey: string;
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  text: string;
  /** Optional HTML part, sent beside `text`. Never logged. */
  html?: string;
  fetchImpl?: typeof fetch;
  /** Log prefix, e.g. "failure-alert". */
  label?: string;
  /** Sent as Resend's Idempotency-Key header: a retried send with the same key within 24 h is not delivered twice. */
  idempotencyKey?: string;
  /** Files to attach (the client emails' PDFs). At most 2, at most 10 MB in total; otherwise nothing is sent (`local: true`). */
  attachments?: MailAttachment[];
};

export type MailAttachment = { filename: string; content: Uint8Array; contentType: "application/pdf" };

export const MAX_ATTACHMENTS = 2;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * `failed` with an HTTP status: Resend answered no. `failed` with `http: null`: no answer came back (timeout, network, abort), so
 * the mail MAY have been accepted. `local: true`: refused here before any request was made (nothing was sent).
 */
export type InternalMailResult = { status: "sent" } | { status: "failed"; http: number | null; local?: true };

function attachmentsBody(list: MailAttachment[] | undefined): Array<{ filename: string; content: string }> | null | undefined {
  if (!list || list.length === 0) return undefined;
  if (list.length > MAX_ATTACHMENTS) return null;
  let total = 0;
  for (const a of list) total += a.content.byteLength;
  if (total > MAX_ATTACHMENT_BYTES) return null;
  return list.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") }));
}

export async function sendInternalMail(mail: InternalMail): Promise<InternalMailResult> {
  const label = mail.label ?? "internal-mail";
  const attachments = attachmentsBody(mail.attachments);
  if (attachments === null) return { status: "failed", http: null, local: true };
  try {
    const post = fetchWithTimeout(mail.fetchImpl ?? fetch, INTERNAL_MAIL_TIMEOUT_MS);
    const res = await post(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mail.apiKey}`,
        "Content-Type": "application/json",
        ...(mail.idempotencyKey ? { "Idempotency-Key": mail.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: mail.from,
        to: mail.to,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
        ...(attachments ? { attachments } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[${label}] the email was refused (HTTP ${res.status}).`);
      return { status: "failed", http: res.status };
    }
    return { status: "sent" };
  } catch {
    console.error(`[${label}] the email could not be sent.`);
    return { status: "failed", http: null };
  }
}
