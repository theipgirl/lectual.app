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
