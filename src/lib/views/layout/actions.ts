"use server";

import { previewSafe } from "@/lib/views/preview-safe";
import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { createFieldWithId, updateField } from "@/lib/custom-columns/field-actions";
import { isMissingTable } from "@/lib/custom-columns/errors";
import { fieldStore, type StoreClient } from "@/lib/custom-columns/store";
import { fieldDepsFor } from "@/lib/custom-columns/field-deps";
import { listMemberDirectory } from "@/lib/members/directory";
import { reviewBoardBase, reviewListBase } from "@/lib/review/layout-base";
import { REVIEW_LIST_VIEWS, isReviewListView, sectionOfListView } from "@/lib/review/layout";
import type { CustomColumnField } from "@/lib/review/sheet-columns";
import { addColumn, type AddColumnResult } from "./add-column";
import { changeFirmColumn, type FirmColumnResult } from "./firm-column";
import { readViewLayout } from "./load";
import { loadOwnerState } from "./owner-load";
import { changeLayout, type LayoutBase, type LayoutResult, type SaveDeps } from "./save";
import { layoutStore, type LayoutWriteClient } from "./store";
import type { ViewKey } from "./types";

/**
 * The owner's column menu, as server actions. Thin wrappers: each builds its dependencies from the caller's SCOPED client (never the
 * service role) and hands the logic (`save.ts`, `add-column.ts`) only the named fields it needs. Each call is its own POST entry point:
 * the logic re-resolves the caller as an owner membership row first, and answers a fixed sentence for everything.
 */

const REVIEW_PATH = "/dashboard/review/";

/** The columns an owner has for a view. Only the Weekly review's two views exist so far; any other view has none to change yet. */
async function baseFor(view: ViewKey): Promise<LayoutBase | null> {
  if (isReviewListView(view)) {
    try {
      const db = (await getScopedClient()) as unknown as StoreClient;
      return { defaults: reviewListBase((await fieldStore(db).readLiveFields()) as CustomColumnField[], sectionOfListView(view)) };
    } catch (e) {
      // The firm's own columns aren't switched on: the List is the spreadsheet's columns alone. Any other failure is "couldn't read".
      return isMissingTable(e) ? { defaults: reviewListBase([], sectionOfListView(view)) } : null;
    }
  }
  if (view === "review_board") {
    try {
      const members = await listMemberDirectory();
      return { defaults: reviewBoardBase(members.map((m) => ({ userId: m.userId, name: m.displayName || m.email || "Teammate", role: m.role }))) };
    } catch {
      return null;
    }
  }
  return null;
}

function saveDeps(): SaveDeps {
  return {
    owner: () => loadOwnerState(),
    orgId: async () => {
      const session = await resolveFirmSession();
      return session.kind === "ok" ? (session.org?.id ?? null) : null;
    },
    read: async (view) => readViewLayout(await getScopedClient(), view),
    base: baseFor,
    insert: async (view, orgId, columns) => layoutStore((await getScopedClient()) as unknown as LayoutWriteClient).insert(view, orgId, columns),
    update: async (view, columns, rev) => layoutStore((await getScopedClient()) as unknown as LayoutWriteClient).update(view, columns, rev),
    revalidate: () => revalidatePath(REVIEW_PATH),
  };
}

/** Rename, hide, show, move or resize a column (or a person's lane). The browser sends the operation and the rev it saw, never a layout. */
export const changeLayoutAction = previewSafe(async function changeLayoutAction(view: string, op: unknown, rev: number | null): Promise<LayoutResult> {
  return changeLayout(saveDeps(), view, op, rev);
}, "state");

/** Add a firm column and place it, in one step. See `add-column.ts`. */
export const addColumnAction = previewSafe(async function addColumnAction(input: { view: string; rev: number | null; relativeTo: string; side: string; label: string; section: string; kind: string; choices: string }): Promise<AddColumnResult> {
  const deps = saveDeps();
  const result = await addColumn(
    {
      createField: (i) => createFieldWithId(fieldDepsFor(), i),
      changeLayout: (view, op, rev) => changeLayout(deps, view, op, rev),
    },
    { view: input?.view, rev: input?.rev, relativeTo: input?.relativeTo, side: input?.side, label: input?.label, section: input?.section, kind: input?.kind, choices: input?.choices },
  );
  revalidatePath(REVIEW_PATH);
  return result;
}, "state");

/** Rename (the field itself), edit the choices of, or archive a firm's own column, from its header menu. See `firm-column.ts`. */
export const firmColumnAction = previewSafe(async function firmColumnAction(input: { op: string; key: string; label?: string; choices?: string }): Promise<FirmColumnResult> {
  const fields = fieldDepsFor();
  const deps = saveDeps();
  const result = await changeFirmColumn(
    {
      owner: () => fields.owner(),
      readStamp: async (id) => (await fields.readField(id))?.updated_at ?? null,
      update: (i) => updateField(fields, i),
      clearLabels: async (key) => {
        let all = true;
        for (const view of Object.values(REVIEW_LIST_VIEWS)) {
          const read = await deps.read(view);
          if (read.status === "not-set-up") continue;
          if (read.status !== "ok") {
            all = false;
            continue;
          }
          if (!read.layout?.some((c) => c.key === key && c.label !== null)) continue;
          if (!(await changeLayout(deps, view, { op: "rename", key, label: "" }, read.rev)).ok) all = false;
        }
        return all;
      },
    },
    { op: input?.op, key: input?.key, label: input?.label, choices: input?.choices },
  );
  revalidatePath(REVIEW_PATH);
  return result;
}, "state");
