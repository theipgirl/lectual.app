import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SUBMIT_LIMITS } from "./public-submit";

/**
 * Spam guards and anonymous session hashing for the public intake. Takes its
 * keys as arguments (no env, no DB), so every rule here is unit-tested.
 *
 * ── NO IDENTITIES ───────────────────────────────────────────────────────────
 * Nothing here stores or returns an IP address or a cookie value. The throttle
 * keys on an HMAC of the IP, held in memory only; the funnel's `session_hash`
 * is an HMAC of a random first-party cookie, and is null when no salt is
 * configured (0075: "session_hash is a salted hash, never an IP or cookie
 * value" — an unsalted hash of a cookie would be the cookie by another name).
 *
 * ── THE RENDER STAMP ────────────────────────────────────────────────────────
 * The page stamps each render with the time and the Referer host, and the
 * submission reads both back: the time is the minimum-fill-time guard, the
 * host is `source_host`. When `INTAKE_EVENT_SALT` is set the stamp is signed,
 * so neither can be forged; unset, it is accepted as sent (it still stops the
 * scripted POST that never loaded the page, which is most of them).
 */

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function hmac(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

export function makeStamp(input: { formKey: string; now: number; host: string | null; key: string | null }): string {
  const host = (input.host ?? "").slice(0, 255);
  const body = `${input.now}.${b64u(host)}`;
  const sig = input.key ? hmac(input.key, `${input.formKey}|${body}`).slice(0, 32) : "-";
  return `${body}.${sig}`;
}

export type StampCheck =
  | { ok: true; host: string | null; startedAt: number }
  | { ok: false; reason: "malformed" | "forged" | "too_fast" | "expired" };

export function checkStamp(stamp: string, input: { formKey: string; now: number; key: string | null }): StampCheck {
  const m = /^(\d{1,16})\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]{32}|-)$/.exec(stamp);
  if (!m) return { ok: false, reason: "malformed" };
  const [, ts, hostB64, sig] = m;
  if (input.key) {
    const want = hmac(input.key, `${input.formKey}|${ts}.${hostB64}`).slice(0, 32);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) {
      return { ok: false, reason: "forged" };
    }
  }
  const startedAt = Number(ts);
  const age = input.now - startedAt;
  if (age < SUBMIT_LIMITS.minFillMs) return { ok: false, reason: "too_fast" };
  if (age > SUBMIT_LIMITS.maxStampAgeMs) return { ok: false, reason: "expired" };
  let host: string | null = null;
  try {
    host = unb64u(hostB64) || null;
  } catch {
    host = null;
  }
  return { ok: true, host: host ? host.slice(0, 255) : null, startedAt };
}

/** The Referer's host, lowercased, or null. Never the path or query: those can carry a prospect's details. */
export function refererHost(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.host.toLowerCase().slice(0, 255) || null;
  } catch {
    return null;
  }
}

/** The client's IP from proxy headers (first x-forwarded-for hop), or null. Used only as HMAC input. */
export function clientIp(h: { get(name: string): string | null }): string | null {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || null;
}

/** HMAC of the client's IP for the in-memory throttle. Never stored. */
export function clientKey(ip: string | null, key: string): string | null {
  return ip ? hmac(key, `ip:${ip}`).slice(0, 32) : null;
}

/** The funnel's `session_hash` (≤ 64 chars, 0075's check), or null without a salt or a cookie. */
export function sessionHash(sessionId: string | null | undefined, formId: string, salt: string | null): string | null {
  if (!salt || !sessionId) return null;
  return createHmac("sha256", salt).update(`session:${formId}:${sessionId}`).digest("hex");
}

export function newSessionId(): string {
  return randomBytes(16).toString("base64url");
}

export const SESSION_COOKIE = "lx_isid";
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * A sliding-window counter. In memory, per server instance: on serverless it
 * is a speed bump, not a wall — which is why the submission action ALSO
 * counts recent `complete` events for the session hash in the database.
 */
export class SlidingWindowThrottle {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 5000,
  ) {}

  /** Records a hit and says whether it is allowed. A refused hit is not recorded. */
  take(key: string, now: number): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    // Oldest-inserted keys go first; the map never grows without bound.
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
    return true;
  }
}
