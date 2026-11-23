import { createHash } from "node:crypto";
import { signedAtText, signedAtUtcIso } from "../signing";
import { CERTIFICATE_NOT_RECORDED } from "../client-words";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { MAX_SIGNATURE_PNG_BYTES } from "./sign-limits";
import type { EvidenceEvent, EvidenceRequest } from "./evidence";

/**
 * The certificate page of a LINK-signed letter (Sprint B), built ONLY from recorded evidence. Pure.
 *
 * Every fact comes from a column 0117 grants to `authenticated` (the request's timestamps and words version; the events), so
 * the service-role and the staff paths build the same page. `agreement_sha256`, `consent_sha256` and `sent_to` of the REQUEST are
 * never read. A value that was not recorded prints "Not recorded", never a guess.
 *
 * It is built only when the evidence chain holds (`checkCertificate`):
 *   - the request is `signed`, and is the request the accepted snapshot names (`signing_request_id`) with the signature row it names;
 *   - exactly one `sent`, one `consent`, one `signature` and one `signed` event exist;
 *   - the `signed` event's agreement sha256 equals the snapshot's AND the sha256 the caller verified the printed text against;
 *   - a drawn signature's bytes are a PNG of at most 100 KB whose sha256 equals the recorded `signature_sha256`.
 * A broken link in the chain is `missing` (the evidence isn't all there: try again, never a PDF without the page). A sha256 that
 * disagrees, or bytes that do not hash to what was recorded, is `mismatch` (an integrity problem: no copy, said once).
 */

export type CertificateSignature =
  | { kind: "drawn"; png: Uint8Array }
  | { kind: "typed"; style: string; name: string };

export type SigningCertificate = {
  sentTo: string;
  sentAt: string;
  openedAt: string;
  consentAt: string;
  consentSha256: string;
  wordsVersion: string;
  signedAt: string;
  signedAtUtc: string;
  ip: string;
  browser: string;
  letterFingerprint: string;
  typedName: string;
  signature: CertificateSignature;
};

export type CertificateCheck =
  | { kind: "ok"; certificate: SigningCertificate }
  | { kind: "missing" }
  | { kind: "mismatch" };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** True when the bytes are a PNG of at most 100 KB. Pure. */
export function isAcceptablePng(bytes: Uint8Array | null): bytes is Uint8Array {
  if (!bytes || bytes.length < PNG_MAGIC.length || bytes.length > MAX_SIGNATURE_PNG_BYTES) return false;
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

const when = (iso: string | null, tz: string): string => (iso ? signedAtText(iso, tz) || CERTIFICATE_NOT_RECORDED : CERTIFICATE_NOT_RECORDED);

export function checkCertificate(input: {
  request: EvidenceRequest;
  events: readonly EvidenceEvent[];
  snapshot: AcceptedSnapshot | null | undefined;
  /** The sha256 the printed text was hashed to and matched (`verifySignedCopy`). */
  verifiedSha256: string;
  tz: string;
}): CertificateCheck {
  const { request, events, snapshot, tz } = input;
  const agreement = snapshot?.agreement;
  if (!agreement || agreement.method !== "email_link" || !agreement.signing_request_id || !agreement.signature_id) return { kind: "missing" };
  if (request.status !== "signed" || request.id !== agreement.signing_request_id || request.signature_id !== agreement.signature_id) return { kind: "missing" };
  const of = (kind: string) => events.filter((e) => e.kind === kind);
  const [sent, consent, signature, signed] = [of("sent"), of("consent"), of("signature"), of("signed")];
  if (sent.length !== 1 || consent.length !== 1 || signature.length !== 1 || signed.length !== 1) return { kind: "missing" };
  const sig = signature[0];
  if (!sent[0].sent_to || !signature[0].typed_name || !signature[0].signature_sha256 || !signed[0].agreement_sha256) return { kind: "missing" };

  if (signed[0].agreement_sha256 !== agreement.sha256 || signed[0].agreement_sha256 !== input.verifiedSha256) return { kind: "mismatch" };

  let mark: CertificateSignature;
  if (sig.signature_kind === "drawn") {
    if (!isAcceptablePng(sig.signature_png)) return { kind: "mismatch" };
    if (sha256Hex(sig.signature_png) !== sig.signature_sha256) return { kind: "mismatch" };
    mark = { kind: "drawn", png: sig.signature_png };
  } else if (sig.signature_kind === "typed" && sig.typed_style) {
    mark = { kind: "typed", style: sig.typed_style, name: sig.typed_name! };
  } else {
    return { kind: "missing" };
  }

  const signedIso = request.signed_at;
  return {
    kind: "ok",
    certificate: {
      sentTo: sent[0].sent_to,
      sentAt: when(request.sent_at, tz),
      openedAt: when(request.opened_at, tz),
      consentAt: when(request.consent_at, tz),
      consentSha256: consent[0].consent_sha256 ?? CERTIFICATE_NOT_RECORDED,
      wordsVersion: request.words_version === null ? CERTIFICATE_NOT_RECORDED : String(request.words_version),
      signedAt: when(signedIso, tz),
      signedAtUtc: signedIso ? signedAtUtcIso(signedIso) || CERTIFICATE_NOT_RECORDED : CERTIFICATE_NOT_RECORDED,
      ip: signed[0].ip ?? CERTIFICATE_NOT_RECORDED,
      browser: signed[0].user_agent ? signed[0].user_agent.slice(0, 400) : CERTIFICATE_NOT_RECORDED,
      letterFingerprint: input.verifiedSha256,
      typedName: sig.typed_name!,
      signature: mark,
    },
  };
}

/** The contract's `certificateFrom`: the certificate, or null for every broken link (see `checkCertificate` for the cause). */
export function certificateFrom(input: Parameters<typeof checkCertificate>[0]): SigningCertificate | null {
  const r = checkCertificate(input);
  return r.kind === "ok" ? r.certificate : null;
}
