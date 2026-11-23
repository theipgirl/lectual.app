import { createHash } from "node:crypto";
import type { EvidenceEvent, EvidenceRequest, SigningEvidence } from "@/lib/loe/email-signing/evidence";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { signedTrademark } from "../signed-fixtures";

/** A real 1x1 PNG (decodable by pdfkit), and its sha256: what a drawn signature's bytes and recorded hash look like. */
export const PNG_BYTES = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);
export const PNG_SHA = createHash("sha256").update(PNG_BYTES).digest("hex");

export const REQUEST_ID = "11111111-2222-4333-8444-555555555555";
export const SIGNATURE_ID = "99999999-2222-4333-8444-555555555555";
export const SENT_TO = "link-signer@example.com";
export const CONSENT_SHA = "d".repeat(64);

/** The fixture's trademark acceptance, signed through the emailed link (the real fingerprint of its text is kept). */
export function linkSnapshot(): AcceptedSnapshot {
  const s = signedTrademark();
  return { ...s, agreement: { ...s.agreement!, method: "email_link", signing_request_id: REQUEST_ID, signature_id: SIGNATURE_ID } };
}

const ev = (kind: string, over: Partial<EvidenceEvent> = {}): EvidenceEvent => ({
  kind,
  at: "2026-11-12T19:00:00.000Z",
  ip: null,
  user_agent: null,
  sent_to: null,
  consent_sha256: null,
  signature_kind: null,
  signature_png: null,
  typed_style: null,
  signature_sha256: null,
  typed_name: null,
  agreement_sha256: null,
  ...over,
});

/** The evidence a completed link signing leaves, in the columns 0117 grants (the request has no address, hash or text). */
export function evidenceFor(snapshot: AcceptedSnapshot, over: { request?: Partial<EvidenceRequest>; events?: EvidenceEvent[]; typed?: boolean } = {}): SigningEvidence {
  const agreement = snapshot.agreement!;
  const request: EvidenceRequest = {
    id: REQUEST_ID,
    org_id: "org-1",
    proposal_id: "44444444-4444-4444-8444-444444444444",
    status: "signed",
    sent_at: "2026-11-12T18:50:00.000Z",
    opened_at: "2026-11-12T18:58:00.000Z",
    consent_at: "2026-11-12T19:00:00.000Z",
    signed_at: agreement.signed_at,
    signature_id: SIGNATURE_ID,
    words_version: 4,
    copy_subject: "Your signed letter from {{firm_name}}",
    copy_body: "Hello {{client_name}}, your signed copy is attached.",
    ...over.request,
  };
  const signature = over.typed
    ? ev("signature", { signature_kind: "typed", typed_style: "print", signature_sha256: "e".repeat(64), typed_name: agreement.signer_name })
    : ev("signature", { signature_kind: "drawn", signature_png: PNG_BYTES, signature_sha256: PNG_SHA, typed_name: agreement.signer_name });
  const events = over.events ?? [
    ev("sent", { sent_to: SENT_TO }),
    ev("opened", { ip: "203.0.113.9", user_agent: "Scanner/1.0" }),
    ev("consent", { consent_sha256: CONSENT_SHA }),
    signature,
    ev("signed", { ip: "203.0.113.7", user_agent: "Sample Browser/9.0", agreement_sha256: agreement.sha256 }),
  ];
  return { request, events };
}
