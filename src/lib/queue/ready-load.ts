import "server-only";
import type { QueueItem } from "@/lib/queue/api";
import { loadActiveQueue } from "@/lib/queue/load";
import { loadCardState } from "@/lib/queue/card-state";
import { trustedCardState, type EventTrust } from "@/lib/queue/deck";
import { readyToDraft } from "@/lib/queue/draft-handoff";

/**
 * "Ready to draft (N)" (Sprint 4): the approved client emails passed to this viewer that they have not drafted yet.
 * Three states: `ok` (with the items, maybe none), `not-set-up` (before lectual 0112 the events can't exist; nothing is
 * drawn), `unavailable` (the queue, the events or the routing couldn't be read: never "none ready"). The events are
 * folded with `trustedCardState`, so a forged draft_to never puts a card here; with the trust unknown nothing is listed.
 */
export type ReadyLoad = { status: "ok"; items: QueueItem[] } | { status: "not-set-up" } | { status: "unavailable" };

export async function loadReadyToDraft(args: { viewerId: string | null | undefined; trust: EventTrust; approved?: QueueItem[] }): Promise<ReadyLoad> {
  if (!args.viewerId) return { status: "ok", items: [] };
  let approved = args.approved;
  if (!approved) {
    const load = await loadActiveQueue("approved");
    if (load.status === "unconfigured") return { status: "ok", items: [] };
    if (load.status !== "ok") return { status: "unavailable" };
    approved = load.items;
  }
  const candidates = approved.filter((i) => i.status === "approved" && i.type === "CLIENT_EMAIL");
  const state = trustedCardState(await loadCardState(candidates.map((i) => i.id)), candidates, args.trust);
  if (state.status === "not-set-up") return { status: "not-set-up" };
  if (state.status !== "ok" || args.trust.status !== "known") return { status: "unavailable" };
  return { status: "ok", items: readyToDraft(candidates, state, args.viewerId) };
}
