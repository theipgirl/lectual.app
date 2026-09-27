"use server";

import { revalidatePath } from "next/cache";
import { callerHasRole } from "@/lib/auth/current-role";
import {
  addLineTo,
  applyServiceItemTo,
  deletePackage,
  deleteQuoteLine,
  duplicatePackage,
  renamePackage,
  sendQuote,
  setAddOnOffered,
  setPackageOffered,
  updateQuoteDetails,
  updateQuoteLine,
  withdrawQuote,
  quotesDb,
  requireQuoteWriteRole,
  type LinePlacement,
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
 * existing quote (header, lines, packages and add-ons, service-library
 * application, lifecycle, engagement terms). Ported from `lectual` without the
 * payment and client line-request actions (see PORTED_FROM.md);
 * `updateDetailsAction` and the package/add-on actions are new, for the
 * builder in design/Quote_Builder_Prototype.dc.html (packages.ts has the
 * mapping). Quote CREATION lives one level up, in `../actions.ts`.
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

/**
 * Where a new line goes, read from the form: `placement` is "package" (with
 * `packageName`), "add_on" or "common" (in every package). The store turns it
 * into selection fields and — for an existing package — copies that package's
 * offer switch, so no posted value decides whether a line is offered.
 */
function readPlacement(formData: FormData): LinePlacement | null {
  const kind = String(formData.get("placement") ?? "");
  if (kind === "common") return { kind: "common" };
  if (kind === "add_on") return { kind: "add_on" };
  if (kind === "package") return { kind: "package", name: String(formData.get("packageName") ?? "") };
  return null;
}

/** The user types a POSITIVE figure — "a $500 discount", not "-500"; the sign
 * comes from the kind. `assertLineAmountSign` in the store is what enforces the
 * stored sign against the line's real kind. */
function signedCents(kind: string, raw: string): number | null {
  const magnitude = parseDollarsToCents(raw);
  if (magnitude === null || magnitude < 0) return null;
  return kind === "discount" ? -magnitude : magnitude;
}

/** A one-off line a library item doesn't cover, placed in a package, in every
 * package, or as an add-on. */
export async function addLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const kind = String(formData.get("kind") ?? "legal_fee");
  const label = String(formData.get("label") ?? "").trim();
  const placement = readPlacement(formData);
  if (!quoteId) return { error: "Missing quote." };
  if (!placement) return { error: "Choose where this line goes." };
  if (!label) return { error: "Enter a label for this line." };

  // The schedule follows the kind: a government fee is charged at filing (and
  // the store refuses anything else at signing); everything else starts at
  // signing and can be moved with the Charged pill.
  const chargeAt = kind === "government_fee" ? "filing" : String(formData.get("chargeAt") ?? "signing");
  const unitAmountCents = signedCents(kind, String(formData.get("amount") ?? ""));
  if (unitAmountCents === null) return { error: "Enter a valid amount, e.g. 1250.00." };

  try {
    await addLineTo(quoteId, { kind, chargeAt, label, unitAmountCents }, placement);
  } catch (err) {
    return errorState(err, "Couldn't add this line.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

/** Inline edit of a line's label and/or amount — the builder's table. Only the
 * fields posted are changed. */
export async function editLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  if (!quoteId || !lineId) return { error: "Missing line." };

  const patch: { label?: string; unitAmountCents?: number } = {};
  if (formData.has("label")) {
    const label = String(formData.get("label") ?? "").trim();
    if (!label || label.length > 300) return { error: "A line needs a label of 1-300 characters." };
    patch.label = label;
  }
  if (formData.has("amount")) {
    const cents = signedCents(String(formData.get("kind") ?? ""), String(formData.get("amount") ?? ""));
    if (cents === null) return { error: "Enter a valid amount, e.g. 1250.00." };
    patch.unitAmountCents = cents;
  }
  if (patch.label === undefined && patch.unitAmountCents === undefined) return {};

  try {
    await updateQuoteLine(lineId, patch);
  } catch (err) {
    return errorState(err, "Couldn't update this line.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

/**
 * The Charged pill: move a line between signing and filing. A government fee
 * cannot be moved to signing — the builder explains that without calling this,
 * and if something calls it anyway the store's `assertLineKindChargeAt` (and
 * then 0068's CHECK) refuses.
 */
export async function setChargeAtAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const chargeAt = String(formData.get("chargeAt") ?? "");
  if (!quoteId || !lineId) return { error: "Missing line." };
  if (chargeAt !== "signing" && chargeAt !== "filing") return { error: "Choose signing or filing." };

  try {
    await updateQuoteLine(lineId, { chargeAt });
  } catch (err) {
    return errorState(err, "Couldn't move this charge.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
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

/** Click a service-library item: COPY it onto the quote, in the package being
 * edited (or every package, or as an add-on). */
export async function applyServiceItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const serviceItemId = String(formData.get("serviceItemId") ?? "");
  const placement = readPlacement(formData);
  if (!quoteId || !serviceItemId) return { error: "Choose a service to add." };
  if (!placement) return { error: "Choose where this service goes." };

  try {
    await applyServiceItemTo(quoteId, serviceItemId, placement);
  } catch (err) {
    return errorState(err, "Couldn't add this service.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

// ── Packages and add-ons ─────────────────────────────────────────────────

/** Offer or withhold a whole package. The store refuses to withhold the last
 * offered one. */
export async function setPackageOfferedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const packageName = String(formData.get("packageName") ?? "");
  const offered = formData.get("offered") === "true";
  if (!quoteId || !packageName) return { error: "Missing package." };

  try {
    await setPackageOffered(quoteId, packageName, offered);
  } catch (err) {
    return errorState(err, "Couldn't change this package.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

/** Offer or withhold one add-on. */
export async function setAddOnOfferedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const offered = formData.get("offered") === "true";
  if (!quoteId || !lineId) return { error: "Missing add-on." };

  try {
    await setAddOnOffered(lineId, offered);
  } catch (err) {
    return errorState(err, "Couldn't change this add-on.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

export async function renamePackageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const from = String(formData.get("packageName") ?? "");
  const to = String(formData.get("newName") ?? "");
  if (!quoteId || !from) return { error: "Missing package." };

  try {
    await renamePackage(quoteId, from, to);
  } catch (err) {
    return errorState(err, "Couldn't rename this package.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

export async function duplicatePackageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const from = String(formData.get("packageName") ?? "");
  const to = String(formData.get("newName") ?? "");
  if (!quoteId || !from) return { error: "Missing package." };

  try {
    await duplicatePackage(quoteId, from, to);
  } catch (err) {
    return errorState(err, "Couldn't copy this package.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
}

export async function deletePackageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await callerHasRole("attorney"))) return NOT_ENTITLED;

  const quoteId = String(formData.get("quoteId") ?? "");
  const packageName = String(formData.get("packageName") ?? "");
  if (!quoteId || !packageName) return { error: "Missing package." };

  try {
    await deletePackage(quoteId, packageName);
  } catch (err) {
    return errorState(err, "Couldn't remove this package.");
  }

  revalidateQuote(quoteId);
  return { saved: true };
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
  return { saved: true };
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
  return { saved: true };
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
