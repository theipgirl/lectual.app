import type { IntakeRow } from "./rows";

/**
 * The Intake workspace keeps its rows in state so an edit shows at once (optimistic). When the server sends FRESH rows (a save in
 * the opened card, or any `router.refresh()`), the drawn rows must follow them, or a board keeps the old temperature, stage, owner
 * and name. The one row with a write in flight keeps its optimistic version until that write answers. PURE.
 */
export function resyncRows(current: readonly IntakeRow[], fresh: readonly IntakeRow[], inFlightId: string | null): IntakeRow[] {
  if (!inFlightId) return [...fresh];
  const mine = current.find((r) => r.lead.id === inFlightId);
  return fresh.map((r) => (r.lead.id === inFlightId && mine ? mine : r));
}
