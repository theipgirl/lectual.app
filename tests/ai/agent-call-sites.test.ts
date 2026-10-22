import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall, StructuredRequest } from "@/lib/ai/claude";
import { fakeAdmin } from "../mailbox/fake-db";
import { NOW, ORG } from "../agents/helpers";
import { z } from "zod";

/**
 * A4: each agent's model call carries its own identity, so it resolves to its own tier. Every agent module
 * is replaced by a stub that makes one call through the context's `llm`; the real runner wraps that call.
 */

const stub = vi.hoisted(() => ({ run: async (ctx: { llm: StructuredCall }) => {
  await ctx.llm({ system: "s", user: "u", schema: (await import("zod")).z.object({}), effort: "low" });
  return { itemsIn: 0, draftsOut: 0, summary: "ok" };
} }));
vi.mock("@/lib/agents/email-intel", () => ({ runEmailIntel: stub.run }));
vi.mock("@/lib/agents/intake-triage", () => ({ runIntakeTriage: stub.run }));
vi.mock("@/lib/agents/post-consult", () => ({ runPostConsult: stub.run }));
vi.mock("@/lib/agents/stage-keeper/run", () => ({ runStageKeeper: async () => ({ itemsIn: 0, draftsOut: 0, summary: "ok" }) }));
vi.mock("@/lib/agents/morning-brief/run", () => ({ runMorningBrief: stub.run }));
vi.mock("@/lib/agents/consult-prep/run", () => ({ runConsultPrep: stub.run }));
vi.mock("@/lib/agents/inbox-summary/run", () => ({ runInboxSummary: stub.run }));

import { runOneAgent } from "@/lib/agents/runner";

describe("the runner names the agent on every model call", () => {
  it.each(["email-intel", "intake-triage", "post-consult", "morning-brief", "consult-prep", "inbox-summary"] as const)("%s", async (agent) => {
    const seen: Array<StructuredRequest<z.ZodType>["agent"]> = [];
    const llm = (async (req: StructuredRequest<z.ZodType>) => {
      seen.push(req.agent);
      return { output: {}, model: "m", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0 };
    }) as unknown as StructuredCall;
    const { client } = fakeAdmin((q) => (q.table === "agent_run" && q.action === "insert" ? { data: [{ id: "r" }], error: null } : undefined));
    const out = await runOneAgent(
      { admin: client as unknown as SupabaseClient, llm, createDraft: vi.fn(), now: () => NOW },
      { orgId: ORG, agent, autonomy: "draft", trigger: "manual" },
    );
    expect(out.status).toBe("ok");
    expect(seen).toEqual([agent]);
  });
});

describe("the agents' own call sites and the non-agent callers", () => {
  const has = (file: string, re: RegExp) => expect(readFileSync(file, "utf8")).toMatch(re);
  it("each agent passes its own id", () => {
    has("src/lib/agents/intake-triage.ts", /agent: "intake-triage"/);
    has("src/lib/agents/email-intel.ts", /agent: "email-intel"/);
    has("src/lib/agents/post-consult.ts", /agent: "post-consult"/);
    has("src/lib/agents/morning-brief/follow-ups.ts", /agent: "morning-brief"/);
    has("src/lib/agents/consult-prep/run.ts", /agent: "consult-prep"/);
    has("src/lib/agents/inbox-summary/reply.ts", /agent: "inbox-summary"/);
  });
  it("every askClaude caller names the staff tier", () => {
    for (const f of ["src/lib/documents/loe.ts", "src/lib/documents/opinion-letter.ts", "src/lib/documents/trademark-clearance.ts", "src/lib/intake-forms/public.ts", "src/lib/prep-consult/drafts.ts"]) {
      has(f, /askClaude\([\s\S]*?agent: "staff"/);
    }
  });
});

describe("cost is the model that answered", () => {
  it("callClaude returns response.model, priced from it", async () => {
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = "k";
    let body: Record<string, unknown> = {};
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        beta = {
          messages: {
            create: async (b: Record<string, unknown>) => {
              body = b;
              return {
                model: "claude-haiku-4-5",
                stop_reason: "end_turn",
                content: [{ type: "text", text: "{}" }],
                usage: { input_tokens: 1_000_000, output_tokens: 0 },
              };
            },
          },
        };
      },
    }));
    const { callClaude } = await import("@/lib/ai/claude");
    const res = await callClaude({ system: "s", user: "u", schema: z.object({}), effort: "low", agent: "intake-triage", maxTokens: 16_000 });
    expect(body.model).toBe("claude-haiku-4-5");
    expect((body.output_config as Record<string, unknown>).effort).toBeUndefined();
    expect(res.model).toBe("claude-haiku-4-5");
    expect(res.costUsd).toBe(1);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
