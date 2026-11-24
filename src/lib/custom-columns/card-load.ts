import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { readMergedChildren } from "@/lib/review/load";
import { loadCustomColumns, type CustomReadAccess, type ReadMerged } from "./load";
import type { CustomColumnsState } from "./rules";

/** The record the opened card shows: the id the card resolved (a merged lead opened by URL is its keeper). */
export type CardCustomRecord = { kind: "lead"; id: string } | { kind: "matter"; id: string; leadId: string | null };

export type CardCustomDeps = {
  client: () => Promise<unknown>;
  read: typeof loadCustomColumns;
  readMerged: ReadMerged;
};

// Each default is looked up when the card reads, not when this module loads.
const DEFAULT_DEPS: CardCustomDeps = { client: () => getScopedClient(), read: (...a) => loadCustomColumns(...a), readMerged: (db, ids) => readMergedChildren(db, ids) };

/**
 * The opened card's own read of the firm's columns, for a record the page made no custom read for (not on the review, or a view other
 * than the List). ONE scoped read for that record (a matter's lead and the leads merged into it included). Anything that throws is
 * "couldn't load", never "nothing recorded". `access` comes from the card's re-resolved role: no amount is read for a non-owner.
 */
export async function loadCardCustomColumns(record: CardCustomRecord, access: CustomReadAccess, deps: Partial<CardCustomDeps> = {}): Promise<CustomColumnsState> {
  const d = { ...DEFAULT_DEPS, ...deps };
  try {
    const db = await d.client();
    const matterIds = record.kind === "matter" ? [record.id] : [];
    const leadIds = record.kind === "lead" ? [record.id] : record.leadId ? [record.leadId] : [];
    const r = await d.read(db, matterIds, leadIds, d.readMerged, { canSeeMoney: access?.canSeeMoney === true });
    if (r.status !== "ok") return r;
    return { ...r, leadOfMatter: record.kind === "matter" && record.leadId ? { [record.id]: record.leadId } : {} };
  } catch {
    return { status: "unavailable" };
  }
}
