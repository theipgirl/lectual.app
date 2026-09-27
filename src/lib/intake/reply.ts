import type { Lead } from "@/lib/pipeline";

/**
 * Pure reply-state derivation (blueprint §4.4). `replied` is deliberately not
 * a column — it's `last_inbound_at > last_outbound_at`, computed here so the
 * UI and any future consumer agree on one definition. No getScopedClient, no
 * server-only imports — see scope.ts's header for why that matters here.
 */

export type ReplyState = "replied" | "awaiting" | "unknown";

export function replyState(lead: Pick<Lead, "last_inbound_at" | "last_outbound_at">): ReplyState {
  const inbound = lead.last_inbound_at;
  const outbound = lead.last_outbound_at;

  if (inbound == null && outbound == null) return "unknown";

  if (inbound != null) {
    const inboundIsLatest = outbound == null || new Date(inbound).getTime() > new Date(outbound).getTime();
    if (inboundIsLatest) return "replied";
  }

  // Equal timestamps, outbound-only, or outbound strictly later: awaiting.
  return "awaiting";
}
