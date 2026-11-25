"use server";

import { previewSafe } from "@/lib/views/preview-safe";
import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { keeperForWrite } from "@/lib/leads/live";
import { listMemberDirectory } from "@/lib/members/directory";
import { resolveCurrentRole } from "@/lib/pipeline/leads";
import { createField, updateField, type ActionState } from "./field-actions";
import { fieldDepsFor } from "./field-deps";
import { fieldStore, valueStore, type StoreClient } from "./store";
import { setCustomValue, type ValueDeps } from "./value-actions";

/**
 * The firm's own columns (create, rename, choices, order, archive: an owner's, from the column menu) and the custom-cell editors. Thin wrappers: each builds its dependencies from the caller's SCOPED client and hands
 * the logic only the named fields it needs. Nothing else of the form is read: never an org, a user, a role or a stamp. Each call is its
 * own POST entry point, so each re-resolves the role itself (the logic's first rule).
 */

const REVIEW_PATH = "/dashboard/review/";

async function store(): Promise<StoreClient> {
  return (await getScopedClient()) as unknown as StoreClient;
}

function valueDeps(): ValueDeps {
  return {
    role: async () => resolveCurrentRole(await getScopedClient()),
    actingAsStaff: async () => {
      const session = await resolveFirmSession();
      // Anything but a signed-in member session is treated as staff (fail closed): only a real owner types money.
      return session.kind === "ok" ? session.actingAsStaff !== false : true;
    },
    readField: async (id) => fieldStore(await store()).readField(id),
    keeper: async (leadId) => keeperForWrite(await getScopedClient(), leadId),
    readRecord: async (kind, id) => valueStore(await store()).readRecord(kind, id),
    readMembers: async () => (await listMemberDirectory()).map((m) => ({ userId: m.userId })),
    readValueRow: async (fieldId, kind, recordId) => valueStore(await store()).readValueRow(fieldId, kind, recordId),
    insertValue: async (row) => valueStore(await store()).insertValue(row),
    updateValue: async (id, patch) => valueStore(await store()).updateValue(id, patch),
    deleteValue: async (id) => valueStore(await store()).deleteValue(id),
    revalidate: (kind, id) => {
      revalidatePath(REVIEW_PATH);
      revalidatePath(kind === "lead" ? `/dashboard/leads/${id}/` : `/dashboard/matters/${id}/`);
    },
  };
}

export const createFieldAction = previewSafe(async function createFieldAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return createField(fieldDepsFor(), {
    label: formData.get("label"),
    section: formData.get("section"),
    kind: formData.get("kind"),
    choices: formData.get("choices"),
  });
}, "state");

export const updateFieldAction = previewSafe(async function updateFieldAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return updateField(fieldDepsFor(), {
    op: formData.get("op"),
    id: formData.get("id"),
    label: formData.get("label"),
    choices: formData.get("choices"),
    dir: formData.get("dir"),
    updatedAt: formData.get("updatedAt"),
  });
}, "state");

export const setCustomValueAction = previewSafe(async function setCustomValueAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setCustomValue(valueDeps(), {
    fieldId: formData.get("fieldId"),
    kind: formData.get("kind"),
    id: formData.get("id"),
    value: formData.get("value"),
  });
}, "state");
