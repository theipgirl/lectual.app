import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runIntakeTriage, type Triage } from "@/lib/agents/intake-triage";
import { runEmailIntel, type Intel } from "@/lib/agents/email-intel";
import { sealToken } from "@/lib/mailbox/crypto";
import { MERGE_AGENT_SKIPPED } from "@/lib/ui/words";
import { agentCtx, fakeLlm, ORG, writes } from "./helpers";
import type { Recorded } from "../mailbox/fake-db";

/**
 * M5 (lectual 0107): a lead merged while the model was answering. The update is live-filtered, so it matches no row
 * (what the database does for a merged lead) instead of tripping the guard: the lead is skipped and counted, the run
 * goes on, and no raw guard text reaches the run.
 */
const isLive = (q: Recorded) => q.filters.some((f) => f.op === "is" && f.column === "merged_into_id" && f.value === null);

describe("intake triage and a lead merged mid-run", () => {
  const lead = (id: string) => ({ id, first_name: "Amara", last_name: "Nwosu", business_name: null, email: `${id}@x.example`, phone: null, website: null, practice_area: "Trademark", mark_text: null, referral_source: null, referral_detail: null, qualification_score: null, temperature: null, created_at: "2026-09-24T09:00:00Z" });
  const hot: Triage = { lane: "hot", readiness: 5, value: "HIGH", urgency: "2d", practice_fit: "strong", reason: "Ready to file.", red_flags: [] };

  it("skips the merged lead, counts it, and scores the next one", async () => {
    const { llm } = fakeLlm(hot, hot);
    const { ctx, log } = agentCtx(
      (q) => {
        if (q.table === "crm_lead" && q.action === "select") return { data: [lead("gone"), lead("live")], error: null };
        if (q.table === "crm_lead" && q.action === "update") {
          const id = q.filters.find((f) => f.column === "id")?.value;
          return { data: id === "gone" ? [] : [{ id }], error: null };
        }
        return undefined;
      },
      { autonomy: "act", queue: false, llm },
    );
    const result = await runIntakeTriage(ctx);
    const updates = writes(log, "crm_lead", "update");
    expect(updates).toHaveLength(2);
    expect(log.filter((q) => q.table === "crm_lead" && q.action === "update").every(isLive)).toBe(true);
    const insights = writes(log, "crm_activity", "insert").map((w) => (w.values as { lead_id?: string }).lead_id);
    expect(insights).toEqual(["live"]);
    expect(result.summary).toContain(MERGE_AGENT_SKIPPED(1));
    expect(result.summary).not.toMatch(/lead_merge_guarded/);
  });
});

describe("email intel and a lead merged mid-run", () => {
  const root = randomBytes(32);
  const BODY = "Our company is Sankofa Brewing LLC.";
  const intel: Intel = { changes: [{ field: "business_name", value: "Sankofa Brewing LLC", evidence: "Our company is Sankofa Brewing LLC" }], summary: "Company name.", legal_question: null as unknown as string };

  it("a fill that matches no row is skipped and counted; the run does not fail", async () => {
    const { llm } = fakeLlm(intel);
    const { ctx, log } = agentCtx(
      (q) => {
        if (q.table === "crm_activity" && q.action === "select") {
          const done = q.filters.some((f) => f.column === "type" && f.value === "ai_insight");
          return done
            ? { data: [], error: null }
            : { data: [{ id: "act-1", lead_id: "lead-1", created_at: "2026-09-24T09:00:00Z", payload: { source: "mailbox-sync", message_id: "gmail:m1", connection_id: "conn-1", from: "a@x.example", subject: "Hi", at: "2026-09-24T09:00:00Z", sensitive: false } }], error: null };
        }
        if (q.table === "mailbox_connection") {
          return { data: [{ id: "conn-1", org_id: ORG, provider: "google", email: "intake@firm.example", status: "active", access_token_enc: sealToken(root, "at"), refresh_token_enc: sealToken(root, "rt"), token_expires_at: "2099-01-01T00:00:00Z", sync_cursor: null, matched_count: 0 }], error: null };
        }
        if (q.table === "crm_lead" && q.action === "select") return { data: [{ id: "lead-1", first_name: "Amara", last_name: "Nwosu", business_name: null, phone: null, website: null, mark_text: null, practice_area: null }], error: null };
        if (q.table === "crm_lead" && q.action === "update") return { data: [], error: null };
        return undefined;
      },
      {
        autonomy: "act",
        queue: false,
        llm,
        fetchImpl: (async () => new Response(JSON.stringify({ payload: { mimeType: "text/plain", body: { data: Buffer.from(BODY).toString("base64url") } } }), { status: 200 })) as typeof fetch,
      },
    );
    ctx.mailbox = { admin: ctx.admin as unknown as SupabaseClient, root, credentials: () => ({ clientId: "c", clientSecret: "s" }) };
    const result = await runEmailIntel(ctx);
    expect(log.filter((q) => q.table === "crm_lead" && q.action === "update").every(isLive)).toBe(true);
    expect(result.summary).toContain(MERGE_AGENT_SKIPPED(1));
    expect(result.summary).toContain("0 record(s) filled in");
  });
});
