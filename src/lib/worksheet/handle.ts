import { createHash, createHmac } from "node:crypto";
import { validatePublicStart, type ValidatedStart } from "@/lib/intake-forms/public-submit";
import type { IntakeAnswer } from "@/lib/intake-forms/submission";
import type { IntakeHandle, CompleteOutcome, StartOutcome } from "@/lib/intake-forms/public";
import type { InternalMail, InternalMailResult } from "@/lib/mail/internal-mail";
import { SlidingWindowThrottle, clientIp } from "@/lib/intake-forms/spam";
import { fullName, worksheetIntakeAnswers } from "./answers";
import { attendeeCopy, firmNotice } from "./email";
import { parseWorksheetBody, WORKSHEET_HONEYPOT, type WorksheetInput } from "./schema";

/**
 * POST /api/worksheet/ — the master-class worksheet's submission, end to end. Dependencies are injected so the
 * tests run it with no database and no network; the route wires the real ones.
 *
 * ── WHERE IT LANDS, AND WHY NOT ANYWHERE ELSE ──────────────────────────────
 * Nothing in the body names a firm. The firm is the owner of the LIVE intake form whose slug the server is configured
 * with (`WORKSHEET_INTAKE_SLUG`), read by the public intake's own `readIntakeHandle`; the write is the public intake's
 * own contact-first pair (`startPublicIntake`, then `completeStartedIntake`), which stamps the org_id OF THAT FORM ROW.
 * Same tables, same fences, same lead mapping, same source tag as `/i/<slug>`.
 *
 * ── RETRIES ─────────────────────────────────────────────────────────────────
 * The browser sends a uuid per worksheet. The resume token is derived from it (and the form), so a retry finds the row
 * the first attempt made: finished = "already done" (no second lead), started but not finished = finish it. Emails carry
 * idempotency keys from the same uuid, so a retry within 24 h does not mail twice.
 *
 * ── WHAT IT ANSWERS ─────────────────────────────────────────────────────────
 * 2xx only once the lead is written. A failed email never fails the request; it is counted in one log line with no
 * name, address or answer in it. Every refusal is a fixed sentence.
 */

export type WorksheetConfig = {
  slug: string | null;
  allowedOrigins: readonly string[];
  notifyTo: readonly string[];
  from: string | null;
  replyTo: string | null;
  resendKey: string | null;
  tokenKey: string | null;
  lawmaticsSync: boolean;
};

export type WorksheetDeps = {
  config: WorksheetConfig;
  readHandle: (slug: string) => Promise<
    | { status: "ok"; handle: IntakeHandle }
    | { status: "moved"; slug: string }
    | { status: "not_found" }
    | { status: "unconfigured" }
    | { status: "unavailable" }
  >;
  start: (handle: IntakeHandle, start: ValidatedStart, ctx: { sourceHost: string | null; startedAt: number; now: Date; token: string }) => Promise<StartOutcome>;
  complete: (handle: IntakeHandle, token: string, answers: IntakeAnswer[], mode: "form", now: Date) => Promise<CompleteOutcome>;
  recordEvent: (handle: IntakeHandle, kind: "start_form" | "complete") => Promise<void>;
  mail: (m: InternalMail) => Promise<InternalMailResult>;
  /** Lawmatics push for a new person (only when the config switch is on). Must never throw. */
  lawmatics?: (handle: IntakeHandle, submissionId: string, input: WorksheetInput, noteBody: string) => Promise<void>;
  now: () => Date;
  ipThrottle: SlidingWindowThrottle;
  emailThrottle: SlidingWindowThrottle;
  /** Submissions being written right now, by token, so two copies of one retry don't race to two rows. */
  inFlight: Set<string>;
};

export const DEFAULT_ALLOWED_ORIGINS = ["https://masterclass.rpblawfirm.com"] as const;

export const WORKSHEET_MESSAGES = {
  origin: "This form can't be sent from here.",
  invalid: "We couldn't read your worksheet. Please check your name and email and try again.",
  tooLarge: "Your worksheet is too long to send. Please shorten the longest answers and try again.",
  notJson: "We couldn't read your worksheet. Please try again.",
  consent: "Please tick the box so we can email you your copy.",
  email: "That email address doesn't look right.",
  closed: "The worksheet isn't taking submissions right now. Your answers are still saved on this device.",
  busy: "We've had several submissions from this connection just now. Please wait a few minutes and try again.",
  inFlight: "Your worksheet is already being sent. Please wait a moment and try again.",
  failed: "We couldn't save your worksheet just now. Your answers are still saved on this device. Please try again in a minute.",
} as const;

export type WorksheetResponse = { status: number; body: Record<string, unknown>; headers: Record<string, string> };

function originAllowed(origin: string | null, allowed: readonly string[]): string | null {
  if (!origin) return null;
  const o = origin.trim().toLowerCase();
  return allowed.some((a) => a.toLowerCase() === o) ? origin.trim() : null;
}

/** CORS headers for an allowed origin, or none. Vary: Origin always, so a cache never serves one origin's answer to another. */
export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const ok = originAllowed(origin, allowed);
  const base: Record<string, string> = { Vary: "Origin", "Cache-Control": "no-store" };
  if (!ok) return base;
  return {
    ...base,
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
}

/** The preflight: 204 with the CORS headers for an allowed origin, 403 with none otherwise. */
export function preflight(origin: string | null, allowed: readonly string[]): WorksheetResponse {
  const ok = originAllowed(origin, allowed);
  return { status: ok ? 204 : 403, body: {}, headers: corsHeaders(origin, allowed) };
}

/** The 43-character resume token for a worksheet uuid on this form (the random token's shape). */
export function worksheetToken(formId: string, submissionId: string, key: string | null): string {
  const msg = `worksheet:${formId}:${submissionId.toLowerCase()}`;
  const digest = key ? createHmac("sha256", key).update(msg).digest() : createHash("sha256").update(msg).digest();
  return digest.toString("base64url");
}

function hashKey(kind: string, value: string, key: string | null): string {
  return createHmac("sha256", key ?? "worksheet").update(`${kind}:${value}`).digest("hex").slice(0, 32);
}

function hostOf(origin: string | null): string | null {
  try {
    return origin ? new URL(origin).host.toLowerCase().slice(0, 255) : null;
  } catch {
    return null;
  }
}

const PHONE_SHAPE = /^[0-9+().\-\s x]{5,}$/i;

export async function handleWorksheetPost(
  req: { headers: { get(name: string): string | null }; rawBody: string },
  deps: WorksheetDeps,
): Promise<WorksheetResponse> {
  const { config } = deps;
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin, config.allowedOrigins);
  const reply = (status: number, body: Record<string, unknown>): WorksheetResponse => ({ status, body, headers });
  const refuse = (status: number, error: string) => reply(status, { ok: false, error });

  if (!originAllowed(origin, config.allowedOrigins)) return refuse(403, WORKSHEET_MESSAGES.origin);
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) return refuse(415, WORKSHEET_MESSAGES.notJson);

  const parsed = parseWorksheetBody(req.rawBody);
  if (!parsed.ok) {
    if (parsed.reason === "too_large") return refuse(413, WORKSHEET_MESSAGES.tooLarge);
    if (parsed.reason === "not_json") return refuse(400, WORKSHEET_MESSAGES.notJson);
    return refuse(400, WORKSHEET_MESSAGES.invalid);
  }
  const input = parsed.value;
  // A bot that fills the hidden field is told "thanks" and nothing is written: telling it why teaches it.
  if ((input[WORKSHEET_HONEYPOT] ?? "").trim()) return reply(200, { ok: true });
  if (!input.consent.given) return refuse(400, WORKSHEET_MESSAGES.consent);

  // The public intake's own contact check (the same rules /i/<slug> applies). A mobile number it would refuse is
  // dropped from the contact (kept in the answers as typed) rather than losing the whole worksheet over it.
  const phoneOk = !input.contact.mobile || PHONE_SHAPE.test(input.contact.mobile);
  const checked = validatePublicStart({
    mode: "form",
    consent: true,
    contact: {
      name: fullName(input),
      email: input.contact.email,
      phone: phoneOk ? input.contact.mobile : "",
      company: input.contact.business,
    },
  });
  if (!checked.ok) return refuse(400, checked.fields.includes("email") ? WORKSHEET_MESSAGES.email : WORKSHEET_MESSAGES.invalid);
  const start = checked.value;

  const now = deps.now();
  const ipKey = clientIp(req.headers);
  if (ipKey && !deps.ipThrottle.take(hashKey("ip", ipKey, config.tokenKey), now.getTime())) return refuse(429, WORKSHEET_MESSAGES.busy);
  if (!deps.emailThrottle.take(hashKey("email", start.contact.email, config.tokenKey), now.getTime())) return refuse(429, WORKSHEET_MESSAGES.busy);

  if (!config.slug) return refuse(503, WORKSHEET_MESSAGES.closed);
  let read = await deps.readHandle(config.slug);
  if (read.status === "moved") read = await deps.readHandle(read.slug);
  if (read.status === "not_found" || read.status === "moved" || read.status === "unconfigured") return refuse(503, WORKSHEET_MESSAGES.closed);
  if (read.status !== "ok") return refuse(503, WORKSHEET_MESSAGES.failed);
  const { handle } = read;
  // A scored assessment's answers are the booth card's; a worksheet is not one.
  if (handle.kind !== "intake") return refuse(503, WORKSHEET_MESSAGES.closed);

  const answers = worksheetIntakeAnswers(input);
  if (!phoneOk) answers.unshift({ id: "ws_mobile", question: "About you: Mobile (as typed)", answer: input.contact.mobile });
  const token = worksheetToken(handle.formId, input.submissionId, config.tokenKey);
  if (deps.inFlight.has(token)) return refuse(409, WORKSHEET_MESSAGES.inFlight);
  deps.inFlight.add(token);

  let done: CompleteOutcome;
  let isNew = false;
  try {
    done = await deps.complete(handle, token, answers, "form", now);
    if (!done.ok && done.reason === "not_found") {
      const started = await deps.start(handle, start, { sourceHost: hostOf(origin), startedAt: now.getTime(), now, token });
      if (!started.ok) return refuse(503, WORKSHEET_MESSAGES.failed);
      isNew = true;
      done = await deps.complete(handle, token, answers, "form", now);
    }
  } finally {
    deps.inFlight.delete(token);
  }
  if (!done.ok) return refuse(503, WORKSHEET_MESSAGES.failed);

  if (isNew) {
    await deps.recordEvent(handle, "start_form");
  }
  if (!done.alreadyDone) await deps.recordEvent(handle, "complete");

  // ── emails: after the write, never failing the request ──
  // On a retry that finds the row already finished, mail only the address that row holds, so a replayed id can't be
  // pointed at someone else; the idempotency keys stop a double delivery within 24 h.
  const sameAddress = !done.alreadyDone || done.submission.contact.email === start.contact.email;
  let copy: "sent" | "failed" | "skipped" = "skipped";
  let notice: "sent" | "failed" | "skipped" = "skipped";
  if (config.resendKey && config.from && sameAddress) {
    if (input.consent.given) {
      const mail = attendeeCopy(input, { now });
      const r = await deps.mail({
        apiKey: config.resendKey,
        from: config.from,
        to: [start.contact.email],
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
        subject: mail.subject,
        text: mail.text,
        label: "worksheet",
        idempotencyKey: `worksheet-copy/${input.submissionId.toLowerCase()}`,
      });
      copy = r.status;
    }
    if (config.notifyTo.length) {
      const mail = firmNotice(input, { now, filedAs: (handle.sourceTag ?? "").trim() || handle.name, copySent: copy === "sent" });
      const r = await deps.mail({
        apiKey: config.resendKey,
        from: config.from,
        to: [...config.notifyTo],
        replyTo: start.contact.email,
        subject: mail.subject,
        text: mail.text,
        label: "worksheet",
        idempotencyKey: `worksheet-notice/${input.submissionId.toLowerCase()}`,
      });
      notice = r.status;
    }
  }
  console.log(`[worksheet] filed new=${!done.alreadyDone} copy=${copy} notice=${notice}`);

  if (isNew && config.lawmaticsSync && deps.lawmatics) {
    try {
      await deps.lawmatics(handle, done.submissionId, input, done.noteBody);
    } catch {
      console.error("[worksheet] lawmatics push failed");
    }
  }
  return reply(200, { ok: true });
}
