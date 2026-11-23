import "server-only";

import { createHash } from "node:crypto";
import { safeHttpsUrl } from "@/components/client-proposal/format";
import { LINK_UNAVAILABLE, SIGN_LINK_MESSAGES } from "../client-words";
import { MIN_SIGNED_NAME, cleanTypedName, signedLineText } from "../signing";
import { hasPrefix, isDeadlock, isMissingObjectError } from "./codes";
import { isObject, type SigningDb } from "./db";
import type { Audit } from "./link-actions";
import { readFirm } from "./link-read";
import { namesMatch } from "./name-fold";
import { markSigningNotSetUp } from "./not-set-up";
import { closeUnusable, verifyLinkPair, type VerifyDeps } from "./verify";

/**
 * Sign through the emailed link (Sprint A item 15): `verifyLinkPair` -> 11c's close where it applies -> the typed full legal name
 * (cleaned with `cleanTypedName`, folded with `foldName` and compared with the name the letter was sent with, refused BEFORE the
 * rpc) -> the signature checked here (a drawn PNG of at most 100 KB, or the one typed style `print`), its sha256 computed HERE ->
 * ONE `client_proposal_signing_sign`, the one database transaction that signs and accepts. On `signed_now = true` the firm notice
 * and the acceptance follow-ups run exactly as the in-app path schedules them; a repeat (`signed_now = false`) runs nothing.
 * Nothing here logs the name, the signature, the token or the address.
 */

export const MAX_SIGNATURE_PNG_BYTES = 102_400;
export const TYPED_STYLE = "print";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

export type SignatureInput = { kind: "drawn"; png: string } | { kind: "typed"; style: "print" };

export type CheckedSignature =
  | { kind: "drawn"; bytes: Buffer; sha256: string }
  | { kind: "typed"; style: "print"; sha256: string };

const sha256 = (v: string | Buffer): string => createHash("sha256").update(v).digest("hex");

/** The signature as posted, checked. `typed` hashes sha256("print" + U+001F + the CLEANED name), 0117's rule. Null = refused. */
export function checkSignature(raw: unknown, cleanedName: string): CheckedSignature | null {
  if (!isObject(raw)) return null;
  if (raw.kind === "drawn") {
    if (typeof raw.png !== "string" || raw.png.length > 200_000) return null;
    const m = DATA_URL.exec(raw.png);
    if (!m) return null;
    const bytes = Buffer.from(m[1], "base64");
    if (bytes.length < PNG_MAGIC.length || bytes.length > MAX_SIGNATURE_PNG_BYTES) return null;
    if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return null;
    return { kind: "drawn", bytes, sha256: sha256(bytes) };
  }
  if (raw.kind === "typed" && raw.style === TYPED_STYLE) {
    return { kind: "typed", style: TYPED_STYLE, sha256: sha256(`${TYPED_STYLE}\u001f${cleanedName}`) };
  }
  return null;
}

export type SignResult =
  | { ok: true; signedLine: string; payUrl: string | null }
  | { ok: false; message: string; needConsent?: true };

export type SignDeps = VerifyDeps & {
  db: SigningDb;
  audit: Audit;
  /** The firm notice and the acceptance follow-ups, exactly as the in-app path schedules them (`notifyFirmOfAcceptance`). */
  notify: (input: { proposalId: string; orgId: string }) => Promise<void>;
};

function refusal(error: { code?: string; message?: string }): Extract<SignResult, { ok: false }> {
  if (isMissingObjectError(error)) {
    markSigningNotSetUp();
    return { ok: false, message: LINK_UNAVAILABLE };
  }
  if (isDeadlock(error)) return { ok: false, message: SIGN_LINK_MESSAGES.retry };
  if (hasPrefix(error, "signing_name_mismatch")) return { ok: false, message: SIGN_LINK_MESSAGES.name_mismatch };
  if (hasPrefix(error, "signing_no_consent")) return { ok: false, message: SIGN_LINK_MESSAGES.reload, needConsent: true };
  if (hasPrefix(error, "signing_link_closed") || hasPrefix(error, "signing_changed") || hasPrefix(error, "signing_letter_replaced")) {
    return { ok: false, message: LINK_UNAVAILABLE };
  }
  return { ok: false, message: SIGN_LINK_MESSAGES.retry };
}

export async function signByLink(
  input: { publicToken: string; signToken: string; typedName: unknown; signature: unknown },
  deps: SignDeps,
): Promise<SignResult> {
  try {
    const pair = await verifyLinkPair(input.publicToken, input.signToken, deps);
    if (!pair.ok) {
      if (pair.close) await closeUnusable(deps.db, pair.close, deps.audit);
      return { ok: false, message: LINK_UNAVAILABLE };
    }
    if (pair.state !== "open") return { ok: false, message: LINK_UNAVAILABLE };
    if (pair.request.consent_at === null) return { ok: false, message: SIGN_LINK_MESSAGES.reload, needConsent: true };

    const name = cleanTypedName(input.typedName);
    if (name.length < MIN_SIGNED_NAME || !namesMatch(name, pair.request.signer_name)) return { ok: false, message: SIGN_LINK_MESSAGES.name_mismatch };
    const signature = checkSignature(input.signature, name);
    if (!signature) return { ok: false, message: SIGN_LINK_MESSAGES.retry };

    const { data, error } = await deps.db.rpc("client_proposal_signing_sign", {
      p_token_sha256: pair.tokenSha256,
      p_typed_name: name,
      p_signature_kind: signature.kind,
      // bytea over PostgREST: hex with the \x prefix.
      p_signature_png: signature.kind === "drawn" ? `\\x${signature.bytes.toString("hex")}` : null,
      p_typed_style: signature.kind === "typed" ? signature.style : null,
      p_signature_sha256: signature.sha256,
      p_ip: deps.audit.ip,
      p_user_agent: typeof deps.audit.userAgent === "string" && deps.audit.userAgent.trim() ? deps.audit.userAgent.slice(0, 400) : null,
    });
    if (error) return refusal(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!isObject(row) || typeof row.signed_at !== "string" || typeof row.signed_now !== "boolean") return { ok: false, message: SIGN_LINK_MESSAGES.retry };

    if (row.signed_now === true) {
      try {
        await deps.notify({ proposalId: pair.request.proposal_id, orgId: pair.proposal.org_id });
      } catch {
        // Never let a notice break a signing.
      }
    }

    const firm = await readFirm(deps.db, pair.proposal.org_id).catch(() => null);
    const signedLine = firm ? signedLineText(row.signed_at, firm.timeZone, pair.request.signer_name) : "";
    return { ok: true, signedLine, payUrl: safeHttpsUrl(pair.proposal.pay_url) };
  } catch {
    return { ok: false, message: SIGN_LINK_MESSAGES.retry };
  }
}
