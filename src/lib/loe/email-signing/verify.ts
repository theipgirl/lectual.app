import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { parseInet } from "@/lib/quotes/public";
import { isWellFormedProposalToken, type AcceptedSnapshot, type ProposalContent } from "@/lib/proposals/types";
import type { LetterCopyCheck } from "../editor-state";
import { letterLiveCheck } from "../live-guard";
import { linkAddressLimiter, linkTokenLimiter } from "../review-limit";
import { isMissingObjectError } from "./codes";
import { isObject, type SigningDb } from "./db";
import { emailSigningGate, type GateResult } from "./gate";
import { markSigningNotSetUp } from "./not-set-up";

/**
 * THE verifier of a `?sign=` link pair (Sprint A item 11, v2 B4/B5): the page's read AND every action run it first, and it has NO
 * side effect (no rpc write, no close) before the pair is proven. In order:
 *   1. shapes: the `/p/` token's own check, and the signing token (base64url, exactly 43 characters);
 *   2. limiters keyed by sha256(signing token), never the raw token (courtesy, per instance);
 *   3. sha256(signing token);
 *   4. ONE read of the request by `token_sha256`, named columns only, with its proposal embedded through the (proposal_id, org_id)
 *      foreign key in the SAME request, so "not found" and "found, other proposal" take the same path up to step 5;
 *   5. the proposal's `public_token` compared with the page's `/p/` token in CONSTANT TIME;
 *   6. the gate for the proposal row's org, then `letterLiveCheck` for the proposal row (`current` required);
 *   7. the state, judged from the read: `open` and unexpired -> usable; `signed` -> the done screen only when the proposal is
 *      accepted by THAT request's signature; anything else -> unusable.
 * Every failure of 1-7 is the same `{ ok: false }` (the page says only "This link is no longer available."). When steps 1-5
 * passed for a request still in flight but it is past its expiry or its letter was replaced, `close` says so: ONLY a POST action
 * writes that close (a GET can be an email scanner and writes nothing).
 */

export const SIGN_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const REQUEST_COLUMNS =
  "id, org_id, proposal_id, status, expires_at, opened_at, consent_at, signed_at, signature_id, agreement_text, agreement_sha256, consent_line, consent_text, consent_sha256, sign_line, box_note, signer_name";
export const EMBEDDED_PROPOSAL = "proposal:client_proposal!client_proposal_signing_request_proposal_org_fk(public_token, status, org_id, content, accepted_snapshot, pay_url, title, expires_on)";

export type LinkRequest = {
  id: string;
  org_id: string;
  proposal_id: string;
  status: string;
  expires_at: string;
  opened_at: string | null;
  consent_at: string | null;
  signed_at: string | null;
  signature_id: string | null;
  agreement_text: string;
  agreement_sha256: string;
  consent_line: string;
  consent_text: string;
  consent_sha256: string;
  sign_line: string;
  box_note: string;
  signer_name: string;
};

export type LinkProposal = {
  public_token: string;
  status: string;
  org_id: string;
  content: ProposalContent;
  accepted_snapshot: AcceptedSnapshot | null;
  pay_url: string | null;
  title: string | null;
};

export type VerifiedPair =
  | { ok: true; state: "open" | "signed"; tokenSha256: string; request: LinkRequest; proposal: LinkProposal; gate: Extract<GateResult, { on: true }> }
  | { ok: false; close?: { reason: "expired" | "proposal_changed"; requestId: string; tokenSha256: string } };

export type VerifyDeps = {
  db: SigningDb;
  now: Date;
  ip?: string | null;
  gate?: (orgId: string) => Promise<GateResult>;
  letterCheck?: (row: { org_id: string; content: ProposalContent }) => Promise<LetterCopyCheck>;
  limiters?: { token: typeof linkTokenLimiter; address: typeof linkAddressLimiter };
};

const NO: VerifiedPair = { ok: false };

export const sha256Hex = (v: string): string => createHash("sha256").update(v, "utf8").digest("hex");

/** Constant-time equality of two tokens; unequal lengths are a mismatch (compared against itself so the time does not leak which). */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) {
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

function readRequest(row: unknown): { request: LinkRequest; proposal: LinkProposal } | null {
  if (!isObject(row) || !isObject(row.proposal)) return null;
  const strings = ["id", "org_id", "proposal_id", "status", "expires_at", "agreement_text", "agreement_sha256", "consent_line", "consent_text", "consent_sha256", "sign_line", "box_note", "signer_name"];
  for (const k of strings) if (typeof row[k] !== "string") return null;
  const p = row.proposal;
  if (typeof p.public_token !== "string" || typeof p.status !== "string" || typeof p.org_id !== "string" || !isObject(p.content)) return null;
  return {
    request: row as unknown as LinkRequest,
    proposal: {
      public_token: p.public_token,
      status: p.status,
      org_id: p.org_id,
      content: p.content as unknown as ProposalContent,
      accepted_snapshot: isObject(p.accepted_snapshot) ? (p.accepted_snapshot as unknown as AcceptedSnapshot) : null,
      pay_url: typeof p.pay_url === "string" ? p.pay_url : null,
      title: typeof p.title === "string" ? p.title : null,
    },
  };
}

export async function verifyLinkPair(publicToken: string, signToken: string, deps: VerifyDeps): Promise<VerifiedPair> {
  try {
    // 1. Shapes.
    const pub = String(publicToken ?? "");
    const sig = String(signToken ?? "");
    if (!isWellFormedProposalToken(pub) || !SIGN_TOKEN_SHAPE.test(sig)) return NO;

    // 2-3. Limiters by the token's sha256 (never the raw token), then the hash.
    const tokenSha256 = sha256Hex(sig);
    const limiters = deps.limiters ?? { token: linkTokenLimiter, address: linkAddressLimiter };
    const tokenKey = `s:${tokenSha256}`;
    const ipKey = `ip:${parseInet(deps.ip) ?? "unknown"}`;
    if (!limiters.token.allowed(tokenKey) || !limiters.address.allowed(ipKey)) return NO;
    limiters.token.record(tokenKey);
    limiters.address.record(ipKey);

    // 4. ONE read, the proposal embedded in the same request.
    const { data, error } = await deps.db
      .from("client_proposal_signing_request")
      .select(`${REQUEST_COLUMNS}, ${EMBEDDED_PROPOSAL}`)
      .eq("token_sha256", tokenSha256)
      .maybeSingle();
    if (error) {
      if (isMissingObjectError(error)) markSigningNotSetUp();
      // Compare anyway so a failed read takes the same constant-time step as a mismatch.
      sameToken(pub, pub);
      return NO;
    }
    const found = readRequest(data);
    // 5. Constant time, whether or not the hash was found.
    const matches = sameToken(pub, found ? found.proposal.public_token : pub.replace(/./g, "\u0000"));
    if (!found || !matches) return NO;
    const { request, proposal } = found;
    if (request.proposal_id === "" || proposal.org_id !== request.org_id) return NO;

    const inFlight = request.status === "open" || request.status === "sending";
    const expired = Date.parse(request.expires_at) <= deps.now.getTime();

    // 6. The gate, then the letter check, for the proposal row.
    const gate = await (deps.gate ?? ((orgId: string) => emailSigningGate(orgId, { db: () => deps.db })))(proposal.org_id);
    if (!gate.on) return NO;
    const check = deps.letterCheck ?? ((r) => letterLiveCheck(deps.db as unknown as SupabaseClient<Database>, r));
    let letter: LetterCopyCheck;
    try {
      letter = await check({ org_id: proposal.org_id, content: proposal.content });
    } catch {
      letter = "unreadable";
    }
    if (letter === "stale" && inFlight) return { ok: false, close: { reason: "proposal_changed", requestId: request.id, tokenSha256 } };
    if (letter !== "current") return NO;

    // 7. State.
    if (request.status === "signed") {
      const snapshotRequest = proposal.accepted_snapshot?.agreement?.signing_request_id;
      if (proposal.status === "accepted" && typeof snapshotRequest === "string" && snapshotRequest === request.id) {
        return { ok: true, state: "signed", tokenSha256, request, proposal, gate };
      }
      return NO;
    }
    if (request.status === "open" && expired) return { ok: false, close: { reason: "expired", requestId: request.id, tokenSha256 } };
    if (request.status === "open" && !expired && proposal.status === "sent") return { ok: true, state: "open", tokenSha256, request, proposal, gate };
    return NO;
  } catch {
    return NO;
  }
}

/**
 * 11c: a POST action that found the link unusable for a reason the app can see writes the close. Past its expiry:
 * `signing_opened` closes it `expired`; a replaced letter: `signing_close(proposal_changed)`. Never from a GET. Never throws.
 */
export async function closeUnusable(db: SigningDb, close: NonNullable<Extract<VerifiedPair, { ok: false }>["close"]>, audit: { ip: string | null; userAgent: string | null }): Promise<void> {
  try {
    const r =
      close.reason === "expired"
        ? await db.rpc("client_proposal_signing_opened", { p_token_sha256: close.tokenSha256, p_ip: audit.ip, p_user_agent: audit.userAgent })
        : await db.rpc("client_proposal_signing_close", { p_request_id: close.requestId, p_reason: "proposal_changed" });
    if (r.error && isMissingObjectError(r.error)) markSigningNotSetUp();
  } catch {
    // The link refuses either way.
  }
}
