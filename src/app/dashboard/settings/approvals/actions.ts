"use server";

import { revalidatePath } from "next/cache";
import { currentRole } from "@/lib/auth/current-role";
import { listMemberDirectory } from "@/lib/members/directory";
import { orgHasModule } from "@/lib/org/modules";
import { canSeeSetup, ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { notReadyYet } from "@/lib/ui/words";
import { QUEUE_KINDS, routingChoiceError, type ApprovalRouting, type RoutingMember } from "@/lib/queue/routing";
import { saveApprovalRouting } from "@/lib/queue/routing-load";
import type { ActionState } from "../../proposals/errors";

/** Form field name for a kind's owner. */
const ROUTING_FIELD_PREFIX = "kind.";

/**
 * Save who each kind of approval is for. Its own POST entry point: the role is re-read here, the member list is
 * re-read here, and a person or kind the browser invented is refused. "Usual approvers" (empty) removes the entry.
 * Storage is the proposals settings row, so a firm without that feature has nowhere to save (fail closed).
 */
export async function saveApprovalRoutingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!canSeeSetup(await currentRole())) return { error: `${ADMIN_TIER_PHRASE} can change who approvals go to.` };
  if (!(await orgHasModule("proposals"))) return { error: notReadyYet("Approval assignments") };

  const known = new Set<string>(QUEUE_KINDS);
  const picks: [string, string][] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(ROUTING_FIELD_PREFIX)) continue;
    if (typeof value !== "string") return { error: "That didn't go through. Refresh the page and try again." };
    const kind = key.slice(ROUTING_FIELD_PREFIX.length);
    if (!known.has(kind)) return { error: "That kind of approval isn't one of the options. Refresh the page." };
    picks.push([kind, value.trim()]);
  }

  let members: RoutingMember[];
  try {
    members = (await listMemberDirectory()).map((m) => ({ userId: m.userId, role: m.role, displayName: m.displayName, email: m.email }));
  } catch {
    return { error: "We couldn't load your team, so nothing was saved. Refresh to try again." };
  }

  const routing: ApprovalRouting = {};
  for (const [kind, memberId] of picks) {
    if (!memberId) continue;
    const problem = routingChoiceError(kind, memberId, members);
    if (problem) return { error: problem };
    routing[kind as keyof ApprovalRouting] = memberId;
  }

  try {
    await saveApprovalRouting(routing);
  } catch {
    return { error: "Couldn't save the assignments. Nothing was changed. Refresh to try again." };
  }
  revalidatePath("/dashboard/settings/approvals/");
  revalidatePath("/dashboard/queue/");
  return { saved: true };
}
