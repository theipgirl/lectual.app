/**
 * The sentence above Accept on the client's proposal page. It names the firm (from its profile,
 * falling back to the firm's name) and restates only what the page already shows: the marks and
 * classes picked, the fees shown, and that an engagement letter follows. It gives no advice and
 * promises no outcome.
 */
export function commitmentSentence(firmName: string): string {
  const name = firmName.trim() || "the firm";
  return `By accepting, you agree to ${name} starting work on the marks and classes above for the fees shown. You'll get an engagement letter to sign.`;
}

/** Spec 9: the same sentence for a general (flat-fee) proposal: the work described, not marks and classes. */
export function generalCommitmentSentence(firmName: string): string {
  const name = firmName.trim() || "the firm";
  return `By accepting, you agree to ${name} starting the work described above for the fee shown. You'll get an engagement letter to sign.`;
}

/** The name the page uses for the firm: the profile's display name, else the firm's own name. Never a hard-coded firm. */
export function firmDisplayName(profileDisplayName: string | null | undefined, orgName: string): string {
  const fromProfile = (profileDisplayName ?? "").trim();
  return fromProfile || orgName.trim();
}
