import "server-only";
import { listQueue } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { parseMonthlyUpdateMonth, type QueuedMonthsLookup } from "./filing-followup";

/**
 * Reads the approval queue for what monthly-status-update drafts already
 * exist, so the due-ness check (filing-followup.ts's computeFollowUpStatus)
 * never offers to draft a month that's already pending or approved.
 *
 * Same three-state discipline as src/lib/queue/load.ts, for the same reason
 * (AGENTS.md's "three states, never two"): an unreachable or unconfigured
 * queue must never be read as "nothing queued yet," because THAT reading is
 * exactly what would let this feature double-queue a client email. A queue
 * outage here degrades to "can't tell if this is due" rather than "everything
 * is due" or "nothing is due" — both of the wrong-but-confident answers.
 */
export type FollowUpQueueState =
  | { status: "ok"; queuedMonthsByMatter: QueuedMonthsLookup }
  | { status: "unconfigured"; reason: "org-key" | "env" }
  | { status: "unavailable" };

function isNotConfiguredError(err: unknown): boolean {
  return err instanceof Error && /not configured/i.test(err.message);
}

/**
 * Looks at both pending and approved CLIENT_EMAIL drafts — either means "this
 * month is handled," so a matter with an approved-but-not-yet-sent month 2
 * update is not offered a duplicate month 2. Rejected drafts are NOT counted:
 * a rejected update genuinely never went anywhere, so that month is still
 * open for a fresh draft.
 */
export async function loadFollowUpQueueState(): Promise<FollowUpQueueState> {
  try {
    const orgKey = await activeQueueOrgKey();
    if (!orgKey) return { status: "unconfigured", reason: "org-key" };

    const [pending, approved] = await Promise.all([
      listQueue(orgKey, "pending"),
      listQueue(orgKey, "approved"),
    ]);

    const queuedMonthsByMatter = new Map<string, number[]>();
    for (const item of [...pending, ...approved]) {
      if (item.type !== "CLIENT_EMAIL" || !item.matter_id) continue;
      const month = parseMonthlyUpdateMonth(item.headline);
      if (month === null) continue;
      const existing = queuedMonthsByMatter.get(item.matter_id);
      if (existing) existing.push(month);
      else queuedMonthsByMatter.set(item.matter_id, [month]);
    }
    return { status: "ok", queuedMonthsByMatter };
  } catch (error) {
    if (isNotConfiguredError(error)) return { status: "unconfigured", reason: "env" };
    console.error("[filing-followup] approval queue unreachable:", error);
    return { status: "unavailable" };
  }
}

/** The lookup to hand to buildFilingFollowUpRows/computeFollowUpStatus —
 * `null` for anything other than `ok`, which is what makes every status
 * fall back to `queue_unknown` rather than `[]` ("known to be empty"). */
export function queuedMonthsLookupFor(state: FollowUpQueueState): QueuedMonthsLookup {
  return state.status === "ok" ? state.queuedMonthsByMatter : null;
}
