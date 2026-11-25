import "server-only";
import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadOwnerState } from "@/lib/views/layout/owner-load";
import { isOwner } from "@/lib/views/layout/owner";
import type { FieldDeps } from "./field-actions";
import { fieldStore, type StoreClient } from "./store";

/**
 * The field actions' dependencies, from the caller's SCOPED client (never the service role). A plain module, not a `"use server"` file,
 * so both the create/rename actions and the column menu's "Add a column" can build the same dependencies.
 */
async function store(): Promise<StoreClient> {
  return (await getScopedClient()) as unknown as StoreClient;
}

export function fieldDepsFor(): FieldDeps {
  return {
    // An owner by the caller's own membership row (never the role claim): lectual 0119 makes field create and change owner-only.
    owner: async () => isOwner(await loadOwnerState()),
    orgId: async () => {
      const session = await resolveFirmSession();
      if (session.kind !== "ok" || !session.org?.id) throw new Error("no active firm");
      return session.org.id;
    },
    readField: async (id) => fieldStore(await store()).readField(id),
    readLiveFields: async () => fieldStore(await store()).readLiveFields(),
    readOptionUse: async (fieldId, options) => fieldStore(await store()).readOptionUse(fieldId, options),
    insertField: async (row) => fieldStore(await store()).insertField(row),
    updateField: async (id, patch, guards) => fieldStore(await store()).updateField(id, patch, guards),
    revalidate: () => {
      revalidatePath("/dashboard/review/");
    },
  };
}
