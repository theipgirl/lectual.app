/**
 * The four numbers on the copilot's landing page. Each is one of three things:
 * a number, "couldn't load", or (queue only) "not connected". A failed read is
 * never drawn as 0, and an unreachable queue is never "all caught up" — the
 * same rule as Today's tiles.
 */

export type StatRead = { status: "ok"; value: number } | { status: "unavailable" } | { status: "unconfigured" };

export type StatCardData = {
  id: "open" | "stalled" | "deadlines" | "approvals";
  label: string;
  /** null for any state but `ok`. */
  value: number | null;
  note: string;
  href: string;
  state: StatRead["status"];
};

const CARDS: Array<Pick<StatCardData, "id" | "label" | "href"> & { note: string; unconfiguredNote?: string }> = [
  { id: "open", label: "Open matters", href: "/dashboard/matters/", note: "on the docket right now" },
  { id: "stalled", label: "Stalled matters", href: "/dashboard/matters/?seg=stalled", note: "past their stage's threshold" },
  { id: "deadlines", label: "Deadlines, next 14 days", href: "/dashboard/calendar/", note: "open, including any overdue" },
  {
    id: "approvals",
    label: "Approvals waiting",
    href: "/dashboard/queue/",
    note: "drafts waiting for your review",
    unconfiguredNote: "Approvals aren't connected",
  },
];

export function buildStatCards(reads: Record<StatCardData["id"], StatRead>): StatCardData[] {
  return CARDS.map((card) => {
    const read = reads[card.id];
    return {
      id: card.id,
      label: card.label,
      href: card.href,
      value: read.status === "ok" ? read.value : null,
      note: read.status === "ok" ? card.note : read.status === "unconfigured" ? (card.unconfiguredNote ?? "Not connected") : "Couldn't load",
      state: read.status,
    };
  });
}
