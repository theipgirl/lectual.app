import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { endOfFirmDay } from "@/lib/quotes/firm-time";
import { parseInet } from "@/lib/quotes/public";
import { DESCRIBE_BEFORE_ACCEPT, quoteForAcceptance } from "@/lib/proposals/client-classes";
import { clientLinkOrigin, clientLinkUrl } from "@/lib/proposals/client-link-origin";
import { quoteHasItems } from "@/lib/proposals/pricing";
import {
  buildAcceptedSnapshot,
  buildServerAgreement,
  emailSigningReadyFor,
  publicProposalsDb,
  readPublicProposal,
  type PublicProposalRead,
  type PublicProposalsDb,
} from "@/lib/proposals/public";
import { isWellFormedProposalToken } from "@/lib/proposals/types";
import { sendInternalMail, type InternalMail, type InternalMailResult } from "@/lib/mail/internal-mail";
import { SEND_MESSAGES, SIGN_MESSAGES } from "../client-words";
import type { Exhibit } from "../exhibit";
import { letterLogoForSlug, type LetterLogo } from "../letter-logo";
import { buildLetterPdf } from "../pdf";
import { sendAddressLimiter, sendTokenLimiter } from "../review-limit";
import { addressJson, cleanSigningDetails, letterDateText, missingDetails, type SignerDetails } from "../signing";
import { wordsSha256 } from "../signing-words";
import { btrimSpaces } from "./address";
import { isObject, type SigningDb } from "./db";
import { buildLinkEmail, signingLinkUrl } from "./link-email";
import { maskEmail } from "./mask";
import { markSigningNotSetUp } from "./not-set-up";
import type { Readiness } from "./ready";
import { parseReadiness, SEND_FAILURE_FALLBACK } from "./ready-rules";
import { localFailures, noteLocalFailure } from "./failure-memo";
import { signOpenOutcome, type FailureKind } from "./open-outcomes";

/**
 * The client pressed "Email me a link to sign" (Sprint A item 9). Token, ticks, class words and details only: the address the
 * link goes to is the PROPOSAL ROW's own `client_email`, and the letter, the price and the date are built HERE.
 *
 * Order: the limiters (before any read) -> the client's own input (details, nothing selected, an undescribed class: refused
 * before ANY rpc and never counted, so a holder of the bearer `/p/` link cannot trip the fallback and skip the email proof) ->
 * the gate and readiness -> the FINAL agreement (`buildServerAgreement`, the in-app path's own builder) -> the token (32 random
 * bytes; only its sha256 leaves this function apart from the email) -> ONE `signing_open` -> the review PDF from the stored text
 * -> the email (idempotency key from the request id) -> `signing_mark_sent`.
 *
 * After the request id exists, EVERY failure closes it through `failSend` and is counted somewhere readiness looks (v3, B1a).
 * A mail answer with no HTTP status is UNCERTAIN: the link is kept and the failure counted (v3). Nothing here logs the address,
 * the token, the letter or the words.
 */

export type SendInput = {
  token: string;
  selection: unknown;
  clientClasses: unknown;
  details: unknown;
  ip?: string | null;
  now: Date;
};

export type SendResult =
  | { ok: true; sentTo: string; expiresText: string; uncertain?: true }
  | { ok: false; message: string };

export type SendDeps = {
  /** The service-role client (production: `publicProposalsDb()`). */
  db?: PublicProposalsDb;
  read?: (token: string, now: Date, db: PublicProposalsDb) => Promise<PublicProposalRead>;
  readiness?: (handle: { proposalId: string; orgId: string }, db: PublicProposalsDb) => Promise<Readiness>;
  mailer?: (mail: InternalMail) => Promise<InternalMailResult>;
  randomBytes?: (n: number) => Buffer;
  linkOrigin?: (orgId: string) => Promise<string>;
  reviewPdf?: (input: { text: string; details: SignerDetails; firmName: string; logo: LetterLogo | null; title: string }) => Promise<Uint8Array>;
  apiKey?: string;
  limiters?: { token: typeof sendTokenLimiter; address: typeof sendAddressLimiter };
};

/** The earliest of now + 7 days - 5 minutes (so a fast app clock is never refused by 0117's `<= now() + 7 days`) and the proposal's last day. */
export const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000 - 5 * 60 * 1000;

export function linkExpiresAt(now: Date, expiresOn: string | null, timeZone: string): Date {
  const seven = new Date(now.getTime() + LINK_LIFETIME_MS);
  const end = expiresOn ? endOfFirmDay(expiresOn, timeZone) : null;
  const last = end ? new Date(end) : null;
  return last && last.getTime() < seven.getTime() ? last : seven;
}

const NO_EXHIBIT: Exhibit = { title: "", groups: [], legalDue: { label: "", note: "", amount: "" }, usptoDue: null };

async function defaultReviewPdf(input: { text: string; details: SignerDetails; firmName: string; logo: LetterLogo | null; title: string }): Promise<Uint8Array> {
  return buildLetterPdf({ blocks: [], exhibit: NO_EXHIBIT, storedText: input.text, details: input.details, mode: "review", firmName: input.firmName, logo: input.logo, title: input.title });
}

const sha256 = (v: string | Uint8Array): string => createHash("sha256").update(v).digest("hex");
const refuse = (message: string): SendResult => ({ ok: false, message });

export async function sendSigningLink(input: SendInput, deps: SendDeps = {}): Promise<SendResult> {
  const token = String(input.token ?? "");
  if (!isWellFormedProposalToken(token)) return refuse(SEND_MESSAGES.unavailable);

  // 1. Courtesy limits, before any read (in memory, per instance). Never counted as a send failure.
  const limiters = deps.limiters ?? { token: sendTokenLimiter, address: sendAddressLimiter };
  const tokenKey = `t:${sha256(token)}`;
  const ipKey = `ip:${parseInet(input.ip) ?? "unknown"}`;
  if (!limiters.token.allowed(tokenKey) || !limiters.address.allowed(ipKey)) return refuse(SEND_MESSAGES.send_failed);

  // The client's own details: refused before any read or rpc (never counted).
  const details = cleanSigningDetails(input.details);
  if (missingDetails(details).length > 0) return refuse(SIGN_MESSAGES.details_required);

  let db: PublicProposalsDb;
  try {
    db = publicProposalsDb(deps.db);
  } catch {
    return refuse(SEND_MESSAGES.unavailable);
  }

  // 2. The proposal, WITHOUT the emailed-link readiness (its rpcs come after the client's input is checked).
  const read = deps.read ? await deps.read(token, input.now, db) : await readPublicProposal(token, input.now, db, { emailSigning: false });
  if (read.status !== "ok" || read.handle.storedStatus !== "sent" || !read.view.content.loe || !read.view.letter) return refuse(SEND_MESSAGES.unavailable);

  // 3. The choices, through the ONE acceptance pricing function. Refused as today, before any rpc.
  const priced = quoteForAcceptance(read.view.content, input.selection, input.clientClasses);
  if (!priced.ok) return refuse("Choose at least one mark and one class to accept.");
  if (priced.missing.length > 0) return refuse(DESCRIBE_BEFORE_ACCEPT);
  if (!quoteHasItems(priced.quote)) return refuse("Choose at least one mark and one class to accept.");

  // The gate and readiness (both reads only).
  const handle = { proposalId: read.handle.proposalId, orgId: read.handle.orgId };
  const ready = deps.readiness ? await deps.readiness(handle, db) : await emailSigningReadyFor(handle, db);
  if (!ready.ready) return refuse(SEND_MESSAGES.unavailable);
  const { gate, row } = ready;

  // 4. The FINAL agreement: the in-app path's own builder, with the full legal name from "Your details" as the signer (D3).
  const built = buildServerAgreement({ read, content: priced.content, quote: priced.quote, details, signerName: details.client_name, now: input.now });
  if (!built.ok) return refuse(SEND_MESSAGES.unavailable);
  const sentTo = btrimSpaces(row.clientEmail);
  const timeZone = read.view.firm.timeZone;

  // 5. The snapshot the database stamps at signing (it fills the agreement block and accepted_at itself).
  const snapshot = buildAcceptedSnapshot({
    version: read.handle.version,
    content: priced.content,
    selection: priced.selection,
    quote: priced.quote,
    acceptedAt: input.now.toISOString(),
    signed: {
      agreement: { signature_id: null, signer_name: details.client_name, signed_at: input.now.toISOString(), sha256: built.sha256, template_version: null },
      signing: { details: { ...details }, date_text: built.dateText, client_email: sentTo },
    },
  });

  // 6. The token: 32 random bytes, url-safe (43 characters). Only its sha256 goes to the database.
  const signToken = (deps.randomBytes ?? randomBytes)(32).toString("base64url");
  const tokenSha256 = sha256(signToken);

  // 7. When the link stops working.
  const expiresAt = linkExpiresAt(input.now, read.view.expiresOn, timeZone);
  const expiresText = letterDateText(expiresAt, timeZone);

  const rawLoe = isObject(row.content.loe) ? (row.content.loe as unknown as Record<string, unknown>) : {};
  const templateVersion = typeof rawLoe.template_version === "number" ? rawLoe.template_version : null;
  const sdb = db as unknown as SigningDb;

  limiters.token.record(tokenKey);
  limiters.address.record(ipKey);

  // 8. ONE signing_open. Every answer other than an id is mapped (send-outcomes.ts); none leaves an open request.
  let requestId: string | null = null;
  try {
    const { data, error } = await sdb.rpc("client_proposal_signing_open", {
      p_proposal_id: row.proposalId,
      p_org_id: row.orgId,
      p_family_id: row.familyId,
      p_version: row.version,
      p_token_sha256: tokenSha256,
      p_expires_at: expiresAt.toISOString(),
      p_signer_name: details.client_name,
      p_signer_title: details.title || null,
      p_entity_name: details.entity_name || null,
      p_address: addressJson(details),
      p_details: { ...details },
      p_template_version: templateVersion,
      p_agreement_text: built.agreement.text,
      p_agreement_sha256: built.sha256,
      p_canonical_fingerprint: built.canonicalSha256,
      p_selection: priced.selection,
      p_snapshot: snapshot,
      p_date_text: built.dateText,
      p_words_id: gate.words.id,
      p_words_sha256: wordsSha256(gate.words),
    });
    if (error) {
      const outcome = signOpenOutcome(error);
      if (outcome.kind === "missing") {
        markSigningNotSetUp();
        return refuse(SEND_MESSAGES.unavailable);
      }
      if (outcome.kind === "precondition") return refuse(SEND_MESSAGES.unavailable);
      return refuse(await countedFailure(sdb, handle, outcome.failure));
    }
    if (typeof data !== "string" || data.length === 0) return refuse(await countedFailure(sdb, handle, "open_error"));
    requestId = data;
  } catch {
    return refuse(await countedFailure(sdb, handle, "open_error"));
  }

  // 9-11. From here every failure closes the request (failSend) before this function returns.
  try {
    const firmName = read.view.firm.displayName || read.view.firm.name;
    const pdf = await (deps.reviewPdf ?? defaultReviewPdf)({
      text: built.agreement.text,
      details,
      firmName,
      logo: letterLogoForSlug(read.view.firm.slug),
      title: read.view.content.loe.title || "Engagement letter",
    });
    const stamped = await sdb
      .from("client_proposal_signing_request")
      .update({ review_pdf_sha256: sha256(pdf) })
      .eq("id", requestId)
      .eq("org_id", row.orgId)
      .select("id");
    if (stamped.error || !Array.isArray(stamped.data) || stamped.data.length === 0) return refuse(await failSend(sdb, requestId, handle));

    const origin = await (deps.linkOrigin ?? clientLinkOrigin)(row.orgId);
    const mail = buildLinkEmail({
      words: gate.words,
      signingLink: signingLinkUrl(clientLinkUrl(origin, token), signToken),
      clientName: details.client_name,
      firmName,
      linkExpires: expiresText,
      to: sentTo,
      from: gate.from,
      apiKey: deps.apiKey ?? process.env.RESEND_API_KEY ?? "",
      pdf,
      signerName: details.client_name,
      requestId,
    });
    if (!mail || !mail.apiKey) return refuse(await failSend(sdb, requestId, handle));

    let answer: InternalMailResult;
    try {
      answer = await (deps.mailer ?? sendInternalMail)(mail);
    } catch {
      return refuse(await failSend(sdb, requestId, handle));
    }

    if (answer.status === "failed" && (answer.http !== null || answer.local === true)) return refuse(await failSend(sdb, requestId, handle));
    const uncertain = answer.status === "failed";

    const marked = await sdb.rpc("client_proposal_signing_mark_sent", { p_request_id: requestId, p_sent: true });
    if (marked.error) return refuse(await failSend(sdb, requestId, handle));
    // The email went (or may have) but the request was closed in between (a newer send, a withdrawal, a new version).
    if (marked.data !== true) return refuse(SEND_MESSAGES.superseded);

    const sentToMasked = maskEmail(sentTo);
    if (uncertain) {
      await noteFailure(sdb, handle, "mail_uncertain");
      if ((await failureCount(sdb, handle)) >= SEND_FAILURE_FALLBACK) return refuse(SEND_MESSAGES.sign_here_instead);
      return { ok: true, uncertain: true, sentTo: sentToMasked, expiresText };
    }
    return { ok: true, sentTo: sentToMasked, expiresText };
  } catch {
    // Anything that threw between signing_open and mark_sent (a PDF that would not build, a network drop).
    return refuse(await failSend(sdb, requestId, handle));
  }
}

/** Record a counted failure (the database, else this instance) and pick the sentence: at the threshold, sign here instead. */
async function countedFailure(db: SigningDb, handle: { proposalId: string; orgId: string }, kind: FailureKind): Promise<string> {
  await noteFailure(db, handle, kind);
  return (await failureCount(db, handle)) >= SEND_FAILURE_FALLBACK ? SEND_MESSAGES.sign_here_instead : SEND_MESSAGES.send_failed;
}

async function noteFailure(db: SigningDb, handle: { proposalId: string; orgId: string }, kind: FailureKind): Promise<void> {
  try {
    const { data, error } = await db.rpc("client_proposal_signing_note_failure", { p_proposal_id: handle.proposalId, p_org_id: handle.orgId, p_kind: kind });
    if (error || data !== true) noteLocalFailure(handle.proposalId);
  } catch {
    noteLocalFailure(handle.proposalId);
  }
}

/** The version's counted failures, read again (the database's plus this instance's). An unreadable count is below the threshold. */
async function failureCount(db: SigningDb, handle: { proposalId: string; orgId: string }): Promise<number> {
  const local = localFailures(handle.proposalId);
  try {
    const { data, error } = await db.rpc("client_proposal_signing_readiness", { p_proposal_id: handle.proposalId, p_org_id: handle.orgId });
    if (error) return local;
    const r = parseReadiness(data);
    return r.kind === "ok" ? r.failures + local : local;
  } catch {
    return local;
  }
}

/**
 * Close a request whose send failed, and make sure the failure is counted somewhere readiness looks (v3, D21):
 * mark_sent(false) -> else signing_close(send_failed) -> else a failure row (`close_error`) -> else this instance's memo.
 */
export async function failSend(db: SigningDb, requestId: string, handle: { proposalId: string; orgId: string }): Promise<string> {
  let closed = false;
  try {
    const r = await db.rpc("client_proposal_signing_mark_sent", { p_request_id: requestId, p_sent: false });
    closed = !r.error && r.data === true;
  } catch {
    closed = false;
  }
  if (!closed) {
    let closeErrored = false;
    try {
      const r = await db.rpc("client_proposal_signing_close", { p_request_id: requestId, p_reason: "send_failed" });
      closeErrored = !!r.error;
    } catch {
      closeErrored = true;
    }
    if (closeErrored) await noteFailure(db, handle, "close_error");
  }
  return (await failureCount(db, handle)) >= SEND_FAILURE_FALLBACK ? SEND_MESSAGES.sign_here_instead : SEND_MESSAGES.send_failed;
}
