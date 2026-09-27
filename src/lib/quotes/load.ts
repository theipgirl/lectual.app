import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { quotesDb } from "./store";
import type { QuoteEventRow, QuoteLineRow, QuoteRow } from "./types";

/**
 * Three-state reads for the quote engine's list/detail surfaces — the same
 * shape `src/lib/queue/load.ts` established for the approval queue, adapted
 * to what can actually go wrong on THIS table.
 *
 * The queue's three states distinguish "no queue wired up for this org" from
 * "the deployed queue service is down". Quotes have no external service to
 * be down — but they have something structurally identical: migrations are
 * applied by hand to two cloud projects, so "code deployed, 0068 not applied
 * here" is a reachable state. lectual's AGENTS.md
 * itself documents dev falling four migrations behind prod before, "which
 * left crm_matter_deadline missing and the matter pages 500ing against dev
 * while prod was fine." A quote surface built on these tables must degrade
 * the same way the calendar and queue loaders do, not 500 — so:
 *
 *   ok            — the table exists and was reached; `quotes`/`lines` is
 *                    the truth (an empty array here really does mean "no
 *                    quotes yet", never "we don't know").
 *   unconfigured  —0068 hasn't been applied to THIS environment yet
 *                    (`reason: "schema"`). Distinguished on the PostgREST
 *                    error CODE (`PGRST205`, "could not find the table in
 *                    the schema cache") or the raw Postgres code (`42P01`,
 *                    undefined_table) — never on message text, the same
 *                    discipline `loadCalendarEvents` uses to separate "not
 *                    connected" from "unreachable".
 *   unavailable   — anything else: a real outage. We don't know what's
 *                    waiting.
 *
 * Never throws. A broken quote read must not take down the page it renders
 * on any more than a broken queue read does.
 */

export type QuotesLoadStatus = "ok" | "unconfigured" | "unavailable";

/** The only reason this module can currently report for `unconfigured` —
 * kept as a union (not a bare string) so a future second reason doesn't
 * silently reuse this one's meaning. */
export type QuotesUnconfiguredReason = "schema";

export type QuotesLoad = {
  status: QuotesLoadStatus;
  /** Empty for every status except `ok` — never mistake it for "no quotes". */
  quotes: QuoteRow[];
  reason?: QuotesUnconfiguredReason;
  error?: unknown;
};

export type QuoteDetailLoad = {
  status: QuotesLoadStatus;
  /** `null` under `ok` legitimately means "no such quote, or not visible to
   * this org" — a trustworthy answer, reached by actually querying the
   * table. Under `unconfigured`/`unavailable` it means nothing was learned. */
  quote: QuoteRow | null;
  lines: QuoteLineRow[];
  reason?: QuotesUnconfiguredReason;
  error?: unknown;
};

type PostgrestLikeError = { code?: string; message?: string } | null | undefined;

function isMissingTableError(error: PostgrestLikeError): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /schema cache|relation .* does not exist|does not exist/i.test(error.message ?? "");
}

/** Lists the active org's quotes, most recently updated first. `filter.status` matches the
 * STORED status column verbatim — expiry-awareness (a `sent` quote whose
 * `expires_at` has passed reading as `expired`) is a status.ts concern for
 * the caller to apply per-row via `effectiveQuoteStatus`, not a filter this
 * function evaluates against the database. */
export async function loadQuotes(filter: { status?: string } = {}): Promise<QuotesLoad> {
  try {
    const supabase = await getScopedClient();
    const db = quotesDb(supabase);
    let query = db.from("crm_quote").select("*");
    if (filter.status) query = query.eq("status", filter.status);
    const { data, error } = await query.order("updated_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        return { status: "unconfigured", reason: "schema", quotes: [], error };
      }
      console.error("[quotes] quote list unreachable:", error);
      return { status: "unavailable", quotes: [], error };
    }
    return { status: "ok", quotes: (data as QuoteRow[] | null) ?? [] };
  } catch (error) {
    console.error("[quotes] quote list unreachable:", error);
    return { status: "unavailable", quotes: [], error };
  }
}

/** A single quote plus its lines, bundled for the quote builder page. */
export async function loadQuote(id: string): Promise<QuoteDetailLoad> {
  try {
    const supabase = await getScopedClient();
    const db = quotesDb(supabase);

    const { data: quoteData, error: quoteError } = await db.from("crm_quote").select("*").eq("id", id).maybeSingle();
    if (quoteError) {
      if (isMissingTableError(quoteError)) {
        return { status: "unconfigured", reason: "schema", quote: null, lines: [], error: quoteError };
      }
      console.error("[quotes] quote detail unreachable:", quoteError);
      return { status: "unavailable", quote: null, lines: [], error: quoteError };
    }
    if (!quoteData) return { status: "ok", quote: null, lines: [] };
    const quote = quoteData as QuoteRow;

    const { data: linesData, error: lineError } = await db
      .from("crm_quote_line")
      .select("*")
      .eq("quote_id", id)
      .order("sort_index", { ascending: true });
    if (lineError) {
      if (isMissingTableError(lineError)) {
        return { status: "unconfigured", reason: "schema", quote, lines: [], error: lineError };
      }
      console.error("[quotes] quote line list unreachable:", lineError);
      return { status: "unavailable", quote, lines: [], error: lineError };
    }

    return { status: "ok", quote, lines: (linesData as QuoteLineRow[] | null) ?? [] };
  } catch (error) {
    console.error("[quotes] quote detail unreachable:", error);
    return { status: "unavailable", quote: null, lines: [], error };
  }
}

/**
 * Every line of the listed quotes, in ONE read, for the list page's totals
 * column. New in lectual.app (the source list shows no totals, to avoid an N+1
 * read; this is a single `.in()` over the page's own ids, so it is not one).
 *
 * Best-effort and deliberately NOT three-state: it returns null on any failure,
 * and the list renders "—" for every total rather than a $0.00 that would read
 * as a real figure. The quotes themselves still come from `loadQuotes`.
 */
export async function loadLinesForQuotes(quoteIds: readonly string[]): Promise<Map<string, QuoteLineRow[]> | null> {
  if (quoteIds.length === 0) return new Map();
  try {
    const supabase = await getScopedClient();
    const db = quotesDb(supabase);
    const { data, error } = await db
      .from("crm_quote_line")
      .select("*")
      .in("quote_id", quoteIds)
      .order("sort_index", { ascending: true });
    if (error) {
      console.error("[quotes] quote list totals unreachable:", error);
      return null;
    }
    const byQuote = new Map<string, QuoteLineRow[]>();
    for (const line of (data as QuoteLineRow[] | null) ?? []) {
      const list = byQuote.get(line.quote_id) ?? [];
      list.push(line);
      byQuote.set(line.quote_id, list);
    }
    return byQuote;
  } catch (error) {
    console.error("[quotes] quote list totals unreachable:", error);
    return null;
  }
}

/** True only when the table was actually reached and genuinely holds no
 * quotes — mirrors `isGenuinelyEmpty` (src/lib/queue/load.ts). */
export function isGenuinelyEmptyQuotes(load: QuotesLoad): boolean {
  return load.status === "ok" && load.quotes.length === 0;
}

export type { QuoteEventRow };
