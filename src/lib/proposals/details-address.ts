import "server-only";

import { cleanSigningDetails, missingDetails } from "@/lib/loe/signing";
import { addressAccess, readEarlierSteps, recordStep, type FollowupDb, type FollowupDeps } from "./accept-followups";
import { lastAddressWrite, newestAddressEvent } from "./address-events";
import { addressFromDetails, writeAddressToLawmatics } from "./address-to-lawmatics";
import { stepPayload } from "./paid";

/**
 * The "Your details" trigger of the address step (`address_to_lawmatics`): the client finished step 2 on `/p/<token>` and pressed
 * Continue, so their mailing address goes to the firm's Lawmatics matter (and its contact) BEFORE they sign, and is already there when
 * they reach the Lawmatics pay form. NOT verified against a live Lawmatics.
 *
 * Runs after the response (`savePublicDetailsAddress` in `public.ts` resolves the token, checks the proposal and the rate limit, and
 * schedules this with `after()`), as the service role, fenced on the proposal row's OWN org. Never throws, and the page is told
 * nothing either way. The details are cleaned with the signing normaliser and must meet the signing rule (`missingDetails`).
 *
 * Only a live (`sent`) version is written. The write goes through the ONE core (`writeAddressToLawmatics`), which dedupes against the
 * last write of this round: the same address makes no request and records nothing; a changed one updates the earlier records. A
 * refusal (not connected, no matter, a failed request) is recorded once, not again for every Continue with the same outcome. The
 * address itself is never stored in Lectual: only the ids and hash the core puts in the step event.
 */

const PROPOSAL_COLUMNS = "id, org_id, family_id, status, client_email, lead_id, matter_id";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function runDetailsAddress(db: FollowupDb, input: { proposalId: string; orgId: string }, rawDetails: unknown, deps: FollowupDeps = {}): Promise<void> {
  try {
    const details = cleanSigningDetails(rawDetails);
    if (missingDetails(details).length > 0) return;
    const { data, error } = await db.from("client_proposal").select(PROPOSAL_COLUMNS).eq("id", input.proposalId).eq("org_id", input.orgId).maybeSingle();
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return;
    const row = data as Record<string, unknown>;
    if (row.status !== "sent") return;
    const ref = { id: input.proposalId, orgId: input.orgId, familyId: text(row.family_id) ?? input.proposalId };
    // Without the history there is no dedupe, and a second address in the firm's CRM is worse than none: the signed run will write it.
    const earlier = await readEarlierSteps(db, ref);
    if (earlier === null) return;

    const result = await writeAddressToLawmatics(addressFromDetails(details), "details", {
      ...addressAccess(db, { orgId: input.orgId, matterId: text(row.matter_id), leadId: text(row.lead_id), clientEmail: text(row.client_email) }, deps),
      proposalId: input.proposalId,
      previous: lastAddressWrite(earlier, input.proposalId),
    });
    if (result.extra?.action === "unchanged") return;
    if (result.outcome !== "added") {
      const last = newestAddressEvent(earlier, input.proposalId);
      const reason = stepPayload("address_to_lawmatics", result.outcome, result.reason).reason ?? null;
      if (last && last.trigger === "details" && last.outcome === result.outcome && last.reason === reason) return;
    }
    await recordStep(db, ref, stepPayload("address_to_lawmatics", result.outcome, result.reason, result.extra ?? { trigger: "details" }));
  } catch {
    console.error("[proposals] the details address step stopped early");
  }
}
