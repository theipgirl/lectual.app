import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { runPostConsult, type FollowUp } from "@/lib/agents/post-consult";
import { agentCtx, fakeLlm } from "../agents/helpers";
import type { Recorded } from "../mailbox/fake-db";

/** Which callers hand the queue the sign-off, so createDraft can hold a client email to it (H6). */

const draft: FollowUp = {
  subject: "Great speaking today",
  body: "Hi Amara,\n\nThank you for your time.\n\nBest,\nDawn",
  internal_summary: "Discussed SANKOFA.",
  consult_details: { marks: [], recommended_package: null, discount_discussed: null },
};

function handler(signature: string | null) {
  return (q: Recorded) => {
    if (q.table === "crm_consult_note") {
      return { data: [{ id: "note-1", lead_id: "lead-1", created_at: "2026-09-24T09:00:00Z", notes: { summary: "Wants to file SANKOFA." } }], error: null };
    }
    if (q.table === "crm_activity" && q.action === "select") return { data: [], error: null };
    if (q.table === "crm_lead") {
      return { data: [{ id: "lead-1", first_name: "Amara", last_name: "Nwosu", business_name: null, email: "amara@example.com" }], error: null };
    }
    if (q.table === "crm_org_profile") return { data: [{ email_signature: signature }], error: null };
    return undefined;
  };
}

describe("callers pass the sign-off (H6)", () => {
  it("post-consult passes the profile's email_signature as signOff", async () => {
    const { llm } = fakeLlm(draft);
    const { ctx, createDraft } = agentCtx(handler("  Rebecca P. Beliard, Esq.  "), { autonomy: "draft", queue: true, llm });
    await runPostConsult(ctx);
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ type: "CLIENT_EMAIL", signOff: "Rebecca P. Beliard, Esq." }));
  });

  it("post-consult passes null when the firm has no signature, so createDraft flags rather than guesses", async () => {
    const { llm } = fakeLlm(draft);
    const { ctx, createDraft } = agentCtx(handler(null), { autonomy: "draft", queue: true, llm });
    await runPostConsult(ctx);
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ signOff: null }));
  });

  it("the meetings follow-up passes the same profile signature", () => {
    const src = readFileSync("src/app/dashboard/meetings/actions.ts", "utf8");
    const call = src.slice(src.indexOf("await createDraft({"), src.indexOf("});", src.indexOf("await createDraft({")));
    expect(src).toContain('.select("email_signature")');
    expect(call).toMatch(/\bsignOff,/);
  });

  it("the consult-proposal run passes its team sign-off", () => {
    const src = readFileSync("src/lib/consult-proposal/run.ts", "utf8");
    const call = src.slice(src.indexOf("await input.createDraft({"), src.indexOf("}));", src.indexOf("await input.createDraft({")));
    expect(call).toMatch(/\bteamSignOff,/);
    expect(call).not.toMatch(/\bsignOff,/);
  });
});

describe("no new send path (H6, Q5)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const f = path.join(dir, n);
      return statSync(f).isDirectory() ? files(f) : [f];
    });

  it("the hygiene and audit code never sends or resolves anything", () => {
    for (const f of ["src/lib/queue/hygiene.ts", "src/lib/queue/audit-context.ts", "src/lib/agents/readiness.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/resolveQueueItem|sendProposal|sendMail|draftInMyMailbox|createReply/);
    }
  });

  it("resolveQueueItem is called from the review action only", () => {
    const callers = files("src")
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /\bresolveQueueItem\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.replaceAll("\\", "/"));
    expect(callers.sort()).toEqual(["src/app/dashboard/queue/actions.ts", "src/lib/queue/api.ts"].sort());
  });
});
