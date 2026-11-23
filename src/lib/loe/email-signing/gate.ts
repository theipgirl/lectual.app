import "server-only";

import type { SigningWords } from "../signing-words";
import { isMissingObjectError } from "./codes";
import type { SigningDb } from "./db";
import { isObject } from "./db";
import { gateDecision, type GateFacts, type GateReason, type ProbeFact, type WordsFact } from "./gate-rules";
import { firmMailFrom } from "./mail-config";
import { markSigningNotSetUp, signingNotSetUp } from "./not-set-up";

/**
 * THE gate for the emailed signing link (Sprint A item 1). ONE function, fail closed: `on` only when the deployment switch is
 * exactly "on", mail is configured for THIS firm, 0117 is fully applied (the probe, and the runtime memo is clear) and the firm
 * has approved signing words. Every `on: false` means today's in-app signing. The decision itself is `gateDecision`
 * (`gate-rules.ts`, pure); this file only does the two reads it asks for, as the service role, fenced on the org.
 */

export type ApprovedSigningWords = SigningWords & { id: string; version: number };

export type GateResult = { on: true; words: ApprovedSigningWords; from: string } | { on: false; reason: GateReason };

export type GateEnv = { LOE_EMAIL_SIGNING?: string; RESEND_API_KEY?: string; FIRM_CLIENT_MAIL_FROM?: string; SITE_URL?: string };

export const WORDS_COLUMNS = "id, version, consent_line, consent_text, sign_line, box_note, link_subject, link_body, copy_subject, copy_body";

function readWords(row: unknown): ApprovedSigningWords | null {
  if (!isObject(row)) return null;
  const keys = ["id", "consent_line", "consent_text", "sign_line", "box_note", "link_subject", "link_body", "copy_subject", "copy_body"] as const;
  for (const k of keys) if (typeof row[k] !== "string") return null;
  if (typeof row.version !== "number") return null;
  return row as unknown as ApprovedSigningWords;
}

export async function emailSigningGate(orgId: string, deps: { db: () => SigningDb; env?: GateEnv }): Promise<GateResult> {
  const env = deps.env ?? (process.env as GateEnv);
  const from = firmMailFrom(orgId, env);
  const facts: GateFacts = {
    switchValue: env.LOE_EMAIL_SIGNING,
    hasKey: typeof env.RESEND_API_KEY === "string" && env.RESEND_API_KEY.trim().length > 0,
    hasFrom: from !== null,
    memoNotSetUp: signingNotSetUp(),
  };
  let step = gateDecision(facts);
  if (step !== "need_probe" && step !== "need_words") return step.on ? { on: false, reason: "unreadable" } : step;

  let db: SigningDb;
  try {
    db = deps.db();
  } catch {
    return { on: false, reason: "unreadable" };
  }

  let probe: ProbeFact;
  try {
    const { data, error } = await db.rpc("client_proposal_signing_probe", {});
    if (error) probe = isMissingObjectError(error) ? "missing" : "error";
    else probe = data === 117 ? "ok" : "error";
  } catch {
    probe = "error";
  }
  if (probe === "missing") markSigningNotSetUp();
  step = gateDecision({ ...facts, probe });
  if (step !== "need_words") return step === "need_probe" || step.on ? { on: false, reason: "unreadable" } : step;

  let words: WordsFact;
  let approved: ApprovedSigningWords | null = null;
  try {
    const { data, error } = await db
      .from("client_proposal_signing_words")
      .select(WORDS_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "approved")
      .maybeSingle();
    if (error) words = isMissingObjectError(error) ? "missing" : "error";
    else if (data === null || data === undefined) words = "none";
    else {
      approved = readWords(data);
      words = approved ? "approved" : "error";
    }
  } catch {
    words = "error";
  }
  if (words === "missing") markSigningNotSetUp();
  const final = gateDecision({ ...facts, probe, words });
  if (final === "need_probe" || final === "need_words") return { on: false, reason: "unreadable" };
  if (!final.on) return final;
  if (!approved || !from) return { on: false, reason: "unreadable" };
  return { on: true, words: approved, from };
}
