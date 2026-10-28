import "server-only";
import { listMemberDirectory } from "@/lib/members/directory";
import { getProposalSettings, saveProposalSettings } from "@/lib/proposals/store";
import { parseApprovalRouting, withApprovalRouting, type ApprovalRouting, type RoutingMember } from "@/lib/queue/routing";

export type RoutingLoad =
  | { status: "ok"; routing: ApprovalRouting; members: RoutingMember[]; dropped: number; settingsExist: boolean }
  | { status: "failed" };

/**
 * The firm's approval routing and member list. Never throws: a failed read is `failed`, and every caller then
 * applies the default rule (the usual approvers) to every item, which never widens who may approve anything.
 */
export async function loadApprovalRouting(): Promise<RoutingLoad> {
  try {
    const [settings, directory] = await Promise.all([getProposalSettings(), listMemberDirectory()]);
    const members: RoutingMember[] = directory.map((m) => ({ userId: m.userId, role: m.role, displayName: m.displayName, email: m.email }));
    const { routing, dropped } = parseApprovalRouting((settings?.pricing ?? {}).approval_routing, members);
    return { status: "ok", routing, members, dropped, settingsExist: settings !== null };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Saves the routing and nothing else: the row is re-read and its approvers, pay link, notify address and every other
 * pricing key are written back as they were. A missing row is created with no approvers. Throws when the read fails
 * (never writes over settings it could not see).
 */
export async function saveApprovalRouting(routing: ApprovalRouting): Promise<void> {
  const existing = await getProposalSettings();
  await saveProposalSettings({
    approverUserIds: existing?.approver_user_ids ?? [],
    defaultPayUrl: existing?.default_pay_url ?? null,
    notifyEmail: existing?.notify_email ?? null,
    pricing: withApprovalRouting(existing?.pricing ?? {}, routing),
  });
}
