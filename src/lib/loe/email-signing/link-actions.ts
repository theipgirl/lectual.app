import "server-only";

import { LINK_UNAVAILABLE, SIGN_LINK_MESSAGES } from "../client-words";
import { hasPrefix, isDeadlock, isMissingObjectError } from "./codes";
import type { SigningDb } from "./db";
import { markSigningNotSetUp } from "./not-set-up";
import { closeUnusable, verifyLinkPair, type VerifyDeps } from "./verify";

/**
 * The two small POST actions of the `?sign=` page (Sprint A items 11b and 13). Each runs `verifyLinkPair` FIRST (no write before
 * the pair is proven), then 11c's close where it applies, then its one rpc. Every mismatch answers the identical
 * `LINK_UNAVAILABLE`; nothing here logs the token, the address or the words.
 */

export type Audit = { ip: string | null; userAgent: string | null };

const ua = (v: string | null): string | null => (typeof v === "string" && v.trim() ? v.slice(0, 400) : null);

/** "Opened": recorded by the browser after mount, only for a verified, open link. Answers nothing the page shows. */
export async function recordOpened(publicToken: string, signToken: string, deps: VerifyDeps & { audit: Audit; db: SigningDb }): Promise<void> {
  try {
    const pair = await verifyLinkPair(publicToken, signToken, deps);
    if (!pair.ok) {
      if (pair.close) await closeUnusable(deps.db, pair.close, deps.audit);
      return;
    }
    if (pair.state !== "open" || pair.request.opened_at !== null) return;
    const r = await deps.db.rpc("client_proposal_signing_opened", { p_token_sha256: pair.tokenSha256, p_ip: deps.audit.ip, p_user_agent: ua(deps.audit.userAgent) });
    if (r.error && isMissingObjectError(r.error)) markSigningNotSetUp();
  } catch {
    // Silent by design.
  }
}

export type ConsentResult = { ok: true } | { ok: false; message: string };

/** The first click: consent, with the sha256 of the consent text the page drew. Only after `ok` does the page show the box. */
export async function recordConsent(
  publicToken: string,
  signToken: string,
  consentSha256: unknown,
  deps: VerifyDeps & { audit: Audit; db: SigningDb },
): Promise<ConsentResult> {
  try {
    const pair = await verifyLinkPair(publicToken, signToken, deps);
    if (!pair.ok) {
      if (pair.close) await closeUnusable(deps.db, pair.close, deps.audit);
      return { ok: false, message: LINK_UNAVAILABLE };
    }
    if (pair.state !== "open") return { ok: false, message: LINK_UNAVAILABLE };
    if (typeof consentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(consentSha256)) return { ok: false, message: SIGN_LINK_MESSAGES.reload };
    if (pair.request.opened_at === null) {
      const o = await deps.db.rpc("client_proposal_signing_opened", { p_token_sha256: pair.tokenSha256, p_ip: deps.audit.ip, p_user_agent: ua(deps.audit.userAgent) });
      if (o.error) return { ok: false, message: mapError(o.error) };
      if (o.data !== "open") return { ok: false, message: LINK_UNAVAILABLE };
    }
    const c = await deps.db.rpc("client_proposal_signing_consent", {
      p_token_sha256: pair.tokenSha256,
      p_consent_sha256: consentSha256,
      p_ip: deps.audit.ip,
      p_user_agent: ua(deps.audit.userAgent),
    });
    if (c.error) return { ok: false, message: mapError(c.error) };
    return c.data === true ? { ok: true } : { ok: false, message: LINK_UNAVAILABLE };
  } catch {
    return { ok: false, message: SIGN_LINK_MESSAGES.try_again };
  }
}

function mapError(error: { code?: string; message?: string }): string {
  if (isMissingObjectError(error)) {
    markSigningNotSetUp();
    return LINK_UNAVAILABLE;
  }
  if (isDeadlock(error)) return SIGN_LINK_MESSAGES.try_again;
  if (hasPrefix(error, "signing_consent_mismatch")) return SIGN_LINK_MESSAGES.reload;
  if (hasPrefix(error, "signing_link_closed")) return LINK_UNAVAILABLE;
  return SIGN_LINK_MESSAGES.try_again;
}
