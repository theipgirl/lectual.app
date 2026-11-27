"use server";

import { previewSafe } from "@/lib/views/preview-safe";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveCurrentRole } from "@/lib/pipeline/leads";
import { buildChoices, runMergeLeads } from "@/lib/leads/merge";
import { mergedRedirect } from "@/lib/leads/merge-links";

export type MergeActionState = { error?: string };

/**
 * Merge two leads (M5, lectual 0107). The role is re-resolved on THIS call and a refused role reads and writes
 * nothing (`runMergeLeads`). The choices are built only from the known fields; the keeper and the merged lead are
 * the two ids the form carries. `crm_merge_leads` is called once through the caller's scoped client, never the
 * service role. Every refusal is a fixed sentence. On success: the kept lead's page, with a quiet "Merged" line.
 */
export const mergeLeadsAction = previewSafe(async function mergeLeadsAction(_prev: MergeActionState, form: FormData): Promise<MergeActionState> {
  const db = await getScopedClient();
  const result = await runMergeLeads(
    { keeperId: form.get("keeper"), loserId: form.get("loser"), choices: buildChoices(form) },
    {
      role: () => resolveCurrentRole(db),
      merge: async (args) => {
        const rpc = db.rpc as unknown as (name: string, a: unknown) => PromiseLike<{ data: unknown; error: unknown }>;
        return rpc.call(db, "crm_merge_leads", args);
      },
    },
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/intake/");
  revalidatePath(`/dashboard/leads/${result.keeperId}`);
  redirect(mergedRedirect(result.keeperId));
}, "state");
