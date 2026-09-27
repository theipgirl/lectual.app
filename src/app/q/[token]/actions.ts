"use server";

import { headers } from "next/headers";
import {
  acceptPublicQuote,
  applyPublicSelection,
  declinePublicQuote,
  type AcceptRefusal,
  type DeclineRefusal,
  type SelectionRefusal,
} from "@/lib/quotes/public";

/**
 * The three server actions an ANONYMOUS visitor may invoke.
 *
 * ── A SERVER ACTION IS ITS OWN ENTRY POINT ──────────────────────────────────
 * `"use server"` compiles to a POST endpoint that does not render this route's
 * page or layout and inherits nothing from either. So the page having resolved
 * the token and checked expiry buys these functions nothing: a caller can POST
 * here directly with any arguments, at any time. Every argument is hostile, and
 * all three re-resolve everything — quote id, org id, status, expiry, which
 * line ids belong to the quote — from the TOKEN inside `src/lib/quotes/public.ts`.
 * There is no quote-id or org-id parameter anywhere: a caller who could name
 * the quote could name someone else's.
 *
 * Results are discriminated, never thrown: an uncaught throw reaches the
 * browser as a digest, and "something went wrong" on the page where someone is
 * signing a fee agreement is the worst copy available. The token is never
 * echoed back, logged, or put in a redirect.
 *
 * No rate limiter exists in front of this route (a known gap, as in lectual).
 * What stands in for one is cheapness of refusal: a malformed token is refused
 * before any database round trip, and an unchanged selection writes nothing.
 */

/** The request's client IP and user agent — an e-sign audit hint, never
 * identity. `parseInet` drops anything that is not an address literal. */
async function requestAudit(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

export type SelectionActionResult = { ok: boolean; reason?: SelectionRefusal };

/** Record the client's package / add-on choice as they make it. Best-effort:
 * acceptance sends the selection again and re-validates it. */
export async function saveSelectionAction(token: string, lineIds: string[]): Promise<SelectionActionResult> {
  const result = await applyPublicSelection(String(token ?? ""), Array.isArray(lineIds) ? lineIds : [], new Date());
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export type AcceptActionResult = { ok: boolean; reason?: AcceptRefusal; message?: string };

/**
 * Sign the proposal. Two things travel with the signature so the frozen
 * snapshot records what was on the client's screen: the choices they ticked
 * (`lineIds`, re-validated against this quote's own lines) and the agreement
 * fingerprint of the render they read (only ever COMPARED to one recomputed
 * from a fresh read — a stale or missing one refuses). Nothing is charged:
 * this app takes no payments.
 */
export async function acceptQuoteAction(input: {
  token: string;
  name: string;
  email: string;
  lineIds: string[];
  linesFingerprint: string;
}): Promise<AcceptActionResult> {
  const { ip, userAgent } = await requestAudit();
  const result = await acceptPublicQuote(
    {
      token: String(input?.token ?? ""),
      name: String(input?.name ?? ""),
      email: String(input?.email ?? ""),
      selectedLineIds: Array.isArray(input?.lineIds) ? input.lineIds : [],
      linesFingerprint: String(input?.linesFingerprint ?? ""),
      ip,
      userAgent,
    },
    new Date(),
  );
  // The snapshot stays server-side: the page re-reads and renders the receipt
  // from the stored record, so the one thing the client sees afterwards is the
  // one in the database.
  return result.ok ? { ok: true } : { ok: false, reason: result.reason, message: result.message };
}

export type DeclineActionResult = { ok: boolean; reason?: DeclineRefusal };

/** Decline the proposal. Takes the token and nothing else — no reason text is
 * stored from an anonymous caller. */
export async function declineQuoteAction(token: string): Promise<DeclineActionResult> {
  const result = await declinePublicQuote(String(token ?? ""), new Date());
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
