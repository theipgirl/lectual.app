"use server";

import { revalidatePath } from "next/cache";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import { isCurrentUserApprover } from "@/lib/proposals/store";
import {
  runApprove,
  runSaveDraft,
  runStartDraft,
  runStartFromVersion,
  type LetterActionState,
  type LetterDeps,
} from "@/lib/loe/letter-actions";
import { approveLetterDraft, createLetterDraft, currentOrgId, getLetterVersion, saveLetterDraft } from "@/lib/loe/templates-store";
import { requireProposalsModule } from "../../../proposals/gate";

/**
 * Engagement letter actions. Each is its own POST entry point: the feature gate (notFound when
 * proposals are off) and the caller's role run first, inside `run*`, and the database (RLS plus
 * lectual 0106's trigger) is the boundary underneath. Scoped client only.
 */

const PATH = "/dashboard/settings/proposals/engagement-letter/";

async function deps(): Promise<LetterDeps> {
  const db = await getScopedClient();
  return {
    requireModule: requireProposalsModule,
    role: currentRole,
    isApprover: async () => {
      try {
        return await isCurrentUserApprover();
      } catch {
        return null;
      }
    },
    orgId: () => currentOrgId(db),
    readVersion: (id) => getLetterVersion(db, id),
    createDraft: (args) => createLetterDraft(db, args),
    saveDraft: (id, input) => saveLetterDraft(db, id, input),
    approve: (id) => approveLetterDraft(db, id),
    revalidate: () => revalidatePath(PATH),
  };
}

export async function startDraftAction(_prev: LetterActionState, formData: FormData): Promise<LetterActionState> {
  return runStartDraft(await deps(), formData);
}

export async function startFromVersionAction(_prev: LetterActionState, formData: FormData): Promise<LetterActionState> {
  return runStartFromVersion(await deps(), formData);
}

export async function saveDraftAction(_prev: LetterActionState, formData: FormData): Promise<LetterActionState> {
  return runSaveDraft(await deps(), formData);
}

export async function approveLetterAction(_prev: LetterActionState, formData: FormData): Promise<LetterActionState> {
  return runApprove(await deps(), formData);
}
