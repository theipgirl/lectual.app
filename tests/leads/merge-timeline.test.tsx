import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/dashboard/leads/[id]/stage-keeper-actions", () => ({ undoAgentMoveAction: vi.fn(), acceptStageSuggestionAction: vi.fn(), dismissStageSuggestionAction: vi.fn() }));

const { Timeline } = await import("@/components/timeline/Timeline");
const { AGENT_ACTOR } = await import("@/lib/stage-keeper/moves");

const K = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";
const move = (leadId: string) => ({ id: `m-${leadId}`, lead_id: leadId, type: "stage_changed", actor_type: "ai", created_at: "2026-11-01T00:00:00Z", payload: { actor: AGENT_ACTOR, from_stage_id: "s1", to_stage_id: "s2" } });

describe("8. Undo on the kept lead's timeline (M5)", () => {
  it("the keeper's own agent move offers Undo", () => {
    const html = renderToStaticMarkup(<Timeline rows={[move(K)]} undo={{ leadId: K, canMove: true, currentStageId: "s2" }} />);
    expect(html).toContain("Undo");
  });
  it("a merged lead's agent move shown on the keeper offers no Undo, and does not count as a later change", () => {
    const html = renderToStaticMarkup(<Timeline rows={[move(L)]} undo={{ leadId: K, canMove: true, currentStageId: "s2" }} />);
    expect(html).not.toContain(">Undo<");
    const later = { ...move(L), id: "later", created_at: "2026-11-05T00:00:00Z", payload: { from_stage_id: "s0", to_stage_id: "s9" } };
    const both = renderToStaticMarkup(<Timeline rows={[later, move(K)]} undo={{ leadId: K, canMove: true, currentStageId: "s2" }} />);
    expect(both).toContain("Undo");
  });
});
