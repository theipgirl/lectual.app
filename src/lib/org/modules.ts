import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * Per-firm feature modules (`crm_org.modules`, added by 0040 for litigation).
 *
 * ── WHY SURFACES NEED THIS ───────────────────────────────────────────────────
 * Postgres RLS isolates every tenant TABLE, and it does that job completely.
 * What it cannot isolate is a surface whose data lives OUTSIDE this database,
 * or a surface whose content is hardcoded to one firm's practice. Those have
 * no org_id to key on, so unless something gates them they render for every
 * firm — which is how one firm's dashboard came to show another firm's
 * privileged client mail.
 *
 * This is the same lesson as 0030 (`queue_org_key`): a surface backed by an
 * external service needs an explicit per-firm switch, and it must FAIL CLOSED.
 * An org with no modules gets nothing, rather than defaulting to whichever
 * firm the deployment happens to belong to.
 *
 * ── GATING IS NOT A UI CONCERN ───────────────────────────────────────────────
 * Hiding a nav entry is not access control — the route is still reachable by
 * typing it. Every gated PAGE must call requireModule() itself. The nav check
 * exists so people are not shown doors they cannot open, not to hold the line.
 */

/**
 * Modules a firm can hold. Names describe the CAPABILITY, not the firm — but
 * note that today each of these is implemented against RPB Law's practice and
 * identity, which is precisely why it must be opt-in per firm rather than on
 * by default:
 *
 *  - `litigation`      Consumer-debt litigation docket (0040). Cabanis Law.
 *  - `inbox`           Microsoft Graph mail triage. Requires that firm's own
 *                      M365 tenant wired into its lawmatics-mcp deployment;
 *                      the mailboxes are a property of the DEPLOYMENT, not of
 *                      any crm_org row, so only the firm that owns the
 *                      deployment may ever see them.
 *  - `agent-toolkit`   The Skills and Agents rosters. Static descriptions of
 *                      automations built for one firm, naming that firm's
 *                      attorney.
 *  - `document-center` LOE / opinion-letter / clearance generators, whose
 *                      templates and signature blocks name one firm's
 *                      attorney. A document signed by the wrong attorney is a
 *                      professional problem, not a cosmetic one.
 *  - `lawmatics-import` The Lawmatics importer. `LAWMATICS_TOKEN` is ONE
 *                      deployment-wide credential for ONE firm's Lawmatics
 *                      account — there is no per-org key, unlike
 *                      `crm_org.queue_org_key`. The importer reads through
 *                      that token but WRITES rows stamped with the CALLER's
 *                      org, so without this gate any firm's admin could pull
 *                      the token-owner's real clients and matters into their
 *                      own tenant. RLS cannot stop it: the records arrive over
 *                      HTTP, not from the database, and are written with a
 *                      legitimate org_id.
 *  - `mailbox`         Gmail / Outlook OAuth mailbox connections (lectual.app
 *                      step 3). Tokens are per-connection and RLS-scoped, but
 *                      the surface also needs the firm's OAuth consent, so it
 *                      is opt-in like everything else here.
 *  - `agents`          In-app scheduled agents (email intel, intake triage,
 *                      post-consult drafter) that draft into the queue.
 */
export type OrgModule =
  | "litigation"
  | "inbox"
  | "agent-toolkit"
  | "document-center"
  | "lawmatics-import"
  | "mailbox"
  | "agents";

/**
 * Modules on the caller's ACTIVE org. Read through the RLS-scoped client, so
 * it can only ever return the caller's own firm's list.
 *
 * Returns [] on any failure — a module list we could not read must never be
 * treated as "everything is enabled".
 */
export async function activeOrgModules(): Promise<string[]> {
  try {
    const supabase = await getScopedClient();
    const { data } = await supabase.from("crm_org").select("modules").maybeSingle();
    return data?.modules ?? [];
  } catch {
    return [];
  }
}

/** True when the caller's active org holds `mod`. Fails closed. */
export async function orgHasModule(mod: OrgModule): Promise<boolean> {
  return (await activeOrgModules()).includes(mod);
}
