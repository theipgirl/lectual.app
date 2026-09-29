import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fillOnly, runEmailIntel, type Intel } from "@/lib/agents/email-intel";
import { sealToken } from "@/lib/mailbox/crypto";
import { agentCtx, assertOrgFenced, fakeLlm, ORG, writes } from "./helpers";
import type { Recorded } from "../mailbox/fake-db";

const root = randomBytes(32);
const BODY = "Hi! Our company is Sankofa Brewing LLC, call me on 555-0100. Can we register SANKOFA in Canada too?";

function syncedEmail(id: string, extra: Record<string, unknown> = {}) {
  return {
    id: `act-${id}`,
    lead_id: "lead-1",
    created_at: "2026-09-24T09:00:00Z",
    payload: { source: "mailbox-sync", message_id: `gmail:${id}`, connection_id: "conn-1", from: "amara@example.com", subject: "Hello", at: "2026-09-24T09:00:00Z", sensitive: false, ...extra },
  };
}

function handler(opts: { emails: unknown[]; processed?: string[]; lead?: Record<string, unknown> }) {
  return (q: Recorded) => {
    if (q.table === "crm_activity" && q.action === "select") {
      const isDoneQuery = q.filters.some((f) => f.column === "type" && f.value === "ai_insight");
      return isDoneQuery
        ? { data: (opts.processed ?? []).map((m) => ({ payload: { message_id: m } })), error: null }
        : { data: opts.emails, error: null };
    }
    if (q.table === "mailbox_connection") {
      return { data: [{ id: "conn-1", org_id: ORG, provider: "google", email: "intake@firm.example", status: "active", access_token_enc: sealToken(root, "at"), refresh_token_enc: sealToken(root, "rt"), token_expires_at: "2099-01-01T00:00:00Z", sync_cursor: null, matched_count: 0 }], error: null };
    }
    if (q.table === "crm_lead" && q.action === "select") {
      return { data: [{ id: "lead-1", first_name: "Amara", last_name: "Nwosu", business_name: null, phone: "555-9999", website: null, mark_text: null, practice_area: null, ...opts.lead }], error: null };
    }
    return undefined;
  };
}

const gmailBody = (async () =>
  new Response(JSON.stringify({ payload: { mimeType: "text/plain", body: { data: Buffer.from(BODY).toString("base64url") } } }), { status: 200 })) as typeof fetch;

const intel: Intel = {
  changes: [
    { field: "business_name", value: "Sankofa Brewing LLC", evidence: "Our company is Sankofa Brewing LLC" },
    { field: "phone", value: "555-0100", evidence: "call me on 555-0100" },
  ],
  summary: "Client introduced their company and asked about Canada.",
  legal_question: "Can SANKOFA be registered in Canada as well?",
};

const mailboxDeps = (log: unknown) => ({ admin: log as SupabaseClient, root, credentials: () => ({ clientId: "c", clientSecret: "s" }) });

describe("email → client intel", () => {
  it("fillOnly never overwrites a value a person entered", () => {
    expect(fillOnly({ business_name: null, phone: "555-9999" }, intel.changes)).toEqual({ business_name: "Sankofa Brewing LLC" });
  });

  it("act: fills only empty fields, stores the proposal but not the email, and briefs the attorney on the legal question", async () => {
    const { llm, calls } = fakeLlm(intel);
    const h = handler({ emails: [syncedEmail("m1")] });
    const { ctx, log, createDraft } = agentCtx(h, { autonomy: "act", queue: true, llm, fetchImpl: gmailBody });
    ctx.mailbox = mailboxDeps(ctx.admin);
    const result = await runEmailIntel(ctx);

    expect(result).toMatchObject({ itemsIn: 1, draftsOut: 1 });
    expect(calls[0].user).toContain("Sankofa Brewing LLC"); // the model saw the body...
    const all = JSON.stringify(log);
    expect(all).not.toContain("Can we register SANKOFA in Canada too"); // ...the database never did
    expect(writes(log, "crm_lead", "update")[0].values).toEqual({ business_name: "Sankofa Brewing LLC" });
    expect(writes(log, "crm_activity", "insert")[0].values).toMatchObject({
      type: "ai_insight",
      payload: expect.objectContaining({ source: "email-intel", message_id: "gmail:m1", applied: ["business_name"] }),
    });
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ type: "BRIEFING", draftBody: expect.stringContaining("Lectual has not replied") }));
    // Every statement except the connection's own token refresh is fenced to the firm.
    assertOrgFenced(log);
  });

  it("draft: proposes but writes nothing to the lead", async () => {
    const { llm } = fakeLlm(intel);
    const { ctx, log } = agentCtx(handler({ emails: [syncedEmail("m1")] }), { autonomy: "draft", queue: false, llm, fetchImpl: gmailBody });
    ctx.mailbox = mailboxDeps(ctx.admin);
    await runEmailIntel(ctx);
    expect(writes(log, "crm_lead", "update")).toHaveLength(0);
  });

  it("skips sensitive mail and mail it has already read", async () => {
    const { llm, calls } = fakeLlm(intel);
    const emails = [syncedEmail("secret", { sensitive: true }), syncedEmail("old")];
    const { ctx } = agentCtx(handler({ emails, processed: ["gmail:old"] }), { autonomy: "act", queue: true, llm, fetchImpl: gmailBody });
    ctx.mailbox = mailboxDeps(ctx.admin);
    const result = await runEmailIntel(ctx);
    expect(result.itemsIn).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
