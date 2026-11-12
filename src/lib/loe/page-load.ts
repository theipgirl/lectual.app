import "server-only";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listMemberDirectory } from "@/lib/members/directory";
import { firstNameOf } from "@/lib/proposal-editor/labels";
import { getProposalSettings } from "@/lib/proposals/store";
import { PROPOSAL_ADMIN_ROLES, PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import type { LetterPageModel } from "./page-model";
import { listLetterVersions } from "./templates-store";

/**
 * Everything the Engagement letter settings page draws, read through the caller's scoped client.
 * Each read is its own: a failed versions read is `unavailable` (never an empty page), a missing table
 * is `not-set-up`, and a failed read of who may approve hides Approve rather than guessing.
 */
export async function loadLetterPage(): Promise<LetterPageModel> {
  const db = await getScopedClient();
  const [read, role] = await Promise.all([listLetterVersions(db), currentRole()]);
  if (read.status === "not-set-up") return { status: "not-set-up" };
  if (read.status === "unavailable") return { status: "unavailable" };

  const canEdit = !!role && PROPOSAL_ADMIN_ROLES.includes(role);
  const canWrite = !!role && PROPOSAL_STAFF_WRITE_ROLES.includes(role);

  let approvers: Extract<LetterPageModel, { status: "ok" }>["approvers"] = { status: "unreadable" };
  let userId: string | null = null;
  let approverIds: string[] = [];
  try {
    const [settings, members, auth] = await Promise.all([getProposalSettings(), listMemberDirectory(), db.auth.getUser()]);
    userId = auth.data.user?.id ?? null;
    approverIds = settings?.approver_user_ids ?? [];
    const names = approverIds.map((id) => {
      const m = members.find((x) => x.userId === id);
      return m ? (m.displayName ?? firstNameOf(m.email) ?? m.email ?? "A teammate") : "A teammate";
    });
    approvers = { status: "ok", names };
  } catch {
    approvers = { status: "unreadable" };
  }

  return {
    status: "ok",
    canEdit,
    canApprove: canWrite && approvers.status === "ok" && !!userId && approverIds.includes(userId),
    approvers,
    versions: read.versions,
  };
}
