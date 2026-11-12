/**
 * Sprint 3: the three doors on New proposal. PURE: the page makes the reads and passes in what it found; this
 * decides which doors are drawn and what the Copilot link says.
 *
 * Each door is gated on its own: Start from scratch needs a proposal-writing role; Ask Copilot needs the AI
 * assistant switched on (no link at all otherwise); From a consult is always drawn for a writer, and says what is
 * needed when meetings aren't connected. A failed read says so and is never "no consults".
 */

import type { ConsultsStripData } from "./consults-load";
import { copilotRequest } from "@/lib/proposal-editor/vocabulary";

export type DoorId = "consult" | "copilot" | "scratch";

/** What the page found for the consult door. */
export type ConsultDoorState =
  | { kind: "not-connected" }
  | { kind: "unavailable" }
  | { kind: "ok"; data: ConsultsStripData };

/** A proposal as the consult rows need it: enough to tell that a consult already has one. */
export type DoorProposal = { id: string; leadId: string | null; createdAt: string; source: string };

/**
 * The consult door's state, from three reads the page passes in. THREE-STATE, and every read counts:
 *   - no Zoom or Fathom connection: `not-connected` (the door says what is needed);
 *   - the firm's PROPOSALS couldn't be read: `unavailable`. They are what tells a consult that already has a proposal from one
 *     that is ready to draft, so a failed read must never be treated as "no proposals": the door shows its "couldn't load"
 *     state and NO rows, and therefore no "Draft the proposal" button;
 *   - the meetings couldn't be read, or anything threw: `unavailable`;
 *   - otherwise the rows.
 * Pure apart from the reads it is handed, so the states are tested without a database.
 */
export async function consultDoorState(reads: {
  /** True when the firm has no meeting source connected at all (a read that worked and found none). */
  notConnected: () => Promise<boolean>;
  /** The firm's proposals. Must THROW (or reject) when the read fails: an empty list means there really are none. */
  proposals: () => Promise<DoorProposal[]>;
  strip: (proposals: DoorProposal[]) => Promise<ConsultsStripData>;
}): Promise<ConsultDoorState> {
  try {
    if (await reads.notConnected()) return { kind: "not-connected" };
    let proposals: DoorProposal[];
    try {
      proposals = await reads.proposals();
    } catch {
      return { kind: "unavailable" };
    }
    const data = await reads.strip(proposals);
    return data.meetings.status === "unavailable" ? { kind: "unavailable" } : { kind: "ok", data };
  } catch {
    return { kind: "unavailable" };
  }
}

export function startDoors(input: { canWrite: boolean; aiOn: boolean }): DoorId[] {
  if (!input.canWrite) return [];
  return ["consult", ...(input.aiOn ? (["copilot"] as const) : []), "scratch"];
}

/** The Copilot link: the request typed in, never sent. Only a name goes in (when a lead is chosen), never a price. */
export function copilotHref(name: string | null): string {
  return `/dashboard/copilot/?q=${encodeURIComponent(copilotRequest(name))}`;
}

/**
 * True when the start screen is what `/dashboard/proposals/new/` shows: none of lead, matter, blank, door. The picker's
 * own search (`kind`, `q`) and the type switch (`type`) belong to "Who is this for?", so they are not the start screen either.
 */
export function isStartScreen(params: { lead?: unknown; matter?: unknown; blank?: unknown; door?: unknown; kind?: unknown; q?: unknown; type?: unknown }): boolean {
  const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 && v[0] !== "" : typeof v === "string" && v !== "");
  return !has(params.lead) && !has(params.matter) && !has(params.blank) && !has(params.door) && !has(params.kind) && !has(params.q) && !has(params.type);
}
