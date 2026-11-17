import { fetchWithTimeout } from "@/lib/http/timeout";

/**
 * The one place this app talks to Resend for INTERNAL mail (agent failure alerts, "Send feedback") and for the
 * master-class worksheet's two emails (src/lib/worksheet/: the firm's notice, to addresses from an env var, and the
 * attendee's own copy, sent only to the address they typed and only when they ticked the box asking for it).
 * Nothing else here reaches a firm's client, and no record's address is ever used.
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
};

export type InternalMailResult = { status: "sent" } | { status: "failed"; http: number | null };

export async function sendInternalMail(mail: InternalMail): Promise<InternalMailResult> {
  const label = mail.label ?? "internal-mail";
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
