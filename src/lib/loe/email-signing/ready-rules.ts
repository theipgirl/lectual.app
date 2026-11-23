import type { LetterCopyCheck } from "../editor-state";

/**
 * Per-proposal readiness for the emailed link, pure (Sprint A item 2). Ready only when ALL hold: the gate is on; the proposal
 * carries a letter; the letter copy is the firm's CURRENT one (`letterLiveCheck` answers `current`); the proposal's client email
 * passes `isSigningAddress`; the database's own readiness (0117 `client_proposal_signing_readiness`) answers `ok`; and the counted
 * failures (the database's plus this instance's unrecorded ones) are under `SEND_FAILURE_FALLBACK`. Every uncertainty is NOT
 * ready, which means today's in-app signing: that is how a firm is never left with no way to sign.
 */

export const SEND_FAILURE_FALLBACK = 3;

export type ReadinessRpc =
  | { kind: "ok"; state: string; failures: number }
  /** The rpc errored, timed out or answered a shape this code doesn't know. */
  | { kind: "error" }
  /** A missing-object code (the caller also sets the runtime memo). */
  | { kind: "missing" };

export type ReadyFacts = {
  gateOn: boolean;
  hasLetter: boolean;
  letterCheck: LetterCopyCheck | null;
  addressOk: boolean;
  readiness: ReadinessRpc | null;
  localFailures: number;
};

export function readyDecision(f: ReadyFacts): boolean {
  if (!f.gateOn || !f.hasLetter || f.letterCheck !== "current" || !f.addressOk) return false;
  const r = f.readiness;
  if (!r || r.kind !== "ok" || r.state !== "ok") return false;
  if (!Number.isInteger(r.failures) || r.failures < 0) return false;
  return r.failures + Math.max(0, f.localFailures) < SEND_FAILURE_FALLBACK;
}

/** The rpc's jsonb answer read strictly: `{ state: string, failures: integer }`, else an unknown shape (= not ready). */
export function parseReadiness(data: unknown): ReadinessRpc {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "error" };
  const d = data as Record<string, unknown>;
  if (typeof d.state !== "string" || typeof d.failures !== "number" || !Number.isInteger(d.failures)) return { kind: "error" };
  return { kind: "ok", state: d.state, failures: d.failures };
}
