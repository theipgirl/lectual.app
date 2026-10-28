"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { orgHasModule } from "@/lib/org/modules";
import { requireMatterWriteRole } from "@/lib/matters/matters";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { generateApprovedDocument } from "@/lib/documents/approve-hook";
import { RETRY_SENTENCES, runRetry, type RetryState } from "@/lib/documents/retry";

/**
 * Retry a failed letter: the existing approved-document step, run again for the same draft. A
 * "use server" function is its own POST entry point, so it re-checks the module and the matter
 * write role itself. Nothing is sent and nothing new is queued.
 */
export async function retryDocumentAction(_prev: RetryState, formData: FormData): Promise<RetryState> {
  return runRetry(
    {
      gate: async () => {
        if (!(await orgHasModule("document-center").catch(() => false))) return RETRY_SENTENCES.notFound;
        try {
          await requireMatterWriteRole(await getScopedClient());
          return null;
        } catch {
          return RETRY_SENTENCES.notAllowed;
        }
      },
      loadDraft: async (id) => {
        const supabase = await getScopedClient();
        const { data, error } = await supabase.from("crm_document_draft").select("status, queue_item_id").eq("id", id).maybeSingle();
        if (error) throw error;
        return (data as { status: string; queue_item_id: string | null } | null) ?? null;
      },
      orgKey: activeQueueOrgKey,
      generate: generateApprovedDocument,
      revalidate: () => revalidatePath("/dashboard/documents/"),
    },
    String(formData.get("draftId") ?? ""),
  );
}
