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
import { MATTER_LIST_VIEWS, isMatterBoardView, isMatterListView, matterBoardBase, matterListColumns, sectionOfMatterView } from "@/lib/matters/views";
import { loadMatterStages } from "@/lib/matters/stages";
import { LEADS_VIEW_KEYS, isLeadsBoardView, isLeadsListView, leadsBoardBase, leadsListColumns } from "@/lib/leads/views";
import { listStages } from "@/lib/pipeline/stages";
import { MATTER_BOARD_CLOSED_COLUMN, MATTER_BOARD_UNSTAGED_COLUMN } from "@/lib/ui/words";
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
const MATTERS_PATH = "/dashboard/matters/";
const LEADS_PATH = "/dashboard/intake/";

/** A layout change is the firm's view for everyone: both pages that draw layouts are redrawn. */
const revalidateViews = () => {
  revalidatePath(REVIEW_PATH);
  revalidatePath(MATTERS_PATH);
  revalidatePath(LEADS_PATH);
};

/** The columns an owner has for a view: the Weekly review's List and Board, the Matters and Contracts List and Board, and the Leads List and Board. */
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
  if (isMatterListView(view)) {
    const kind = sectionOfMatterView(view);
    try {
      const db = (await getScopedClient()) as unknown as StoreClient;
      return { defaults: matterListColumns((await fieldStore(db).readLiveFields()) as CustomColumnField[], kind, true) };
    } catch (e) {
      return isMissingTable(e) ? { defaults: matterListColumns([], kind, true) } : null;
    }
  }
  if (isLeadsListView(view)) {
    try {
      const db = (await getScopedClient()) as unknown as StoreClient;
      return { defaults: leadsListColumns((await fieldStore(db).readLiveFields()) as CustomColumnField[], true) };
    } catch (e) {
      return isMissingTable(e) ? { defaults: leadsListColumns([], true) } : null;
    }
  }
  if (isLeadsBoardView(view)) {
    // The Board's columns are the firm's own intake stages. Only "hidden" is ever saved (order and names are the stages', from the stage menu).
    try {
      return { defaults: leadsBoardBase(await listStages()) };
    } catch {
      return null;
    }
  }
  if (isMatterBoardView(view)) {
    // The Board's columns are the firm's own matter stages (every OPEN one) and the two fixed columns. Only "hidden" is ever saved.
    try {
      const read = await loadMatterStages();
      if (read.status === "unavailable") return null;
      return { defaults: matterBoardBase(read.stages, MATTER_BOARD_UNSTAGED_COLUMN, MATTER_BOARD_CLOSED_COLUMN) };
    } catch {
      return null;
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
    revalidate: revalidateViews,
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
  revalidateViews();
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
        for (const view of [...Object.values(REVIEW_LIST_VIEWS), ...MATTER_LIST_VIEWS, LEADS_VIEW_KEYS.list]) {
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
  revalidateViews();
  return result;
}, "state");
