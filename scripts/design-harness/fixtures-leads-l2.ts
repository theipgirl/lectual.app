/**
 * Item L2 sample: RPB's real-shaped leads (fixtures-leads-real.ts) with a handful of rows given the shapes the owner saw in production:
 * long names, "Needs attorney · 1", "Moved automatically · LOE sent", a suggestion, temperatures set by a person and suggested, a duplicate
 * pair, a lead with an unknown direction and one with no contact. Pure and deterministic; it clones, so the real fixture is untouched.
 */
import { chipFor } from "@/lib/stage-keeper/moves";
import { leads as realLeads, stages, NOW_MS, type LeadRow } from "./fixtures-leads-real";

const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;
const ago = (d: number) => iso(NOW_MS - d * DAY);

export const L2_IDS: string[] = [];

export function l2Leads(): LeadRow[] {
  const leads: LeadRow[] = realLeads.map((l) => ({ ...l }));
  const open = new Set(stages.filter((s) => s.category === "open").map((s) => s.id));
  const top = leads.filter((l) => open.has(l.current_stage_id as string));
  const [a, b, c, d, e, f, g, h] = top;
  Object.assign(a, { first_name: "Antoinette", last_name: "Fairweather-Montgomery", business_name: "Fairweather Montgomery Artisan Bakery & Provisions LLC", mark_text: "FAIRWEATHER MONTGOMERY BAKERY", lane: "hot", lane_set_by: "you", lane_set_at: ago(1), last_inbound_at: ago(1), last_outbound_at: ago(3), last_activity_at: ago(1) });
  Object.assign(b, { first_name: "Larissa", last_name: "Konstantinopoulos", business_name: "Konstantinopoulos Mediterranean Imports", mark_text: null, lane: "warm", lane_set_by: "you", lane_set_at: ago(2), last_inbound_at: ago(5), last_outbound_at: ago(2), last_activity_at: ago(2) });
  Object.assign(c, { first_name: "Marisol", last_name: "Quintanilla-Vandenberghe", business_name: "Quintanilla Vandenberghe Coastal Candle Works", lane: null, lane_set_by: null, lane_set_at: null, last_inbound_at: ago(0.5), last_outbound_at: ago(4), last_activity_at: ago(0.5) });
  Object.assign(d, { first_name: "Priyanka", last_name: "Ramachandran", lane: "cold", lane_set_by: "you", lane_set_at: ago(3), last_inbound_at: null, last_outbound_at: null, last_activity_at: ago(6) });
  Object.assign(e, { first_name: "Bartholomew", last_name: "Featherstone-Hale", lane: null, lane_set_by: null, lane_set_at: null, last_inbound_at: null, last_outbound_at: ago(9), last_activity_at: ago(9) });
  Object.assign(f, { first_name: "Dominique", last_name: "Okonkwo", email: "dominique.okonkwo@example.test", lane: "warm", lane_set_by: "you", lane_set_at: ago(2), last_inbound_at: ago(2), last_outbound_at: ago(7), last_activity_at: ago(2) });
  Object.assign(g, { first_name: "Dominique", last_name: "Okonkwo", email: "dominique.okonkwo@example.test", business_name: "Okonkwo Textiles", lane: null, last_inbound_at: ago(8), last_outbound_at: ago(10), last_activity_at: ago(8) });
  Object.assign(h, { first_name: "Wen", last_name: "Zhao", lane: null, last_inbound_at: null, last_outbound_at: null, last_activity_at: null, created_at: ago(1) });
  L2_IDS.splice(0, L2_IDS.length, ...[a, b, c, d, e, f, g, h].map((l) => l.id as string));
  return leads;
}

export function l2State(now: Date) {
  if (L2_IDS.length === 0) l2Leads();
  const [a, b, c, , e, f, g] = L2_IDS;
  const move = (leadId: string, signal: "loe-invoice-sent" | "consult-held", daysAgo: number) =>
    chipFor(
      {
        activityId: `mv-${leadId.slice(-4)}`, leadId, at: ago(daysAgo), fromStageId: null, toStageId: null, fromStage: "Potential New Client", toStage: "Post Consultation Email Sent",
        signalKey: `${leadId}:mail:x`, signal, evidence: { kind: "mail", type: "loe_invoice", direction: "outbound", at: ago(daysAgo), subject: null }, previousStageEnteredAt: null,
      },
      now,
      "America/New_York",
    );
  const chips = { [a]: move(a, "loe-invoice-sent", 1), [b]: move(b, "consult-held", 2), [f]: move(f, "loe-invoice-sent", 3) };
  return {
    pending: { status: "ok" as const, byLead: { [a]: [{ queueId: "q1", headline: "Post-consult email for Antoinette", kind: "client_draft" as const, createdAt: ago(1) }], [c]: [{ queueId: "q2", headline: "Welcome email", kind: "client_draft" as const, createdAt: ago(1) }, { queueId: "q3", headline: "Proposal email", kind: "client_draft" as const, createdAt: ago(1) }] } },
    moves: { status: "ok" as const, chips, truncated: false, movedToday: 0 },
    facts: { status: "ok" as const, byLead: { [e]: { firstTouchAt: ago(12), bookedAt: null }, [g]: { firstTouchAt: ago(2) } } },
  };
}
