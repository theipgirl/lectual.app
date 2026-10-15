import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getMatter } from "@/lib/matters/matters";
import { getFirmTimeZone } from "@/lib/org/profile";
import { quoteReference } from "@/lib/quotes/labels";
import { isMissingTableError } from "@/lib/quotes/load";
// The pure snapshot reader from the accept path that WRITES the record (the
// quote page does the same): one opinion about what a signed agreement is.
import { parseAcceptedSnapshot, type QuoteAcceptedSnapshot } from "@/lib/quotes/public";
import { quotesDb } from "@/lib/quotes/store";
import { buildLoePrefill, type LoePrefill } from "./loe-prefill";

/**
 * The signed quotes on a matter, for the engagement-letter form and the links
 * that lead to it.
 *
 * ── A SIGNED QUOTE IS ONE THE MATTER IS LINKED TO ───────────────────────────
 * `crm_quote.matter_id` with `status = 'accepted'`. That link is what
 * `openMatterForAcceptedQuote` writes when a signature opens the matter, and
 * what staff set when a quote is made for an existing matter. A quote linked
 * only to the matter's lead is not followed: which of a lead's quotes belongs to
 * which matter is not something to infer when the amount goes in a letter.
 *
 * ── THREE STATES, NEVER TWO ─────────────────────────────────────────────────
 * Like `loadQuote`: `ok` (the table was reached; an empty list really is "no
 * signed quote"), `unconfigured` (0068 is not in this database), `unavailable`
 * (anything else; we learned nothing). A caller that renders an empty list for
 * `unavailable` would tell staff there is no signed quote while one sits there.
 *
 * ── THE CALLER'S OWN CLIENT ─────────────────────────────────────────────────
 * Every read goes through `getScopedClient()`, so RLS on `active_org_id` decides
 * which quotes exist at all. Only the columns the letter needs are named: not
 * the public token, the signer's IP or browser.
 */

export type SignedQuoteForLoe = {
  quoteId: string;
  /** "QT-3F9A1C". */
  reference: string;
  title: string;
  /** The quote row's `accepted_at`. */
  acceptedAt: string | null;
  /** `null` = signed, but no readable signed copy is stored. The letter is never
   * built from the live lines instead. */
  snapshot: QuoteAcceptedSnapshot | null;
};

export type SignedQuotesLoad =
  | { status: "ok"; quotes: SignedQuoteForLoe[] }
  | { status: "unconfigured" }
  | { status: "unavailable" };

export async function loadSignedQuotesForMatter(matterId: string): Promise<SignedQuotesLoad> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await quotesDb(supabase)
      .from("crm_quote")
      .select("id, title, accepted_at, accepted_snapshot")
      .eq("matter_id", matterId)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error)) return { status: "unconfigured" };
      console.error("[documents] signed quotes for the engagement letter unreachable:", error);
      return { status: "unavailable" };
    }

    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const quotes: SignedQuoteForLoe[] = [];
    for (const row of rows) {
      if (typeof row.id !== "string") continue;
      quotes.push({
        quoteId: row.id,
        reference: quoteReference(row.id).toUpperCase(),
        title: typeof row.title === "string" ? row.title : "",
        acceptedAt: typeof row.accepted_at === "string" ? row.accepted_at : null,
        snapshot: parseAcceptedSnapshot(row.accepted_snapshot),
      });
    }
    return { status: "ok", quotes };
  } catch (error) {
    console.error("[documents] signed quotes for the engagement letter unreachable:", error);
    return { status: "unavailable" };
  }
}

export type SignedQuotePrefill =
  | { ok: true; prefill: LoePrefill }
  | { ok: false; reason: "matter_not_found" | "not_signed" | "unreadable" | "unavailable" };

/**
 * The pre-fill for ONE signed quote on ONE matter, re-derived on the server.
 *
 * The generate action calls this with the `quoteId` the form carried, because a
 * form field is the caller's word: the quote must be a signed quote on THIS
 * matter (RLS already confines both to the caller's firm) before the letter says
 * it came from it, and the figures it is compared with are the snapshot's, read
 * now, not whatever the browser sent back. Anything that cannot be confirmed is
 * a refusal, never a letter that claims a source it could not check.
 */
export async function prefillForSignedQuote(matterId: string, quoteId: string): Promise<SignedQuotePrefill> {
  let matter: Awaited<ReturnType<typeof getMatter>>;
  try {
    matter = await getMatter(matterId);
  } catch (error) {
    console.error("[documents] matter unreachable for the engagement letter:", error);
    return { ok: false, reason: "unavailable" };
  }
  if (!matter) return { ok: false, reason: "matter_not_found" };

  const load = await loadSignedQuotesForMatter(matter.id);
  if (load.status !== "ok") return { ok: false, reason: "unavailable" };
  const quote = load.quotes.find((q) => q.quoteId === quoteId);
  if (!quote) return { ok: false, reason: "not_signed" };
  if (!quote.snapshot) return { ok: false, reason: "unreadable" };

  return {
    ok: true,
    prefill: buildLoePrefill({
      quoteId: quote.quoteId,
      snapshot: quote.snapshot,
      matter,
      acceptedAt: quote.acceptedAt,
      timeZone: await getFirmTimeZone(),
    }),
  };
}
