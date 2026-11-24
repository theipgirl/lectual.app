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
  /** Copied addresses. The caller guards them (src/lib/consult-prep/recipients.ts); this file only passes them on. */
  cc?: string[];
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
  /** ISO time: Resend holds the email and sends it then (`scheduled_at`). Absent = send now. */
  scheduledAt?: string;
};

/** `id` is Resend's id for the email (what a cancel needs), or null when the answer carried none. Never the body. */
export type InternalMailResult = { status: "sent"; id?: string | null } | { status: "failed"; http: number | null };

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
        ...(mail.cc && mail.cc.length > 0 ? { cc: mail.cc } : {}),
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
        ...(mail.scheduledAt ? { scheduled_at: mail.scheduledAt } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[${label}] the email was refused (HTTP ${res.status}).`);
      return { status: "failed", http: res.status };
    }
    // The id is the only thing read from the answer; the rest of it is never kept or logged.
    let id: string | null = null;
    try {
      const body = (await res.json()) as { id?: unknown } | null;
      id = typeof body?.id === "string" && body.id ? body.id : null;
    } catch {
      id = null;
    }
    return { status: "sent", id };
  } catch {
    console.error(`[${label}] the email could not be sent.`);
    return { status: "failed", http: null };
  }
}

export type CancelMail = { apiKey: string; id: string; fetchImpl?: typeof fetch; label?: string };
export type CancelMailResult = { status: "cancelled" } | { status: "failed"; http: number | null };

/**
 * Cancels an email Resend is holding for a later time (`POST /emails/{id}/cancel`). Never throws, never returns or
 * logs Resend's answer. An email that has already gone out is refused by Resend and reads as `failed`.
 */
export async function cancelInternalMail(cancel: CancelMail): Promise<CancelMailResult> {
  const label = cancel.label ?? "internal-mail";
  try {
    const post = fetchWithTimeout(cancel.fetchImpl ?? fetch, INTERNAL_MAIL_TIMEOUT_MS);
    const res = await post(`${RESEND_URL}/${encodeURIComponent(cancel.id)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cancel.apiKey}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      console.error(`[${label}] the cancel was refused (HTTP ${res.status}).`);
      return { status: "failed", http: res.status };
    }
    return { status: "cancelled" };
  } catch {
    console.error(`[${label}] the cancel could not be sent.`);
    return { status: "failed", http: null };
  }
}
