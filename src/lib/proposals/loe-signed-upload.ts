import { STEP_TEXT } from "./step-text";

/**
 * Filing the SIGNED engagement letter (a PDF) in the matter's Lawmatics Engagement folder (Sprint 6).
 *
 * The pure core: every dependency is passed in, so the order, the outcomes and the once-only rule are tested with fakes and no
 * network. It never throws, never logs, and never reads or writes the acceptance: a failed upload changes nothing about the
 * signing or the paid state; it is a line on the proposal's timeline (the step `signed_loe_upload`, success word `uploaded`).
 *
 * Outcomes: `uploaded`; `skipped` (the firm has no Lawmatics connection, a plain reason); `blocked` (no record, or more than one,
 * or the stored signed text does not match its recorded fingerprint: a person has to look, and trying again will not help);
 * `failed` (a call went wrong: the request, the connection check, the record lookup, the PDF).
 * Nothing of the letter, the signer's typed details or the PDF bytes is put in a reason.
 */

export type SignedUploadResult = { outcome: "uploaded" | "skipped" | "blocked" | "failed"; reason?: string };

export type SignedUploadToken = { status: "ok"; token: string } | { status: "not_connected" } | { status: "unavailable" };
export type SignedUploadTarget = { ok: true; lawmaticsId: string } | { ok: false; kind: "blocked" | "failed"; reason: string };

export type SignedUploadDeps = {
  /** The firm's OWN Lawmatics token (public path: its connection row; signed-in path: its active connection). Never an env token. */
  token: () => Promise<SignedUploadToken>;
  /** The Lawmatics record the proposal belongs to (the existing note-target resolution). */
  target: () => Promise<SignedUploadTarget>;
  /** The signed letter as PDF bytes (`buildVerifiedSignedPdf`); throws when no file can honestly be built. */
  buildPdf: () => Promise<Uint8Array>;
  upload: (token: string, file: { matterId: string; fileName: string; mime: "application/pdf"; bytes: Uint8Array }) => Promise<{ ok: true } | { ok: false; reason: string }>;
  fileName: string;
};

/**
 * Thrown by `buildPdf` when no copy of the signed letter can EVER be built from what is stored (the stored signed text does not
 * match its recorded fingerprint). The step is then `blocked` with one fixed sentence, not `failed`: trying again cannot help,
 * and a person has to look. It carries no text of its own, so nothing a caller writes can end up on the timeline.
 */
export class SignedUploadBlocked extends Error {
  constructor() {
    super("blocked");
    this.name = "SignedUploadBlocked";
  }
}

/** `signed`: is there a signed letter on this version at all (a schema-2 snapshot)? Anything falsy is "nothing to file". */
export async function runSignedLoeUpload(signed: unknown, deps: SignedUploadDeps): Promise<SignedUploadResult> {
  try {
    if (!signed) return { outcome: "blocked", reason: STEP_TEXT.signedNoLetter };
    const token = await deps.token();
    if (token.status === "not_connected") return { outcome: "skipped", reason: STEP_TEXT.signedNotConnected };
    if (token.status === "unavailable") return { outcome: "failed", reason: STEP_TEXT.signedConnectionUnreadable };

    const target = await deps.target();
    if (!target.ok) return { outcome: target.kind, reason: target.reason };

    let bytes: Uint8Array;
    try {
      bytes = await deps.buildPdf();
    } catch (err) {
      if (err instanceof SignedUploadBlocked) return { outcome: "blocked", reason: STEP_TEXT.signedMismatch };
      return { outcome: "failed", reason: STEP_TEXT.signedNotBuilt };
    }
    const sent = await deps.upload(token.token, { matterId: target.lawmaticsId, fileName: deps.fileName, mime: "application/pdf", bytes });
    return sent.ok ? { outcome: "uploaded" } : { outcome: "failed", reason: sent.reason };
  } catch {
    return { outcome: "failed", reason: "unexpected error" };
  }
}
