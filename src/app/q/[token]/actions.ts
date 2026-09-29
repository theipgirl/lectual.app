"use server";

import { headers } from "next/headers";
import { acceptPublicQuote, declinePublicQuote, type AcceptRefusal, type DeclineRefusal } from "@/lib/quotes/public";
import { readClientChoice } from "@/lib/quotes/packages";
import { payAcceptedQuote, type PayRefusal } from "@/lib/quotes/public-payment";

/**
 * The two server actions an ANONYMOUS visitor may invoke.
 *
 * ── A SERVER ACTION IS ITS OWN ENTRY POINT ──────────────────────────────────
 * `"use server"` compiles to a POST endpoint that does not render this route's
 * page or layout and inherits nothing from either. So the page having resolved
 * the token and checked expiry buys these functions nothing: a caller can POST
 * here directly with any arguments, at any time. Every argument is hostile, and
 * both re-resolve everything — quote id, org id, status, expiry, which package
 * and add-ons are on offer — from the TOKEN inside `src/lib/quotes/public.ts`.
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
 * before any database round trip, and ticking a box writes nothing at all (the
 * client's pick travels with the signature — see packages.ts).
 */

/** The request's client IP and user agent — an e-sign audit hint, never
 * identity. `parseInet` drops anything that is not an address literal. */
async function requestAudit(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

export type AcceptActionResult = { ok: boolean; reason?: AcceptRefusal; message?: string };

/**
 * Sign the proposal. Two things travel with the signature so the frozen
 * snapshot records what was on the client's screen: the package and add-ons
 * they picked (`choice`, re-validated against the offer as it stands now) and
 * the agreement fingerprint of the render they read (only ever COMPARED to one
 * recomputed from a fresh read — a stale or missing one refuses). Nothing is
 * charged here: payment is a separate step on the receipt (payQuoteAction), so
 * a declined card can never cost a signature.
 */
export async function acceptQuoteAction(input: {
  token: string;
  name: string;
  email?: string;
  choice: { package: string | null; addOns: string[] };
  linesFingerprint: string;
}): Promise<AcceptActionResult> {
  const { ip, userAgent } = await requestAudit();
  const result = await acceptPublicQuote(
    {
      token: String(input?.token ?? ""),
      name: String(input?.name ?? ""),
      email: typeof input?.email === "string" ? input.email : null,
      choice: readClientChoice(input?.choice),
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

export type PayActionResult = { ok: boolean; reason?: PayRefusal; message?: string };

/**
 * Pay the amount due at signing on an ALREADY-SIGNED proposal (spec §7.4).
 *
 * Takes the link's token and the single-use Hosted Fields payment token —
 * nothing else. The amount, the quote, the firm, and the firm's operating
 * account are all re-resolved server-side from the token and the SIGNED
 * snapshot (src/lib/quotes/public-payment.ts). No card number ever reaches this
 * server: the browser sends an opaque token from AffiniPay's own iframes.
 */
export async function payQuoteAction(input: { token: string; methodToken: string }): Promise<PayActionResult> {
  try {
    const result = await payAcceptedQuote(
      { token: String(input?.token ?? ""), methodToken: String(input?.methodToken ?? "") },
      new Date(),
    );
    return result.ok ? { ok: true } : { ok: false, reason: result.reason, message: result.message };
  } catch (err) {
    // Never a thrown digest on a payment page. Whether anything was sent is
    // unknown from here, so the page is told to confirm, not to retry.
    console.error("[payments] payQuoteAction threw", err instanceof Error ? err.message : err);
    return { ok: false, reason: "indeterminate" };
  }
}
