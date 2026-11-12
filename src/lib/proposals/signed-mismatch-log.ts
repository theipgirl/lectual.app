/**
 * The one log line for a signed engagement letter whose stored text does not hash to its recorded fingerprint. An integrity
 * problem Lectual needs to hear about, so it is logged; and privileged content, so NOTHING of it is: the proposal's id and the
 * step that found it, and that is all. Never the letter, the signer, the address, either hash, or an error message.
 */
export type SignedMismatchStep = "client_view" | "client_download" | "staff_download" | "signed_loe_upload";

export function logSignedMismatch(proposalId: string, step: SignedMismatchStep): void {
  console.error(`[proposals] signed letter does not match its recorded fingerprint proposal=${proposalId} step=${step}`);
}
