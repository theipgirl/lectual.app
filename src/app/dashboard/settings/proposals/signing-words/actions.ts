"use server";

import { revalidatePath } from "next/cache";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { isCurrentUserApprover } from "@/lib/proposals/store";
import { currentOrgId } from "@/lib/loe/templates-store";
import { runApproveWords, runSaveWordsDraft, runStartWordsDraft, type WordsDeps } from "@/lib/loe/signing-words-actions";
import { approveWordsDraft, createWordsDraft, getWordsVersion, saveWordsDraft } from "@/lib/loe/signing-words-store";
import { requireProposalsModule } from "../../../proposals/gate";

/**
 * Signing words actions (lectual 0117). Each is its own POST entry point: the feature gate and the caller's role run first,
 * inside `run*`, and the database (RLS plus 0117's trigger) is the boundary underneath. Scoped client only.
 */

const PATH = "/dashboard/settings/proposals/signing-words/";

async function deps(): Promise<WordsDeps> {
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
    readVersion: (id) => getWordsVersion(db, id),
    createDraft: (args) => createWordsDraft(db, args),
    saveDraft: (id, words) => saveWordsDraft(db, id, words),
    approve: (id) => approveWordsDraft(db, id),
    revalidate: () => revalidatePath(PATH),
  };
}

export async function startWordsDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runStartWordsDraft(await deps(), formData);
}

export async function saveWordsDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runSaveWordsDraft(await deps(), formData);
}

export async function approveWordsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runApproveWords(await deps(), formData);
}
