import type { Metadata } from "next";
import { SigningWordsSettings, type SigningWordsModel } from "@/components/loe/SigningWordsSettings";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { signingWordsStatus, type WordsStatus } from "@/lib/loe/email-signing/settings-status";
import { listWordsVersions } from "@/lib/loe/signing-words-store";
import { listMemberDirectory } from "@/lib/members/directory";
import { firstNameOf } from "@/lib/proposal-editor/labels";
import { getProposalSettings } from "@/lib/proposals/store";
import { PROPOSAL_ADMIN_ROLES, PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { pageTitle } from "@/lib/ui/page-title";
import { SIGNING_WORDS_NAME, TEAMMATE } from "@/lib/ui/words";
import { requireProposalsModule } from "../../../proposals/gate";
import "../../../proposals/proposals.css";

export const metadata: Metadata = { title: pageTitle(SIGNING_WORDS_NAME) };

export const dynamic = "force-dynamic";

/**
 * Settings -> Client proposals -> Signing words (lectual 0117). Every member of a firm with the proposals feature reads the
 * versions; the admin tier writes a draft and a named approver approves it. The status line says plainly whether the emailed
 * signing link is on for the firm and why not, read through the SCOPED client only (`signingWordsStatus`: no probe, no admin
 * client). A firm without proposals gets `notFound()`.
 */
export default async function SigningWordsPage() {
  await requireProposalsModule();
  const db = await getScopedClient();
  const [read, role, session] = await Promise.all([listWordsVersions(db), currentRole(), resolveFirmSession()]);
  const emailStatus: WordsStatus = session.kind === "ok" ? await signingWordsStatus(session.org.id, db) : "unreadable";

  let model: SigningWordsModel;
  if (read.status !== "ok") {
    model = { status: read.status };
  } else {
    const canEdit = !!role && PROPOSAL_ADMIN_ROLES.includes(role);
    const canWrite = !!role && PROPOSAL_STAFF_WRITE_ROLES.includes(role);
    let approvers: Extract<SigningWordsModel, { status: "ok" }>["approvers"] = { status: "unreadable" };
    let isApprover = false;
    try {
      const [settings, members, auth] = await Promise.all([getProposalSettings(), listMemberDirectory(), db.auth.getUser()]);
      const userId = auth.data.user?.id ?? null;
      const ids = settings?.approver_user_ids ?? [];
      approvers = {
        status: "ok",
        names: ids.map((id) => {
          const m = members.find((x) => x.userId === id);
          return m ? (m.displayName ?? firstNameOf(m.email) ?? m.email ?? TEAMMATE) : TEAMMATE;
        }),
      };
      isApprover = !!userId && ids.includes(userId);
    } catch {
      approvers = { status: "unreadable" };
    }
    model = { status: "ok", canEdit, canApprove: canWrite && approvers.status === "ok" && isApprover, approvers, versions: read.versions };
  }
  return <SigningWordsSettings model={model} emailStatus={emailStatus} />;
}
