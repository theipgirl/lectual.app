import "server-only";

// Type-only: the client is built (and fenced) in public.ts; this module only
// ever receives it. No second service-role constructor exists in the quote
// engine.
import type { PublicQuotesDb } from "./public";
import { firmCivilDate } from "./firm-time";

/**
 * "Matter opens automatically" — the design's promise on acceptance, kept only
 * where it can be kept safely.
 *
 * Called by `acceptPublicQuote`, and only by the request that WON the
 * conditional acceptance update, with the service-role client that route
 * already holds. There is no session here: the caller is the firm's client,
 * signing through a link. So every read and write below is fenced by the
 * `quoteId` / `orgId` read off the token's own row, never by anything the
 * caller sent, and every row written carries that `orgId`:
 *
 *  - the quote is re-read by (id, org_id), and nothing happens unless it is
 *    `accepted`, has a lead, and has no matter yet;
 *  - the lead, its PA tag and the docket stage are read with `org_id = orgId`;
 *    the matter's `lead_id` is the quote's own, which 0068's composite FK
 *    already ties to the same org; the stage FK is composite (0042);
 *  - the link is a CONDITIONAL update (`matter_id is null`), so two runs can
 *    never both link a matter. The loser deletes the matter it just created
 *    (the only delete on the public path, and only of its own row).
 *
 * IDEMPOTENT: a second run finds `matter_id` set and does nothing.
 *
 * NEVER FAILS THE ACCEPTANCE: the signature is already durable when this runs.
 * Every failure is logged and returned as `failed`; nothing here throws.
 *
 * What it creates mirrors `ensureMatterForLead` (src/lib/matters/matters.ts),
 * the pipeline's own lead→matter handoff: type from the lead's PA tag (TM by
 * default), title from the business or person's name, number
 * `${type}-${year}-${count + 1}` as `createMatter` generates it. It adds what
 * the quote knows — the package taken — and places the matter on the firm's
 * first open docket stage when the firm has one.
 */

export type MatterOpenResult =
  | { status: "opened"; matterId: string; matterNumber: string }
  | { status: "skipped"; reason: "not_accepted" | "has_matter" | "no_lead" }
  | { status: "failed" };

/** Same map `ensureMatterForLead` uses (PA-TM→TM, PA-PATENT→PATENT, PA-COPYRIGHT→CR). */
const PA_TO_MATTER_TYPE: Record<string, string> = {
  "PA-TM": "TM",
  "PA-PATENT": "PATENT",
  "PA-COPYRIGHT": "CR",
};

/** How many numbers to try when another writer takes ours between the read
 * and the insert — `(org_id, matter_number)` is unique, so a collision is a
 * refused insert (23505), never a duplicate. */
const NUMBER_ATTEMPTS = 3;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The next free `${type}-${year}-NNNN` for this org. `createMatter` uses the
 * org's matter count + 1; this does the same, then steps past any number
 * already taken (a firm whose older matters were numbered by hand can hold the
 * count's own number already).
 */
export function nextMatterNumber(type: string, year: string, existing: readonly string[], skip = 0): string {
  const taken = new Set(existing);
  let n = existing.length + 1 + skip;
  let candidate = `${type}-${year}-${String(n).padStart(4, "0")}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${type}-${year}-${String(n).padStart(4, "0")}`;
  }
  return candidate;
}

export async function openMatterForAcceptedQuote(
  db: PublicQuotesDb,
  ids: { quoteId: string; orgId: string },
  context: { packageName: string | null; now: Date; timeZone?: string },
): Promise<MatterOpenResult> {
  const { quoteId, orgId } = ids;
  try {
    const { data: quoteData, error: quoteError } = await db
      .from("crm_quote")
      .select("id, org_id, status, lead_id, matter_id, terms_body")
      .eq("id", quoteId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (quoteError || !quoteData) return fail("read the quote", quoteError);
    const quote = quoteData as Record<string, unknown>;
    if (quote.status !== "accepted") return { status: "skipped", reason: "not_accepted" };
    if (quote.matter_id) return { status: "skipped", reason: "has_matter" };
    const leadId = str(quote.lead_id);
    if (!leadId) return { status: "skipped", reason: "no_lead" };

    const { data: leadData, error: leadError } = await db
      .from("crm_lead")
      .select("id, first_name, last_name, business_name, mark_text, referral_source")
      .eq("id", leadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (leadError) return fail("read the lead", leadError);
    if (!leadData) return { status: "skipped", reason: "no_lead" };
    const lead = leadData as Record<string, unknown>;
    const title =
      str(lead.business_name) ?? ([str(lead.first_name), str(lead.last_name)].filter(Boolean).join(" ") || null);

    const type = await matterTypeFor(db, orgId, leadId);
    const stageId = await firstOpenStage(db, orgId);

    const { data: numberRows, error: numberError } = await db
      .from("crm_matter")
      .select("matter_number")
      .eq("org_id", orgId);
    if (numberError) return fail("read matter numbers", numberError);
    const existing = (Array.isArray(numberRows) ? numberRows : [])
      .map((row) => str((row as Record<string, unknown>).matter_number))
      .filter((n): n is string => n !== null);
    const year = firmCivilDate(context.now, context.timeZone).slice(0, 4);
    // The mark the client signed for (the engagement terms' scope line), else
    // the one the lead came in with; and where the lead came from, so the
    // matter's "Came from" is not blank for a client the firm's own form found.
    const markText = markFromTerms(str(quote.terms_body)) ?? str(lead.mark_text);
    const referralSource = str(lead.referral_source);
    const stamp = context.now.toISOString();

    let matter: { id: string; matterNumber: string } | null = null;
    for (let attempt = 0; attempt < NUMBER_ATTEMPTS && !matter; attempt += 1) {
      const matterNumber = nextMatterNumber(type, year, existing, attempt);
      const { data, error } = await db
        .from("crm_matter")
        .insert({
          org_id: orgId,
          type,
          lead_id: leadId,
          title,
          package_name: context.packageName,
          mark_text: markText,
          referral_source: referralSource,
          matter_number: matterNumber,
          status: "open",
          stage_id: stageId,
          stage_entered_at: stageId ? stamp : null,
        })
        .select("id, matter_number");
      if (error) {
        if (error.code === "23505") continue;
        return fail("create the matter", error);
      }
      const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
      const id = str(row?.id);
      if (!id) return fail("create the matter", null);
      matter = { id, matterNumber: str(row?.matter_number) ?? matterNumber };
    }
    if (!matter) return fail("find a free matter number", null);

    // THE LINK DECIDES. Only a quote with no matter yet takes this one; if
    // anything linked a matter first, this one is removed again rather than
    // left as a duplicate nobody asked for.
    const { data: linked, error: linkError } = await db
      .from("crm_quote")
      .update({ matter_id: matter.id, updated_at: stamp })
      .eq("id", quoteId)
      .eq("org_id", orgId)
      .is("matter_id", null)
      .select("id");
    if (linkError || !Array.isArray(linked) || linked.length === 0) {
      await db.from("crm_matter").delete().eq("id", matter.id).eq("org_id", orgId);
      return linkError ? fail("link the matter", linkError) : { status: "skipped", reason: "has_matter" };
    }

    // The two timelines. Both are shadows of rows that already exist, so a
    // failure is logged and the matter stands.
    const { error: eventError } = await db.from("crm_quote_event").insert({
      org_id: orgId,
      quote_id: quoteId,
      type: "revised",
      actor: "system",
      payload: { change: "matter_opened", matter_id: matter.id, matter_number: matter.matterNumber },
    });
    if (eventError) console.error(`[quotes] matter opened but its quote event failed quote=${quoteId}`, eventError);
    const { error: activityError } = await db.from("crm_activity").insert({
      org_id: orgId,
      lead_id: leadId,
      matter_id: matter.id,
      type: "matter_opened",
      actor_type: "system",
      payload: { matter_number: matter.matterNumber, auto: true, source: "quote_accepted", quote_id: quoteId },
    });
    if (activityError) console.error(`[quotes] matter opened but its activity row failed quote=${quoteId}`, activityError);

    return { status: "opened", matterId: matter.id, matterNumber: matter.matterNumber };
  } catch (err) {
    return fail("open the matter", err);
  }
}

/**
 * The mark named in engagement terms `buildEngagementTerms` wrote — its scope
 * line reads "…in connection with the mark <MARK>, performing the services…".
 * Only that exact sentence is read: terms a person rewrote by hand give null,
 * and the lead's own mark is used instead. Nothing here guesses at prose.
 */
export function markFromTerms(terms: string | null | undefined): string | null {
  if (!terms) return null;
  const m = /in connection with the mark (.+?), performing the services/.exec(terms);
  const mark = m?.[1]?.trim();
  return mark && mark.length <= 200 ? mark : null;
}

export type LeadAdvanceResult =
  | { status: "moved"; stageId: string; stageName: string }
  | { status: "skipped"; reason: "not_accepted" | "no_lead" | "no_won_stage" | "already_won" }
  | { status: "failed" };

/**
 * Signing is the client hiring the firm, so the quote's lead moves to the
 * firm's first "won" lead stage (crm_stage.category = 'won', lowest
 * order_index — "Hired Client" in the default pipeline), with a timeline row
 * that names the stage.
 *
 * Fenced exactly like `openMatterForAcceptedQuote`: the quote is re-read by
 * (id, org_id) and must be accepted; the lead and the stages are read with
 * `org_id = orgId`; the update is fenced on (id, org_id). It deliberately does
 * NOT go through `moveLeadStage`, whose won-stage handoff calls
 * `ensureMatterForLead` — the matter for this acceptance is already opened
 * above, and a second one is exactly what that would risk.
 *
 * A lead already in a won stage is left where it is (the firm may have moved
 * it by hand to a later won column). Never throws; never fails the acceptance.
 */
export async function advanceLeadForAcceptedQuote(
  db: PublicQuotesDb,
  ids: { quoteId: string; orgId: string },
  context: { now: Date },
): Promise<LeadAdvanceResult> {
  const { quoteId, orgId } = ids;
  try {
    const { data: quoteData, error: quoteError } = await db
      .from("crm_quote")
      .select("id, status, lead_id")
      .eq("id", quoteId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (quoteError || !quoteData) return failLead("read the quote", quoteError);
    const quote = quoteData as Record<string, unknown>;
    if (quote.status !== "accepted") return { status: "skipped", reason: "not_accepted" };
    const leadId = str(quote.lead_id);
    if (!leadId) return { status: "skipped", reason: "no_lead" };

    const { data: leadData, error: leadError } = await db
      .from("crm_lead")
      .select("id, current_stage_id")
      .eq("id", leadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (leadError) return failLead("read the lead", leadError);
    if (!leadData) return { status: "skipped", reason: "no_lead" };
    const fromStageId = str((leadData as Record<string, unknown>).current_stage_id);

    const { data: stageRows, error: stageError } = await db
      .from("crm_stage")
      .select("id, name, category, order_index")
      .eq("org_id", orgId)
      .order("order_index", { ascending: true });
    if (stageError) return failLead("read the lead stages", stageError);
    const stages = (Array.isArray(stageRows) ? stageRows : []) as Record<string, unknown>[];
    const from = fromStageId ? stages.find((st) => st.id === fromStageId) : undefined;
    if (from?.category === "won") return { status: "skipped", reason: "already_won" };
    const won = stages.find((st) => st.category === "won");
    const wonId = str(won?.id);
    if (!won || !wonId) return { status: "skipped", reason: "no_won_stage" };
    const wonName = str(won.name) ?? "Hired";

    const stamp = context.now.toISOString();
    const { data: moved, error: moveError } = await db
      .from("crm_lead")
      .update({ current_stage_id: wonId, stage_entered_at: stamp, last_activity_at: stamp })
      .eq("id", leadId)
      .eq("org_id", orgId)
      .select("id");
    if (moveError || !Array.isArray(moved) || moved.length === 0) return failLead("move the lead", moveError);

    // Same payload shape moveLeadStage writes, so the timeline reads it the
    // same way ("Moved to Hired Client").
    const { error: activityError } = await db.from("crm_activity").insert({
      org_id: orgId,
      lead_id: leadId,
      type: "stage_changed",
      actor_type: "system",
      payload: {
        from_stage: str(from?.name),
        to_stage: wonName,
        from_stage_id: fromStageId,
        to_stage_id: wonId,
        auto: true,
        source: "quote_accepted",
        quote_id: quoteId,
      },
    });
    if (activityError) console.error(`[quotes] lead moved but its activity row failed quote=${quoteId}`, activityError);

    return { status: "moved", stageId: wonId, stageName: wonName };
  } catch (err) {
    return failLead("advance the lead", err);
  }
}

function failLead(step: string, err: unknown): LeadAdvanceResult {
  console.error(`[quotes] lead advance on acceptance: could not ${step}`, err);
  return { status: "failed" };
}

async function matterTypeFor(db: PublicQuotesDb, orgId: string, leadId: string): Promise<string> {
  const { data: tagRows } = await db.from("crm_lead_tag").select("tag_id").eq("lead_id", leadId).eq("org_id", orgId);
  const tagIds = (Array.isArray(tagRows) ? tagRows : [])
    .map((row) => str((row as Record<string, unknown>).tag_id))
    .filter((id): id is string => id !== null);
  if (tagIds.length === 0) return "TM";
  const { data: paRows } = await db
    .from("crm_tag")
    .select("code")
    .eq("org_id", orgId)
    .eq("dimension", "PA")
    .in("id", tagIds);
  const code = str((Array.isArray(paRows) ? (paRows[0] as Record<string, unknown> | undefined) : undefined)?.code);
  return (code && PA_TO_MATTER_TYPE[code]) || "TM";
}

async function firstOpenStage(db: PublicQuotesDb, orgId: string): Promise<string | null> {
  const { data, error } = await db
    .from("crm_matter_stage")
    .select("id, order_index")
    .eq("org_id", orgId)
    .eq("is_open", true)
    .order("order_index", { ascending: true })
    .limit(1);
  if (error || !Array.isArray(data)) return null;
  return str((data[0] as Record<string, unknown> | undefined)?.id);
}

function fail(step: string, err: unknown): MatterOpenResult {
  console.error(`[quotes] matter auto-open: could not ${step}`, err);
  return { status: "failed" };
}
