import { acceptRefusalMessage, buildSigningAgreement, prepareAcceptance, type PublicProposalsDb } from "@/lib/proposals/public";
import { checkSignerFields, type SignerDetails } from "@/lib/loe/signing";
import { canonicalFingerprint } from "@/lib/loe/fingerprint";
import type { Exhibit } from "@/lib/loe/exhibit";
import type { LetterBlock } from "@/lib/loe/render";
import type { LetterCopyCheck } from "@/lib/loe/editor-state";
import type { ProposalContent } from "@/lib/proposals/types";
import {
  ADOBE_FALLBACK_SENTENCE,
  ADOBE_SIGN_HERE_INSTEAD,
  ESIGN_BUSY_SENTENCE,
  ESIGN_PAUSED_SENTENCE,
  ESIGN_SIGNED_WAITING_SENTENCE,
  SIGN_MESSAGES,
} from "@/lib/loe/client-words";
import { AdobeCallError, errorForThrown, type LastErrorCode } from "./adobe-errors";
import {
  cancelAgreement,
  createAgreement,
  fetchSigningUrl,
  readAgreementStatus,
  registerWebhook,
  uploadTransientDocument,
  type AdobeAccess,
  type AdobeFetch,
  type AgreementStatus,
} from "./adobe-client";
import type { AdobeAccessResult } from "./adobe-connection";
import { OPEN_REQUEST_STATUSES, isNotSetUpError, type EsignDb } from "./db";
import { isAdobeSigningUrl } from "./host-rule";
import { agreementPayload, expirationInstant, postSignRedirect, SIGNING_FILE_NAME, webhookPayload } from "./payload";
import { closeOrphanedRequest, closeStuckCreating } from "./path";

/**
 * `startAdobeSigning` (Sprint 5a, contract item 7), with every dependency injected so it runs against fakes. Public and
 * TOKEN-ONLY: the proposal, its firm, its status and every price come from the token's read; nothing the browser sends names a
 * proposal or an org, and nothing it says about money is read.
 *
 * In order:
 *  1. The SAME agreement half as the in-app signature (`prepareAcceptance` + `checkSignerFields` + `buildSigningAgreement`,
 *     factored out of `signAndAccept`, D10): the typed name is the signer name (never `client_name`), both date fields are the
 *     firm-zone date of THIS call (D11), and the browser's canonical fingerprint must equal ours (`stale` otherwise). No row and
 *     no Adobe call before this passes.
 *  2. An open request for this version: unchanged choices resume (a fresh `signingUrls`), even with the switch off. Changed
 *     choices, or a resume whose `signingUrls` fails, re-read the agreement FIRST (`settleOpen`): signed → a waiting sentence and
 *     nothing else; closed at Adobe, or our cancel succeeded → close it and start again (switch on) or in-app (switch off); a
 *     failed re-read or refused cancel → paused, the request left open. A request whose connection is gone is closed and the
 *     page is in-app. A request still being created is "busy".
 *  3. Readiness for a NEW agreement: the switch is exactly on, the firm's connection is active, the letter copy is the firm's
 *     current one, and the client email is a real address. Otherwise in-app.
 *  4. The `for-signature` PDF is rendered BEFORE anything is written. The request is opened through
 *     `client_proposal_esign_open` (never a plain insert), as `creating`, with the final text, its sha256, the canonical
 *     fingerprint and the PDF bytes' sha256.
 *  5. Adobe: transientDocuments → agreements → (at once) one update to `out_for_signature` with the agreement id → a RESOURCE
 *     webhook (non-fatal: `webhook_not_registered`) → `signingUrls` (no `frameParent`; retried on Adobe's not-yet-processed 404).
 *     The `esignUrl` must pass the host rule. It is returned for a TOP-LEVEL navigation and never stored or logged.
 *  6. Any failure: the request goes to `failed` with a code from the closed set, a created agreement is cancelled at Adobe
 *     (a failed cancel sets `cancel_failed`), nothing is accepted, and the page gets `fallback: "in_app"` (D1, D7).
 *
 * Nothing here logs, and no sentence here is Adobe's.
 */

export type StartInput = {
  token: string;
  selection: unknown;
  clientClasses: unknown;
  details: unknown;
  typedName: unknown;
  fingerprint: unknown;
};

export type StartResult = { ok: true; url: string } | { ok: false; fallback: "in_app"; message: string } | { ok: false; message: string };

export type ForSignaturePdf = (input: { blocks: readonly LetterBlock[]; exhibit: Exhibit; details: SignerDetails; firmName: string; firmSlug: string; title: string }) => Promise<Uint8Array>;

export type StartDeps = {
  now: Date;
  /** `ADOBE_SIGN_CLIENT_SIGNING === "on"` (D15). */
  switchOn: boolean;
  /** The service-role client. Every statement is fenced on the proposal row's own org. */
  db: EsignDb & PublicProposalsDb;
  /** The firm's access, fenced on the proposal's org (and on a request's connection when resuming). */
  access: (orgId: string, connectionId?: string) => Promise<AdobeAccessResult>;
  /** A 401 on a call: the firm's connection goes to `reauth`. */
  markReauth: (orgId: string, connectionId: string) => Promise<void>;
  fetchImpl: AdobeFetch;
  renderPdf: ForSignaturePdf;
  letterCurrent: (row: { org_id: string; content: ProposalContent }) => Promise<LetterCopyCheck>;
  linkOrigin: (orgId: string) => Promise<string>;
  /** `<site origin>/api/esign/webhook/`. */
  webhookUrl: string;
  sleep?: (ms: number) => Promise<void>;
};

const fallback = (message: string = ADOBE_FALLBACK_SENTENCE): StartResult => ({ ok: false, fallback: "in_app", message });
const fail = (message: string): StartResult => ({ ok: false, message });

const REAL_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SIGNING_URL_TRIES = 4;
const SIGNING_URL_WAIT_MS = 750;

type OpenRow = { id: string; status: "creating" | "out_for_signature"; connectionId: string | null; agreementId: string | null; fingerprint: string | null };

async function readOpen(db: EsignDb, proposalId: string, orgId: string): Promise<{ state: "ok"; open: OpenRow | null } | { state: "not-set-up" } | { state: "unavailable" }> {
  try {
    const { data, error } = await db
      .from("client_proposal_esign_request")
      .select("id, status, connection_id, adobe_agreement_id, canonical_fingerprint")
      .eq("proposal_id", proposalId)
      .eq("org_id", orgId)
      .in("status", OPEN_REQUEST_STATUSES);
    if (error) return isNotSetUpError(error) ? { state: "not-set-up" } : { state: "unavailable" };
    const row = (Array.isArray(data) ? (data as Record<string, unknown>[]) : [])[0];
    if (!row) return { state: "ok", open: null };
    if (typeof row.id !== "string" || (row.status !== "creating" && row.status !== "out_for_signature")) return { state: "unavailable" };
    return {
      state: "ok",
      open: {
        id: row.id,
        status: row.status,
        connectionId: typeof row.connection_id === "string" ? row.connection_id : null,
        agreementId: typeof row.adobe_agreement_id === "string" ? row.adobe_agreement_id : null,
        fingerprint: typeof row.canonical_fingerprint === "string" ? row.canonical_fingerprint : null,
      },
    };
  } catch {
    return { state: "unavailable" };
  }
}

/** A status change, fenced on id, org and the expected from-status(es). Returns how many rows changed (0 = this caller lost). */
async function moveRequest(db: EsignDb, id: string, orgId: string, from: readonly string[], patch: Record<string, unknown>): Promise<number> {
  try {
    const { data, error } = await db.from("client_proposal_esign_request").update(patch).eq("id", id).eq("org_id", orgId).in("status", from).select("id");
    if (error || !Array.isArray(data)) return 0;
    return data.length;
  } catch {
    return 0;
  }
}

async function markCancelFailed(db: EsignDb, id: string, orgId: string): Promise<void> {
  try {
    await db.from("client_proposal_esign_request").update({ cancel_failed: true }).eq("id", id).eq("org_id", orgId);
  } catch {
    // Nothing more can be recorded.
  }
}

/** Cancels at Adobe with the cancellation email off. False when Adobe refused or couldn't be reached. */
async function cancelAt(deps: StartDeps, access: AdobeAccess, agreementId: string, orgId: string, connectionId: string): Promise<boolean> {
  try {
    await cancelAgreement(deps.fetchImpl, access, agreementId);
    return true;
  } catch (err) {
    if (err instanceof AdobeCallError && err.reauth) await deps.markReauth(orgId, connectionId);
    return false;
  }
}

async function signingUrlWithRetry(deps: StartDeps, access: AdobeAccess, agreementId: string): Promise<string> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      const url = await fetchSigningUrl(deps.fetchImpl, access, agreementId);
      // Never send a browser to a host outside the rule: that is a creation failure, not a link.
      if (!isAdobeSigningUrl(url)) throw new AdobeCallError("adobe_refused", null, false);
      return url;
    } catch (err) {
      const e = errorForThrown(err);
      if (e.notReady && attempt < SIGNING_URL_TRIES) {
        await sleep(SIGNING_URL_WAIT_MS * attempt);
        continue;
      }
      throw e;
    }
  }
}

export async function runStartAdobeSigning(input: StartInput, deps: StartDeps): Promise<StartResult> {
  const { now, db } = deps;

  // 1. The token's read and the server's own price (the in-app path's own refusals).
  const prepared = await prepareAcceptance(String(input.token ?? ""), input.selection, now, db, input.clientClasses);
  if (!prepared.ok) return fail(acceptRefusalMessage(prepared.reason));
  const { read, content, selection, quote } = prepared;
  if (!content.loe) return fail(SIGN_MESSAGES.letter_unavailable);

  // The typed name and the details: no tick on this path (D19), Adobe's signature act replaces it.
  const fields = checkSignerFields({ typedName: input.typedName, details: input.details });
  if (!fields.ok) return fail(SIGN_MESSAGES[fields.reason]);

  const half = buildSigningAgreement({ read, content, selection, quote, now, typedName: fields.typedName, details: fields.details, fingerprint: input.fingerprint });
  if (!half.ok) return fail(SIGN_MESSAGES[half.reason]);
  const canonical = canonicalFingerprint(half.agreement.canonical);
  const { proposalId, orgId, familyId, version } = read.handle;

  // 2. What is already open for this version (a stuck `creating` row is closed first).
  if ((await closeStuckCreating(db, { proposalId, orgId }, now)) === "not-set-up") return fallback(ADOBE_SIGN_HERE_INSTEAD);
  const open = await readOpen(db, proposalId, orgId);
  if (open.state === "not-set-up") return fallback(ADOBE_SIGN_HERE_INSTEAD);
  if (open.state === "unavailable") return fail(ESIGN_PAUSED_SENTENCE);

  if (open.open) {
    const o = open.open;
    if (o.status === "creating") return fail(ESIGN_BUSY_SENTENCE);
    // The request's connection is gone (null, revoked, deleted): close it, fenced on its status, and sign in-app.
    const orphaned = async (): Promise<StartResult> => {
      await closeOrphanedRequest(db, { proposalId, orgId }, { id: o.id, status: o.status, connectionId: o.connectionId });
      return fallback(ADOBE_SIGN_HERE_INSTEAD);
    };
    if (!o.connectionId) return orphaned();
    const access = await deps.access(orgId, o.connectionId);
    if (access.kind === "none") return orphaned();
    // reauth, unavailable (or 0113 vanished): the request stays open; never in-app, never a new agreement.
    if (access.kind !== "ok") return fail(ESIGN_PAUSED_SENTENCE);
    const acc: AdobeAccess = { accessPoint: access.accessPoint, accessToken: access.accessToken };
    const settleCtx = { id: o.id, orgId, agreementId: o.agreementId, access: acc, connectionId: access.connectionId };

    if (o.fingerprint === canonical && o.agreementId) {
      // Unchanged choices: resume (allowed with the switch off, D18).
      try {
        return { ok: true, url: await signingUrlWithRetry(deps, acc, o.agreementId) };
      } catch (err) {
        if (err instanceof AdobeCallError && err.reauth) {
          await deps.markReauth(orgId, access.connectionId);
          return fail(ESIGN_PAUSED_SENTENCE);
        }
        // Never `failRequest` here: the client may already have signed. Ask Adobe first.
        const settled = await settleOpen(deps, settleCtx);
        if (settled !== "closed") return settled;
        if (!deps.switchOn) return fallback(ADOBE_SIGN_HERE_INSTEAD);
      }
    } else {
      // Changed choices: ask Adobe before cancelling or closing anything.
      const settled = await settleOpen(deps, settleCtx);
      if (settled !== "closed") return settled;
      if (!deps.switchOn) return fallback(ADOBE_SIGN_HERE_INSTEAD);
    }
  }

  // 3. Readiness for a NEW agreement.
  if (!deps.switchOn) return fallback(ADOBE_SIGN_HERE_INSTEAD);
  const access = await deps.access(orgId);
  if (access.kind !== "ok") return fallback(ADOBE_SIGN_HERE_INSTEAD);
  const acc: AdobeAccess = { accessPoint: access.accessPoint, accessToken: access.accessToken };
  if (!REAL_EMAIL.test(half.clientEmail)) return fallback(ADOBE_SIGN_HERE_INSTEAD);

  // The stored content as it is (the public read carries only title, body and kind of the letter): the letter guard and the
  // template version come from it, fenced on the row's own id and org.
  let storedContent: ProposalContent | null = null;
  try {
    const { data, error } = await db.from("client_proposal").select("content").eq("id", proposalId).eq("org_id", orgId).maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (!error && row && row.content && typeof row.content === "object") storedContent = row.content as ProposalContent;
  } catch {
    storedContent = null;
  }
  if (!storedContent) return fallback(ADOBE_SIGN_HERE_INSTEAD);
  if ((await deps.letterCurrent({ org_id: orgId, content: storedContent })) !== "current") return fallback(ADOBE_SIGN_HERE_INSTEAD);
  const templateVersion = typeof storedContent.loe?.template_version === "number" ? storedContent.loe.template_version : null;

  // 4. The PDF first, then the request (through the database function, never a plain insert).
  let pdf: Uint8Array;
  try {
    pdf = await deps.renderPdf({
      blocks: half.agreement.blocks,
      exhibit: half.agreement.exhibit,
      details: fields.details,
      firmName: read.view.firm.displayName,
      firmSlug: read.view.firm.slug,
      title: content.loe.title,
    });
  } catch {
    return fallback();
  }
  const sentPdfSha256 = await sha256Bytes(pdf);

  if (typeof db.rpc !== "function") return fallback(ADOBE_SIGN_HERE_INSTEAD);
  let requestId: string;
  try {
    const { data, error } = await db.rpc("client_proposal_esign_open", {
      p_proposal_id: proposalId,
      p_org_id: orgId,
      p_family_id: familyId,
      p_version: version,
      p_connection_id: access.connectionId,
      p_signer_name: half.args.p_signer_name,
      p_signer_title: half.args.p_signer_title,
      p_entity_name: half.args.p_entity_name,
      p_address: half.args.p_address,
      p_template_version: templateVersion,
      p_details: { ...fields.details },
      p_signer_email: half.clientEmail,
      p_selection: half.args.p_selection,
      p_snapshot: half.args.p_snapshot,
      p_agreement_text: half.args.p_agreement_text,
      p_agreement_sha256: half.args.p_agreement_sha256,
      p_canonical_fingerprint: canonical,
      p_sent_pdf_sha256: sentPdfSha256,
    });
    if (error) {
      const message = typeof error.message === "string" ? error.message : "";
      if (message.startsWith("esign_proposal_changed")) return fail(SIGN_MESSAGES.stale);
      if (error.code === "23505") return fail(SIGN_MESSAGES.esign_open);
      return fallback(isNotSetUpError(error) ? ADOBE_SIGN_HERE_INSTEAD : ADOBE_FALLBACK_SENTENCE);
    }
    if (typeof data !== "string" || data.length === 0) return fallback();
    requestId = data;
  } catch {
    return fallback();
  }

  // 5. Adobe.
  let agreementId: string | null = null;
  try {
    const transientId = await uploadTransientDocument(deps.fetchImpl, acc, pdf, SIGNING_FILE_NAME);
    const origin = await deps.linkOrigin(orgId);
    agreementId = await createAgreement(
      deps.fetchImpl,
      acc,
      agreementPayload({
        transientDocumentId: transientId,
        signerEmail: half.clientEmail,
        signerName: fields.typedName,
        requestId,
        letterTitle: content.loe.title,
        expirationTime: expirationInstant(read.view.expiresOn, read.view.firm.timeZone),
        redirectUrl: postSignRedirect(origin, String(input.token)),
      }),
    );
  } catch (err) {
    return failRequest(deps, { id: requestId, orgId, from: ["creating"], agreementId, access: acc, connectionId: access.connectionId }, err);
  }

  // As soon as the agreement exists: the one update that records it, BEFORE the next two calls. 0 rows = the row was closed
  // under us (the path read's 10-minute rule): cancel what we made and fall back.
  const moved = await moveRequest(db, requestId, orgId, ["creating"], { status: "out_for_signature", adobe_agreement_id: agreementId });
  if (moved === 0) {
    const cancelled = await cancelAt(deps, acc, agreementId, orgId, access.connectionId);
    if (!cancelled) await markCancelFailed(db, requestId, orgId);
    return fallback();
  }

  try {
    await registerWebhook(deps.fetchImpl, acc, webhookPayload(agreementId, deps.webhookUrl));
  } catch (err) {
    if (err instanceof AdobeCallError && err.reauth) await deps.markReauth(orgId, access.connectionId);
    // Not fatal: the return check and the sweep still find completion (5b).
    await moveRequest(db, requestId, orgId, ["out_for_signature"], { last_error: "webhook_not_registered" });
  }

  try {
    return { ok: true, url: await signingUrlWithRetry(deps, acc, agreementId) };
  } catch (err) {
    return failRequest(deps, { id: requestId, orgId, from: ["out_for_signature"], agreementId, access: acc, connectionId: access.connectionId }, err);
  }
}

const CLOSED_AT_ADOBE: Partial<Record<AgreementStatus, string>> = { CANCELLED: "cancelled", EXPIRED: "expired", DECLINED: "declined" };

/**
 * An open request this press would replace or could not resume. Adobe's own status decides (one version is never signed twice):
 *  - SIGNED → nothing is cancelled, closed or created and the client is NOT sent in-app; a fixed waiting sentence (5b's
 *    completion path records it);
 *  - CANCELLED / EXPIRED / DECLINED at Adobe → the request is closed to match, and the caller continues;
 *  - still open → cancelled at Adobe (emails off); only when that cancel succeeds is the request closed and the caller continues;
 *  - a re-read that fails, or a cancel Adobe refuses → the request stays `out_for_signature`: paused.
 */
async function settleOpen(
  deps: StartDeps,
  r: { id: string; orgId: string; agreementId: string | null; access: AdobeAccess; connectionId: string },
): Promise<"closed" | StartResult> {
  if (!r.agreementId) {
    await moveRequest(deps.db, r.id, r.orgId, ["out_for_signature"], { status: "cancelled" });
    return "closed";
  }
  let status: AgreementStatus;
  try {
    status = await readAgreementStatus(deps.fetchImpl, r.access, r.agreementId);
  } catch (err) {
    if (err instanceof AdobeCallError && err.reauth) await deps.markReauth(r.orgId, r.connectionId);
    return fail(ESIGN_PAUSED_SENTENCE);
  }
  if (status === "SIGNED") return fail(ESIGN_SIGNED_WAITING_SENTENCE);
  const closedAs = CLOSED_AT_ADOBE[status];
  if (closedAs) {
    await moveRequest(deps.db, r.id, r.orgId, ["out_for_signature"], { status: closedAs });
    return "closed";
  }
  if (!(await cancelAt(deps, r.access, r.agreementId, r.orgId, r.connectionId))) return fail(ESIGN_PAUSED_SENTENCE);
  await moveRequest(deps.db, r.id, r.orgId, ["out_for_signature"], { status: "cancelled" });
  return "closed";
}

/** A creation (or resume) failure: `failed` with a closed-set code, the agreement cancelled, in-app for this visit. */
async function failRequest(
  deps: StartDeps,
  r: { id: string; orgId: string; from: readonly string[]; agreementId: string | null; access: AdobeAccess; connectionId: string },
  err: unknown,
): Promise<StartResult> {
  const e = errorForThrown(err);
  if (e.reauth) await deps.markReauth(r.orgId, r.connectionId);
  const code: LastErrorCode = e.failure;
  await moveRequest(deps.db, r.id, r.orgId, r.from, { status: "failed", last_error: code });
  if (r.agreementId) {
    const cancelled = await cancelAt(deps, r.access, r.agreementId, r.orgId, r.connectionId);
    if (!cancelled) await markCancelFailed(deps.db, r.id, r.orgId);
  }
  return fallback();
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

