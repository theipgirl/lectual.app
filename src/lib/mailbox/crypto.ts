import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets for mailbox connections.
 *
 * Tokens are sealed with AES-256-GCM before they reach the database, so the
 * DB (and anyone reading a backup of it) only ever holds ciphertext. The
 * 0057 migration adds a second wall on top: `authenticated` has no SELECT on
 * the token columns at all. Only the service-role sync job decrypts.
 *
 * One root secret, MAILBOX_TOKEN_KEY (32 random bytes, base64), with a
 * separate key DERIVED for each use via HKDF — so the key that seals tokens
 * is never the key that signs OAuth state, and leaking a signature can't
 * help anyone forge ciphertext or vice versa.
 *
 * Pure functions over an explicit key so tests need no env; callers get the
 * key from `rootKeyFromEnv()`.
 */

const SEALED_PREFIX = "v1";

export class MailboxKeyError extends Error {}

/** Parse and validate the root key. Throws rather than falling back to anything. */
export function parseRootKey(base64: string | undefined): Buffer {
  if (!base64) throw new MailboxKeyError("MAILBOX_TOKEN_KEY is not set.");
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new MailboxKeyError("MAILBOX_TOKEN_KEY must be 32 random bytes, base64-encoded.");
  }
  return key;
}

function derive(root: Buffer, purpose: "token-seal" | "oauth-state"): Buffer {
  return Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), `lectual-mailbox:${purpose}`, 32));
}

const b64u = (b: Buffer) => b.toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

/** Seal a token. Output: `v1.<iv>.<tag>.<ciphertext>`, base64url parts. */
export function sealToken(root: Buffer, plaintext: string): string {
  const key = derive(root, "token-seal");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [SEALED_PREFIX, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(".");
}

/** Open a sealed token. Throws on any tampering, truncation or wrong key. */
export function openToken(root: Buffer, sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== SEALED_PREFIX) {
    throw new MailboxKeyError("Not a sealed mailbox token.");
  }
  const [, iv, tag, ct] = parts;
  const decipher = createDecipheriv("aes-256-gcm", derive(root, "token-seal"), unb64u(iv));
  decipher.setAuthTag(unb64u(tag));
  return Buffer.concat([decipher.update(unb64u(ct)), decipher.final()]).toString("utf8");
}

/** HMAC-SHA256 signature over `data`, for the OAuth state cookie. */
export function signState(root: Buffer, data: string): string {
  return b64u(createHmac("sha256", derive(root, "oauth-state")).update(data).digest());
}

/** Constant-time signature check. */
export function verifyStateSignature(root: Buffer, data: string, signature: string): boolean {
  const expected = unb64u(signState(root, data));
  const given = unb64u(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
