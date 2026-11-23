import { firmMailFrom } from "@/lib/loe/email-signing/mail-config";
import { sentToOf, type EvidenceRead, type SigningEvidence } from "@/lib/loe/email-signing/evidence";
import type { InternalMail, InternalMailResult } from "@/lib/mail/internal-mail";
import { renderEmailWords } from "@/lib/loe/signing-words";
import { SignedUploadBlocked } from "./loe-signed-upload";
import { STEP_TEXT } from "./step-text";

/**
 * The signed copy, emailed to the client who signed by the emailed link: the step `signed_copy_email`, success word `sent`
 * (Sprint B, lectual 0117; owner decision 7: one of the TWO emails Lectual sends a client by itself, the other being the signing
 * link). Pure core, every dependency passed in; never throws, never logs.
 *
 * - `to` is the `sent` event's address, the one the link went to and the signer proved control of: never the proposal's current
 *   `client_email` or any other address. `from` is the firm's own `FIRM_CLIENT_MAIL_FROM` entry.
 * - The subject and body are the request's SNAPSHOTTED `copy_subject` / `copy_body` (the attorney's words, as approved when the
 *   link went out), merged with `client_name` and `firm_name` in one pass. Builders add no sentence. Plain text.
 * - The attachment is the verified signed PDF WITH its certificate (`buildVerifiedSignedPdf`); no PDF, no email.
 * - `idempotencyKey = "signed-copy:" + requestId + ":" + round` (the reset round), so a retry is not a second email and a
 *   re-signing after a reset is a new key.
 * - A staff Try again runs THIS core: a retry of the owner-approved signed copy only, the same email to the same address.
 *
 * Outcomes: `sent`; `skipped` (the switch isn't on, or the firm has no mail entry / no key: NOT the success word, so the next
 * follow-up run and Try again run it again); `blocked` (no address on the record, no words, the PDF doesn't verify); `failed` (the
 * mailer failed, the evidence couldn't be read, the PDF couldn't be built).
 */

export type CopyMailGate = { ok: true; apiKey: string; from: string } | { ok: false; reason: "switch_off" | "no_mail" };

export function copyMailGate(orgId: string, env: { LOE_EMAIL_SIGNING?: string; RESEND_API_KEY?: string; FIRM_CLIENT_MAIL_FROM?: string; SITE_URL?: string }): CopyMailGate {
  if (env.LOE_EMAIL_SIGNING !== "on") return { ok: false, reason: "switch_off" };
  const apiKey = typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
  const from = firmMailFrom(orgId, env);
  if (!apiKey || !from) return { ok: false, reason: "no_mail" };
  return { ok: true, apiKey, from };
}

/** The deployment's mail settings, read here so the callers hold no environment access of their own. */
export function deploymentMailEnv(): Parameters<typeof copyMailGate>[1] {
  return process.env as Record<string, string | undefined>;
}

export type SignedCopyResult = { outcome: "sent" | "skipped" | "blocked" | "failed"; reason?: string };

export type SignedCopyDeps = {
  /** Whether this acceptance was signed through the emailed link (`agreement.method === "email_link"`). */
  linkSigned: boolean;
  gate: () => CopyMailGate;
  /** Called after the gate; the evidence of the request the accepted snapshot names. */
  readEvidence: () => Promise<EvidenceRead>;
  /** The verified signed PDF with its certificate, built from the evidence just read. Throws `SignedUploadBlocked` for a mismatch. */
  buildPdf: (evidence: SigningEvidence) => Promise<Uint8Array>;
  /** The one mailer (`sendInternalMail`), or a fake in tests. */
  deliver: (mail: InternalMail) => Promise<InternalMailResult>;
  clientName: string;
  firmName: string;
  fileName: string;
  /** `roundNumber(events)`: 0 until the version is first reset. */
  round: number;
};

export async function runSignedCopyEmail(deps: SignedCopyDeps): Promise<SignedCopyResult> {
  try {
    if (!deps.linkSigned) return { outcome: "blocked", reason: STEP_TEXT.copyNotLink };
    const gate = deps.gate();
    if (!gate.ok) return { outcome: "skipped", reason: gate.reason === "switch_off" ? STEP_TEXT.copyNotSwitchedOn : STEP_TEXT.copyNoMail };

    const evidence = await deps.readEvidence();
    if (evidence === "not_set_up" || evidence === "unavailable") return { outcome: "failed", reason: STEP_TEXT.copyEvidenceUnreadable };
    const to = sentToOf(evidence.events);
    if (!to) return { outcome: "blocked", reason: STEP_TEXT.copyNoAddress };

    const values = { client_name: deps.clientName, firm_name: deps.firmName };
    const subject = renderEmailWords(evidence.request.copy_subject, values);
    const body = renderEmailWords(evidence.request.copy_body, values);
    const oneLine = subject.ok ? subject.text.replace(/[\r\n]+/g, " ").trim() : "";
    if (!subject.ok || !body.ok || !oneLine || !body.text.trim()) return { outcome: "blocked", reason: STEP_TEXT.copyWordsMissing };

    let pdf: Uint8Array;
    try {
      pdf = await deps.buildPdf(evidence);
    } catch (err) {
      if (err instanceof SignedUploadBlocked) return { outcome: "blocked", reason: STEP_TEXT.signedMismatch };
      return { outcome: "failed", reason: STEP_TEXT.copyNotBuilt };
    }

    const sent = await deps.deliver({
      apiKey: gate.apiKey,
      from: gate.from,
      to: [to],
      subject: oneLine,
      text: body.text,
      label: "signed-copy",
      idempotencyKey: `signed-copy:${evidence.request.id}:${deps.round}`,
      attachments: [{ filename: deps.fileName, content: pdf, contentType: "application/pdf" }],
    });
    if (sent.status === "sent") return { outcome: "sent" };
    if (sent.local) return { outcome: "failed", reason: STEP_TEXT.copyMailFailed };
    return { outcome: "failed", reason: sent.http === null ? "no response" : `HTTP ${sent.http}` };
  } catch {
    return { outcome: "failed", reason: STEP_TEXT.copyMailFailed };
  }
}
