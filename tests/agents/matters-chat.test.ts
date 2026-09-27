import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Matter } from "@/lib/matters";
import type { Lead } from "@/lib/pipeline";
import type { callClaudeWithTools } from "@/lib/ai/claude";

/**
 * The AI copilot's question-answering agent (/dashboard/copilot/), ported
 * from lectual's home-page "search your matters" copilot.
 *
 * Mock-based, no DB required — every @/lib/matters / @/lib/pipeline read
 * function the tool set calls is mocked directly (vi.doMock + a fresh
 * dynamic import per test, same pattern as lectual's source test), and the
 * model call itself is a hand-written fake matching `callClaudeWithTools`'s
 * shape (this app has no `ai`-SDK mock model — @/lib/ai/claude wraps
 * @anthropic-ai/sdk directly). This tests the plumbing (tool wiring,
 * citation collection, the declined signal) rather than model behaviour.
 */

type Call = typeof callClaudeWithTools;
type CallResult = Awaited<ReturnType<Call>>;

function usage() {
  return { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function toolCallResponse(calls: Array<{ toolName: string; input: unknown }>): CallResult {
  return {
    content: calls.map((c, i) => ({ type: "tool_use" as const, id: `call-${i}`, name: c.toolName, input: c.input })),
    model: "claude-sonnet-5",
    usage: usage(),
    costUsd: 0.001,
  };
}

function textResponse(text: string): CallResult {
  return {
    content: [{ type: "text" as const, text, citations: null }],
    model: "claude-sonnet-5",
    usage: usage(),
    costUsd: 0.001,
  };
}

function matter(overrides: Partial<Matter> = {}): Matter {
  return {
    id: "m-1",
    org_id: "org-1",
    matter_number: "TM-2026-0031",
    title: "AURELIA",
    mark_text: "AURELIA",
    type: "TM",
    status: "open",
    owner_name: null,
    package_name: null,
    practice_pipeline: null,
    lead_id: null,
    assigned_to: null,
    notes: null,
    referral_source: null,
    lawmatics_id: null,
    lawmatics_synced_at: null,
    opened_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stage_id: "stage-1",
    stage_entered_at: new Date().toISOString(),
    filing_basis: "1a",
    filing_date: "2026-01-15",
    registration_date: null,
    registration_number: null,
    serial_number: "98123456",
    examining_attorney: null,
    uspto_status: "Published for opposition",
    uspto_status_as_of: "2026-06-01",
    goods_services: null,
    international_classes: null,
    stage: {
      id: "stage-1",
      code: "10",
      label: "Publication",
      order_index: 10,
      is_open: true,
      waiting_on: "uspto",
    },
    ...overrides,
  } as Matter;
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    org_id: "org-1",
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    phone: null,
    business_name: "Doe Studio",
    website: null,
    current_stage_id: "stage-1",
    assigned_to: null,
    qualification_score: 70,
    urgency_band: "7d",
    value_band: "MID",
    stage_entered_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    founder_id: null,
    ai_summary: null,
    ai_red_flags: [],
    ai_enriched_at: null,
    practice_area: null,
    mark_text: null,
    temperature: null,
    temperature_set_at: null,
    temperature_set_by: null,
    ...overrides,
  } as Lead;
}

function mockPipeline(overrides: { listLeads?: ReturnType<typeof vi.fn> } = {}) {
  vi.doMock("@/lib/pipeline", () => ({ listLeads: overrides.listLeads ?? vi.fn(async () => []) }));
}

function mockMatters(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  vi.doMock("@/lib/matters", () => ({
    listMatters: overrides.listMatters ?? vi.fn(async () => []),
    getMatter: overrides.getMatter ?? vi.fn(async () => null),
    listMatterDeadlines: overrides.listMatterDeadlines ?? vi.fn(async () => []),
    listUpcomingDeadlines: overrides.listUpcomingDeadlines ?? vi.fn(async () => []),
    activityForMatter: overrides.activityForMatter ?? vi.fn(async () => []),
    recentActivity: overrides.recentActivity ?? vi.fn(async () => []),
    deadlineKindLabel: (kind: string) => kind.replace(/_/g, " "),
  }));
}

describe("answerMattersChatQuestion", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("looks up a matter via search_matters + get_matter_detail and returns it as a citation", async () => {
    const matters = [matter()];
    const listMatters = vi.fn(async () => matters);
    const getMatter = vi.fn(async (id: string) => matters.find((m) => m.id === id) ?? null);
    mockMatters({ listMatters, getMatter });
    mockPipeline();

    const { answerMattersChatQuestion } = await import("@/lib/agents/matters-chat");

    let call = 0;
    const fakeCall: Call = async () => {
      call += 1;
      if (call === 1) return toolCallResponse([{ toolName: "search_matters", input: { query: "AURELIA" } }]);
      if (call === 2) return toolCallResponse([{ toolName: "get_matter_detail", input: { matterId: "m-1" } }]);
      return textResponse("AURELIA (TM-2026-0031) is currently in Publication, waiting on the USPTO.");
    };

    const result = await answerMattersChatQuestion("what's the status of AURELIA", fakeCall);

    expect(listMatters).toHaveBeenCalledTimes(1);
    expect(getMatter).toHaveBeenCalledWith("m-1");
    expect(result.answer).toContain("AURELIA");
    expect(result.declined).toBe(false);
    expect(result.citations).toEqual([
      { type: "matter", id: "m-1", label: "TM-2026-0031 — AURELIA", href: "/dashboard/matters/m-1" },
    ]);
  });

  it("declines a legal-analysis question without calling any tool", async () => {
    const listMatters = vi.fn(async () => []);
    mockMatters({ listMatters });
    mockPipeline();

    const { answerMattersChatQuestion } = await import("@/lib/agents/matters-chat");

    const fakeCall: Call = async () =>
      textResponse("That's a legal judgment call — please check with the attorney of record rather than me.");

    const result = await answerMattersChatQuestion("will our opposition response win, and what should we argue?", fakeCall);

    expect(listMatters).not.toHaveBeenCalled();
    expect(result.declined).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.answer).toMatch(/attorney/i);
  });

  it("dedupes citations across multiple tool calls that touch the same matter", async () => {
    const matters = [matter()];
    const listUpcomingDeadlines = vi.fn(async () => [
      {
        id: "d-1",
        matter_id: "m-1",
        matter_number: "TM-2026-0031",
        matter_title: "AURELIA",
        kind: "office_action_response",
        title: null,
        due_date: "2026-09-01",
        status: "open",
        attorney_confirmed: false,
      },
    ]);
    mockMatters({ listMatters: vi.fn(async () => matters), listUpcomingDeadlines });
    mockPipeline();

    const { answerMattersChatQuestion } = await import("@/lib/agents/matters-chat");

    let call = 0;
    const fakeCall: Call = async () => {
      call += 1;
      if (call === 1) {
        return toolCallResponse([
          { toolName: "search_matters", input: { query: "AURELIA" } },
          { toolName: "get_upcoming_deadlines", input: {} },
        ]);
      }
      return textResponse("AURELIA has one open matter and no open deadlines.");
    };

    const result = await answerMattersChatQuestion("what's up with AURELIA", fakeCall);

    expect(result.citations.filter((c) => c.id === "m-1")).toHaveLength(1);
  });

  it("returns a static prompt for an empty question without invoking the model", async () => {
    mockMatters();
    mockPipeline();

    const { answerMattersChatQuestion } = await import("@/lib/agents/matters-chat");

    const fakeCall = vi.fn(async () => textResponse("unused"));

    const result = await answerMattersChatQuestion("   ", fakeCall);

    expect(fakeCall).not.toHaveBeenCalled();
    expect(result.citations).toEqual([]);
    expect(result.declined).toBe(false);
    expect(result.answer).toMatch(/ask a question/i);
  });

  it("searches leads and returns a lead citation", async () => {
    const leads = [lead()];
    const listLeads = vi.fn(async () => leads);
    mockMatters();
    mockPipeline({ listLeads });

    const { answerMattersChatQuestion } = await import("@/lib/agents/matters-chat");

    let call = 0;
    const fakeCall: Call = async () => {
      call += 1;
      if (call === 1) return toolCallResponse([{ toolName: "search_leads", input: { query: "Doe" } }]);
      return textResponse("Doe Studio is still an open lead, last active recently.");
    };

    const result = await answerMattersChatQuestion("is Doe Studio still a lead?", fakeCall);

    expect(listLeads).toHaveBeenCalledWith({ search: "Doe" });
    expect(result.citations).toEqual([{ type: "lead", id: "lead-1", label: "Doe Studio", href: "/dashboard/leads/lead-1" }]);
  });

  it("forces a fallback answer if the model never stops calling tools within the step budget", async () => {
    mockMatters({ listMatters: vi.fn(async () => [matter()]) });
    mockPipeline();

    const { answerMattersChatQuestion } = await import("@/lib/agents/matters-chat");

    const fakeCall: Call = async () => toolCallResponse([{ toolName: "search_matters", input: { query: "x" } }]);

    const result = await answerMattersChatQuestion("keep looking forever", fakeCall);

    expect(result.declined).toBe(false);
    expect(result.answer.length).toBeGreaterThan(0);
  });
});
