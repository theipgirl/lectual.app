import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import type { AgentContext, Autonomy } from "@/lib/agents/types";
import { fakeAdmin, filterValue, type Handler, type Recorded } from "../mailbox/fake-db";

export const ORG = "11111111-1111-1111-1111-111111111111";
export const NOW = Date.parse("2026-09-25T12:00:00Z");

/** A fake model that returns canned outputs in order and records every request. */
export function fakeLlm(...outputs: unknown[]) {
  const calls: Array<{ system: string; user: string; effort: string }> = [];
  const llm = (async (req) => {
    calls.push({ system: req.system, user: req.user, effort: req.effort });
    const output = outputs[Math.min(calls.length - 1, outputs.length - 1)];
    return { output, model: "claude-opus-5", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.01 };
  }) as StructuredCall;
  return { llm, calls };
}

export function agentCtx(handler: Handler, opts: { autonomy: Autonomy; queue?: boolean; llm: StructuredCall; fetchImpl?: typeof fetch; mailbox?: AgentContext["mailbox"] }) {
  const { client, log } = fakeAdmin(handler);
  const createDraft = vi.fn(async () => ({ id: `q-${createDraft.mock.calls.length}` }));
  const ctx: AgentContext = {
    admin: client as unknown as SupabaseClient,
    orgId: ORG,
    autonomy: opts.autonomy,
    llm: opts.llm,
    queueOrgKey: opts.queue ? "firm-queue-key" : null,
    createDraft,
    now: () => NOW,
    fetchImpl: opts.fetchImpl,
    mailbox: opts.mailbox,
  };
  return { ctx, log, createDraft };
}

/** The tenant fence: every statement names this org, whether as a filter or on the inserted rows. */
export function assertOrgFenced(log: Recorded[], orgId = ORG) {
  for (const q of log) {
    const f = filterValue(q, "org_id");
    const ok =
      f === orgId ||
      (q.action === "insert" && [q.values].flat().every((v) => (v as { org_id?: string }).org_id === orgId));
    if (!ok) throw new Error(`${q.action} ${q.table} is not fenced to the firm`);
  }
}

export const writes = (log: Recorded[], table: string, action: Recorded["action"]) =>
  log.filter((q) => q.table === table && q.action === action);
