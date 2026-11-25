import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadCustomColumns } from "@/lib/custom-columns/load";
import { withoutMoney, type CustomColumnsState } from "@/lib/custom-columns/rules";
import { readMergedChildren } from "@/lib/review/load";
import { readSheetNotes, type NotesDb } from "@/lib/review/sheet-notes-load";
import type { SheetNotes } from "@/lib/review/sheet-notes";

/**
 * The two reads the Matters and Contracts List makes beyond the matters themselves: the firm's own columns (their fields and the
 * values on the matters shown, a matter also showing its lead's value) and the newest plain note of each matter. Both are the Weekly
 * review's own reads over the caller's SCOPED client (RLS on the active firm); neither touches the service role.
 *
 * Three states each, never collapsed: custom `ok` / `not-set-up` / `unavailable`, notes `ok` / `unavailable` (null = not asked for:
 * the Notes column is hidden). A thrown error is "couldn't load", never "nothing recorded". Money is the owner's alone: `canSeeMoney`
 * comes from the page's re-resolved role and no amount is read without it.
 */
export async function loadMatterListExtras(opts: {
  matters: readonly { id: string; lead_id: string | null }[];
  withNotes: boolean;
  timeZone: string;
  canSeeMoney: boolean;
}): Promise<{ custom: CustomColumnsState; notes: SheetNotes | null }> {
  const ids = opts.matters.map((m) => m.id);
  const leadIds = [...new Set(opts.matters.map((m) => m.lead_id).filter((id): id is string => !!id))];
  const leadOfMatter: Record<string, string> = {};
  for (const m of opts.matters) if (m.lead_id) leadOfMatter[m.id] = m.lead_id;
  let db: Awaited<ReturnType<typeof getScopedClient>>;
  try {
    db = await getScopedClient();
  } catch {
    return { custom: { status: "unavailable" }, notes: opts.withNotes ? { status: "unavailable" } : null };
  }
  const [custom, notes] = await Promise.all([
    (async (): Promise<CustomColumnsState> => {
      try {
        const r = await loadCustomColumns(db, ids, leadIds, readMergedChildren as never, { canSeeMoney: opts.canSeeMoney });
        if (r.status !== "ok") return r;
        const state: CustomColumnsState = { ...r, leadOfMatter };
        return opts.canSeeMoney ? state : withoutMoney(state);
      } catch {
        return { status: "unavailable" };
      }
    })(),
    opts.withNotes ? readSheetNotes(db as unknown as NotesDb, ids.map((id) => ({ kind: "matter" as const, id })), opts.timeZone) : Promise.resolve(null),
  ]);
  return { custom, notes };
}

