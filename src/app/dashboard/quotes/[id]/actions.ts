"use server";

import { revalidatePath } from "next/cache";
import { callerHasRole } from "@/lib/auth/current-role";
import {
  addQuoteLine,
  applyServiceItem,
  deleteQuoteLine,
  reorderQuoteLines,
  sendQuote,
  updateQuoteDetails,
  updateQuoteLine,
  withdrawQuote,
  listQuoteLines,
  quotesDb,
  requireQuoteWriteRole,
} from "@/lib/quotes/store";
import { getScopedClient } from "@/lib/db/scoped-client";
import { effectiveQuoteStatus, isQuoteEditable } from "@/lib/quotes/status";
import { buildEngagementTerms } from "@/lib/quotes/engagement-terms";
import type { QuoteLineRow, QuoteRow } from "@/lib/quotes/types";
import { parseDollarsToCents } from "@/lib/quotes/money";
import { endOfFirmDay } from "@/lib/quotes/firm-time";
import { friendlyQuoteError, NOT_ENTITLED, type ActionState } from "../errors";

/**
 * The quote BUILDER's own write surface — everything that mutates ONE
 * existing quote (header, lines, service-library application, lifecycle,
 * engagement terms). Ported from `lectual` without the payment and client
 * line-request actions (see PORTED_FROM.md); `updateDetailsAction` is new.
 * Quote CREATION lives one level up, in `../actions.ts`.
 *
 * Every function here is its own POST entry point (AGENTS.md: a "use server"
 * function never renders a layout), and every one of them calls straight into
 * `src/lib/quotes/store.ts`, which re-checks the caller's role via
 * `requireQuoteWriteRole` on EVERY call — nothing here caches or shortcuts
 * that. This file's own job is only: read the form, turn a user-typed dollar
 * string into cents (see money.ts — string arithmetic, never a float
 * multiply), and turn a thrown Error into a readable `ActionState`.
 *
 * `revalidatePath` targets the quote's own path, and the list too whenever
 * the change is something the list shows (status, title, and — since this
 * app's list carries totals — every line edit).
 *
 * ── EVERY ONE OF THESE RE-CHECKS attorney+, INDIVIDUALLY ────────────────
 * Quoting became configuration rather than casework (see ../page.tsx's header
 * for the firm's reasoning and for why the refusal explains itself). Each
 * function below is its own POST endpoint that never renders this route's
 * page, so the page's card stops nobody here: miss ONE of these and the whole
 * gate is decorative, because that one is the endpoint an unentitled caller
 * uses. Hence the check is the first statement of EVERY function in this file,
 * not a shared wrapper someone can forget to apply to the next one added.
 *
 * `requireQuoteWriteRole` inside store.ts is a different, WIDER check —
 * QUOTE_STAFF_WRITE_ROLES mirrors 0068's RLS and still admits intake,
 * paralegals, law clerks, clerks and the attorney, all of whom this gate now
 * refuses. RLS is deliberately left alone: the database boundary is tenancy,
 * this is a product decision about who inside one firm quotes. Do not
 * "reconcile" the two lists.
 */

function quotePath(quoteId: string): string {
  return `/dashboard/quotes/${quoteId}/`;
}

function errorState(err: unknown, fallback: string): ActionState {
  return { error: friendlyQuoteError(err, fallback) };
}

/** The quote's page, and the list (which shows its status and totals). */
function revalidateQuote(quoteId: string): void {
  revalidatePath(quotePath(quoteId));
  revalidatePath("/dashboard/quotes/");
}

// ── Header ───────────────────────────────────────────────────────────────

/** Title, intro and expiry. New in lectual.app — see `updateQuoteDetails`. */
export async function updateDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const introBody = String(formData.get("introBody") ?? "").trim() || null;
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  if (!quoteId) return { error: "Missing quote." };
  if (!title) return { error: "Enter a title for this quote." };

  let expiresAt: string | null = null;
  if (expiresRaw) {
    expiresAt = endOfFirmDay(expiresRaw);
    if (!expiresAt) return { error: "Enter a valid expiry date." };
  }

  try {
    await updateQuoteDetails(quoteId, { title, introBody, expiresAt });
  } catch (err) {
    return errorState(err, "Couldn't save these details.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

// ── Lines ────────────────────────────────────────────────────────────────

export async function addLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const chargeAt = String(formData.get("chargeAt") ?? "");
  const selection = String(formData.get("selection") ?? "included");
  const tierGroup = String(formData.get("tierGroup") ?? "").trim() || null;
  const label = String(formData.get("label") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const quantityRaw = String(formData.get("quantity") ?? "1").trim();
  const amountRaw = String(formData.get("amount") ?? "");

  if (!quoteId) return { error: "Missing quote." };
  if (!label) return { error: "Enter a label for this line." };

  const quantity = Number(quantityRaw);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a whole number greater than zero." };
  }

  // The client always types a POSITIVE dollar figure — "a $500 discount", not
  // "-500" — and this is the one place that sign gets applied, based on the
  // kind the firm actually chose. assertLineAmountSign (called inside
  // addQuoteLine) is what actually enforces the stored sign; this is only
  // about not asking a front-desk user to type a minus sign.
  const magnitude = parseDollarsToCents(amountRaw);
  if (magnitude === null || magnitude < 0) {
    return { error: "Enter a valid amount, e.g. 1250.00." };
  }
  const unitAmountCents = kind === "discount" ? -magnitude : magnitude;

  try {
    await addQuoteLine(quoteId, {
      kind,
      chargeAt,
      selection,
      tierGroup,
      label,
      description,
      quantity,
      unitAmountCents,
    });
  } catch (err) {
    return errorState(err, "Couldn't add this line.");
  }

  revalidateQuote(quoteId);
  return {};
}

export async function updateLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const chargeAt = String(formData.get("chargeAt") ?? "");
  const selection = String(formData.get("selection") ?? "");
  const tierGroup = String(formData.get("tierGroup") ?? "").trim() || null;
  const label = String(formData.get("label") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const quantityRaw = String(formData.get("quantity") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "");
  // Present only for optional/tier_option lines' checkbox — an included line's
  // form doesn't render the checkbox at all, so an absent field here must NOT
  // be read as "unchecked and now deselected". Distinguished with a hidden
  // marker field rather than trusting FormData's own absence.
  const selectedFieldPresent = formData.get("selectedFieldPresent") === "1";
  const selected = formData.get("selected") === "on";

  if (!quoteId || !lineId) return { error: "Missing line." };
  if (!label) return { error: "Enter a label for this line." };

  const quantity = Number(quantityRaw);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a whole number greater than zero." };
  }

  const magnitude = parseDollarsToCents(amountRaw);
  if (magnitude === null || magnitude < 0) {
    return { error: "Enter a valid amount, e.g. 1250.00." };
  }
  const unitAmountCents = kind === "discount" ? -magnitude : magnitude;

  try {
    await updateQuoteLine(lineId, {
      kind,
      chargeAt,
      selection,
      tierGroup,
      label,
      description,
      quantity,
      unitAmountCents,
      ...(selectedFieldPresent ? { selected } : {}),
    });
  } catch (err) {
    return errorState(err, "Couldn't update this line.");
  }

  revalidateQuote(quoteId);
  return {};
}

export async function deleteLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  if (!quoteId || !lineId) return { error: "Missing line." };

  try {
    await deleteQuoteLine(lineId);
  } catch (err) {
    return errorState(err, "Couldn't remove this line.");
  }

  revalidateQuote(quoteId);
  return {};
}

/**
 * Moves one line up (`-1`) or down (`+1`) among ITS OWN kind of siblings —
 * really just among all of this quote's lines, reordered by the caller's
 * current on-screen order. `reorderQuoteLines` requires the COMPLETE set of
 * this quote's line ids (assertIdsMatchSet), so this re-reads the current
 * order fresh rather than trusting a possibly-stale list from the form.
 */
export async function moveLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Also gated even though a reorder "only" changes order_index: an
  // unentitled caller must not be able to read this quote's line ids back out
  // via listQuoteLines below, let alone rewrite their order.
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!quoteId || !lineId) return { error: "Missing line." };
  if (direction !== "up" && direction !== "down") return { error: "Invalid move." };

  try {
    const lines = await listQuoteLines(quoteId);
    const ids = lines.map((l) => l.id);
    const index = ids.indexOf(lineId);
    if (index === -1) return { error: "That line isn't on this quote." };
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= ids.length) {
      // Already at the edge — not an error, just nothing to do.
      return {};
    }
    [ids[index], ids[swapWith]] = [ids[swapWith], ids[index]];
    await reorderQuoteLines(quoteId, ids);
  } catch (err) {
    return errorState(err, "Couldn't reorder this line.");
  }

  revalidateQuote(quoteId);
  return {};
}

export async function applyServiceItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const serviceItemId = String(formData.get("serviceItemId") ?? "");
  if (!quoteId || !serviceItemId) return { error: "Choose a service to add." };

  try {
    await applyServiceItem(quoteId, serviceItemId);
  } catch (err) {
    return errorState(err, "Couldn't add this service.");
  }

  revalidateQuote(quoteId);
  return {};
}

// ── Lifecycle ────────────────────────────────────────────────────────────

export async function sendQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  if (!quoteId) return { error: "Missing quote." };

  try {
    await sendQuote(quoteId);
  } catch (err) {
    return errorState(err, "Couldn't send this quote.");
  }

  revalidateQuote(quoteId);
  return {};
}

export async function withdrawQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  if (!quoteId) return { error: "Missing quote." };

  try {
    await withdrawQuote(quoteId, note);
  } catch (err) {
    return errorState(err, "Couldn't withdraw this quote.");
  }

  revalidateQuote(quoteId);
  return {};
}

// ── Engagement terms ─────────────────────────────────────────────────────

/**
 * `crm_quote.terms_body` IS the engagement letter — 0068 calls it "the
 * fee-agreement language the client is agreeing to", `/q/[token]` renders it
 * inside the same article as the priced lines, and one typed signature covers
 * both. So the two functions below write a legal document, not a note field,
 * and they carry three guards the line editors already carry for money:
 *
 *  1. **attorney+, re-checked here.** Same reasoning as every other action in
 *     this file — a `"use server"` function is its own POST endpoint and the
 *     page's role card stops nobody who calls it directly.
 *  2. **Never after the quote leaves an editable state, AND THE DATABASE IS
 *     WHAT DECIDES.** `isQuoteEditable` is expiry-aware via
 *     `effectiveQuoteStatus`, so an accepted, declined, withdrawn or
 *     silently-expired quote refuses. But that read is a check-then-act: a
 *     client acceptance committing between the read and the write would have
 *     landed the new wording on the row while `accepted_snapshot` held the old,
 *     leaving a fee agreement with two versions and no way to tell which one
 *     was signed — and the firm's page then shows the NEW one beside the signed
 *     copy. So the status the read judged editable is carried into the UPDATE's
 *     own predicate and ZERO ROWS BACK IS THE LOSS SIGNAL, exactly as
 *     `acceptPublicQuote` and `submitWelcomeIntake` do it. The read stays: it
 *     is what produces the readable "this quote is accepted" refusal instead of
 *     a bare race message.
 *  3. **A `sent` quote may still be edited, and the client page is what makes
 *     that safe.** The firm genuinely does revise terms before a client signs.
 *     Any such edit changes `quoteAgreementFingerprint`, so a signature made
 *     from the copy the client already had open is REFUSED (`terms_changed`)
 *     rather than applied to wording they never read. The editor warns about
 *     this; the guarantee is on the accept path, not in the warning.
 *
 * The write goes through the caller's own scoped client (RLS), never a
 * service-role one — this is staff acting inside their own firm.
 */

/** Loads the quote for a terms write and refuses if it may not be edited.
 * Returns the row's own `org_id` so the audit event below never takes an org
 * from a caller, and its own `status` so the write can pin itself to the state
 * this decision was made about (see guard 2 above — this read alone settles
 * nothing). */
async function loadQuoteForTermsEdit(
  db: ReturnType<typeof quotesDb>,
  quoteId: string,
): Promise<Pick<QuoteRow, "id" | "org_id" | "status" | "expires_at">> {
  const { data, error } = await db
    .from("crm_quote")
    .select("id, org_id, status, expires_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Quote not found.");
  const quote = data as Pick<QuoteRow, "id" | "org_id" | "status" | "expires_at">;

  const effective = effectiveQuoteStatus(quote, new Date());
  if (!isQuoteEditable(effective)) {
    throw new Error(`This quote is ${effective} — its engagement terms can no longer be changed.`);
  }
  return quote;
}

/**
 * Persists `terms_body` and records a `revised` event.
 *
 * The UPDATE is conditional on the status the load just read, and zero rows
 * back THROWS — see guard 2 in this section's header. A caller that returns
 * without throwing here has genuinely moved the row.
 *
 * The event write is SWALLOWED, mirroring `writeQuoteEventSafe` in store.ts:
 * the terms are already saved by the time it runs, and a broken audit table
 * must not report a successful edit as a failure and invite staff to make it
 * twice. It carries the length of the new text and never the text itself —
 * `crm_quote_event.payload` is rendered on the activity list, and a fee
 * agreement pasted into an audit row would be the same document stored twice
 * with only one of them frozen at signature.
 */
async function writeTermsBody(quoteId: string, termsBody: string | null): Promise<void> {
  const supabase = await getScopedClient();
  await requireQuoteWriteRole(supabase);
  const db = quotesDb(supabase);

  const quote = await loadQuoteForTermsEdit(db, quoteId);

  // Pinned to the STATUS the read above judged editable. Acceptance sets
  // `status = 'accepted'` in the same statement that writes `accepted_snapshot`
  // (`acceptPublicQuote`), so a signature landing in this window makes this
  // UPDATE match nothing — which is the point: wording a client has just signed
  // cannot be overwritten by an edit that was authorised a moment before they
  // signed it. The mirror-image write on the accept path pairs its own
  // `.eq("status","sent")` with `.is("accepted_at", null)` because it is
  // guarding against a SECOND acceptance; here any departure from the status we
  // read is already a loss, so the one predicate carries it (and `QuotesDbQuery`
  // exposes no `is`). `.select("id")` is what makes PostgREST report the rows it
  // actually changed.
  const { data, error } = await db
    .from("crm_quote")
    .update({ terms_body: termsBody, updated_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("status", quote.status)
    .select("id");
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) {
    // Zero rows changed: the quote left that status between the read and this
    // statement — a client accepted, or another staff member sent or withdrew
    // it. NOTHING was written, so this must not report a save, and the
    // `revised` event below must not be recorded either: an audit row saying
    // the terms were revised, over a row whose terms did not move, is a worse
    // record than none.
    throw new Error(
      "This quote changed while you were editing it — the terms were NOT saved. Reload the quote to see its current state.",
    );
  }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await db.from("crm_quote_event").insert({
      org_id: quote.org_id,
      quote_id: quoteId,
      type: "revised",
      actor: "firm",
      actor_user_id: user?.id ?? null,
      payload: { field: "terms_body", length: termsBody?.length ?? 0 },
    });
  } catch (err) {
    console.error(`[quotes] failed to record 'revised' event for quote=${quoteId}:`, err);
  }
}

/** Saves the engagement terms exactly as the attorney typed them. Empty means
 * NO terms — stored as null, and `/q/[token]` then presents a proposal with no
 * engagement letter rather than an empty "Engagement terms" heading. */
export async function saveTermsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  if (!quoteId) return { error: "Missing quote." };
  // No trim of the interior and no normalisation: this text is compared byte
  // for byte by the anti-tamper fingerprint, and "helpfully" rewriting
  // whitespace here would make a save that changed nothing visible refuse a
  // client's in-flight signature.
  const raw = String(formData.get("termsBody") ?? "");
  const termsBody = raw.trim() ? raw : null;

  try {
    await writeTermsBody(quoteId, termsBody);
  } catch (err) {
    return errorState(err, "Couldn't save these engagement terms.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

/**
 * Generates the engagement letter from THIS quote's own lines and saves it as
 * a starting draft the attorney then edits.
 *
 * ── EVERY FIGURE COMES FROM THE ROWS, AND NO MODEL IS INVOLVED ──────────────
 * The lines are re-read here rather than taken from the form. A generator fed
 * amounts by the browser would produce a fee agreement stating whatever was
 * posted to it — at an endpoint that writes the document a client signs. The
 * party names and the mark ARE staff-entered, because they are not derivable:
 * `documents/loe.ts` makes the same call for the template variant ("never
 * guessed" is that SOP's hard rule), and the party to an agreement is not a
 * field to infer from a lead record.
 *
 * `buildEngagementTerms` is pure and AI-free. Nothing on this path asks a model
 * to write a fee term.
 */
export async function generateTermsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const clientName = String(formData.get("clientName") ?? "").trim();
  const entityName = String(formData.get("entityName") ?? "").trim() || null;
  const markText = String(formData.get("markText") ?? "").trim() || null;
  if (!quoteId) return { error: "Missing quote." };
  if (!clientName) return { error: "Enter the client's name as it should appear in the agreement." };

  try {
    const supabase = await getScopedClient();
    await requireQuoteWriteRole(supabase);
    const db = quotesDb(supabase);

    const quote = await loadQuoteForTermsEdit(db, quoteId);

    const { data: quoteData, error: quoteError } = await db
      .from("crm_quote")
      .select("currency, expires_at")
      .eq("id", quoteId)
      .maybeSingle();
    if (quoteError) throw quoteError;
    const meta = (quoteData ?? {}) as Pick<QuoteRow, "currency" | "expires_at">;

    const { data: lineData, error: lineError } = await db
      .from("crm_quote_line")
      .select("*")
      .eq("quote_id", quoteId)
      .order("sort_index", { ascending: true });
    if (lineError) throw lineError;
    const lines = (lineData as QuoteLineRow[] | null) ?? [];
    if (lines.length === 0) {
      // Refused rather than generated: an engagement letter whose fee section
      // reads "$0.00" is worse than no letter, because it looks finished.
      return { error: "Add the quote's lines first — the terms are generated from them." };
    }

    const termsBody = buildEngagementTerms({
      firmName: await firmNameFor(supabase, quote.org_id),
      clientName,
      entityName,
      markText,
      lines,
      currency: meta.currency,
      expiresAt: meta.expires_at,
    });

    await writeTermsBody(quoteId, termsBody);
  } catch (err) {
    return errorState(err, "Couldn't generate engagement terms for this quote.");
  }

  revalidateQuote(quoteId);
  return {};
}

/**
 * The firm's own display name, for the "This agreement is between …" line.
 *
 * Read through the caller's scoped client, so it is by construction the firm
 * the caller is signed in to — the same name `/q/[token]` shows the client
 * above the proposal. A failure throws rather than falling back to a
 * placeholder: "your firm" printed into the parties clause of a fee agreement
 * is a party that does not exist.
 */
async function firmNameFor(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
  orgId: string,
): Promise<string> {
  const { data, error } = await supabase.from("crm_org").select("name").eq("id", orgId).maybeSingle();
  if (error) throw error;
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  if (!name) throw new Error("This firm has no name set, so the agreement's parties clause can't be written.");
  return name;
}
