/**
 * Spec 7, Part B: "has the client opened it?", from the `viewed` events the public page ALREADY writes
 * (`recordProposalViewed`: at most one per five minutes, never for the firm's own staff). Nothing new is tracked.
 *
 * Pure: the store reads the rows (scoped client, RLS only) and hands them here. Only `actor = 'client'` `viewed`
 * events count. The stored payload (the coarse browser family) is never read, shown or logged here.
 *
 * Three states, never two: opened (count and last time), not opened, and couldn't be read. A failed read is never
 * "Not opened yet". A version whose link was never live (draft, saved) has nothing to open: "—".
 */

import { formatFirmStamp } from "@/lib/quotes/labels";
import type { ProposalStatus } from "./types";

export type OpensSummary = { count: number; lastAt: string };
/** Version id -> its opens (absent = none), or "unavailable" when the read failed. */
export type OpensRead = ReadonlyMap<string, OpensSummary> | "unavailable";

export const OPENS_UNAVAILABLE = "Couldn't load opens";
export const NOT_OPENED_YET = "Not opened yet";
export const NOT_OPENED = "Not opened";
export const NO_LINK_YET = "—";

type EventLike = { proposal_id?: unknown; type?: unknown; actor?: unknown; created_at?: unknown };

/** Rows of `client_proposal_event` -> count and newest open per version, counting only the client's `viewed` events. */
export function summarizeOpens(rows: ReadonlyArray<EventLike>): Map<string, OpensSummary> {
  const out = new Map<string, OpensSummary>();
  for (const row of rows) {
    if (row.type !== "viewed" || row.actor !== "client") continue;
    if (typeof row.proposal_id !== "string" || typeof row.created_at !== "string") continue;
    const seen = out.get(row.proposal_id);
    if (!seen) out.set(row.proposal_id, { count: 1, lastAt: row.created_at });
    else out.set(row.proposal_id, { count: seen.count + 1, lastAt: toMs(row.created_at) > toMs(seen.lastAt) ? row.created_at : seen.lastAt });
  }
  return out;
}

function toMs(value: string): number {
  const ms = Date.parse(value.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(ms) ? 0 : ms;
}

/** "Oct 29, 3:12 PM" in the firm's time zone. */
export function openedStamp(value: string, tz: string): string {
  const ms = toMs(value);
  return ms ? formatFirmStamp(new Date(ms).toISOString(), tz) : "";
}

function times(n: number): string {
  return n === 1 ? "once" : `${n} times`;
}

/** A link that was live at some point: anything but a draft or a saved version. */
function hadLiveLink(status: ProposalStatus | string): boolean {
  return status !== "draft" && status !== "approved";
}

export type OpensKind = "opened" | "not_opened" | "unavailable" | "no_link";

/** Which of the states a version is in. */
export function opensKind(status: ProposalStatus | string, read: OpensRead, id: string): OpensKind {
  if (!hadLiveLink(status)) return "no_link";
  if (read === "unavailable") return "unavailable";
  return (read.get(id)?.count ?? 0) > 0 ? "opened" : "not_opened";
}

/** The proposals list's line: "Opened Oct 29, 3:12 PM · 4 times", "Not opened yet", "Couldn't load opens" or "—". */
export function opensListText(status: ProposalStatus | string, read: OpensRead, id: string, tz: string): string {
  const kind = opensKind(status, read, id);
  if (kind === "no_link") return NO_LINK_YET;
  if (kind === "unavailable") return OPENS_UNAVAILABLE;
  if (kind === "not_opened") return status === "sent" ? NOT_OPENED_YET : NOT_OPENED;
  const o = (read as ReadonlyMap<string, OpensSummary>).get(id)!;
  const when = openedStamp(o.lastAt, tz);
  return `Opened${when ? ` ${when}` : ""} · ${times(o.count)}`;
}

/**
 * The proposal page's line, near the link box: "Opened by the client 4 times · last opened Oct 29, 3:12 PM",
 * "Not opened by the client yet", "Couldn't load opens", or null for a version whose link was never live.
 */
export function opensPageText(status: ProposalStatus | string, read: OpensRead, id: string, tz: string): string | null {
  const kind = opensKind(status, read, id);
  if (kind === "no_link") return null;
  if (kind === "unavailable") return OPENS_UNAVAILABLE;
  if (kind === "not_opened") return status === "sent" ? "Not opened by the client yet" : "Not opened by the client";
  const o = (read as ReadonlyMap<string, OpensSummary>).get(id)!;
  const when = openedStamp(o.lastAt, tz);
  return `Opened by the client ${times(o.count)}${when ? ` · last opened ${when}` : ""}`;
}
