import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  PAY_LINK_FAILED,
  PAY_LINK_NEEDS_DB_UPDATE,
  PAY_LINK_NOT_HTTPS,
  PAY_LINK_REQUIRED,
  PAY_LINK_TOO_LONG,
  PAY_LINK_UPDATED,
  describePayLinkEvent,
  parseLivePayLink,
  runChangePayLink,
  type ChangePayLinkDeps,
} from "@/lib/proposal-editor/pay-link";
import { describeProposalEvent } from "@/lib/proposal-editor/events";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import { ProposalError, friendlyProposalError } from "@/lib/proposals/errors";
import type { ProposalEventRow } from "@/lib/proposals/types";

const row = {} as never;
const T = "2026-10-19T12:00:00Z";

function deps(over: Partial<ChangePayLinkDeps> = {}) {
  const d: ChangePayLinkDeps = {
    gate: vi.fn(async () => null),
    change: vi.fn(async () => row),
    describe: proposalActionError,
    revalidate: vi.fn(),
    ...over,
  };
  return d;
}

describe("parseLivePayLink", () => {
  it("accepts an https link and trims it", () => {
    expect(parseLivePayLink("  https://app.lawmatics.com/forms/x?y=1 ")).toEqual({ ok: true, value: "https://app.lawmatics.com/forms/x?y=1" });
  });
  it.each([
    [null, PAY_LINK_REQUIRED],
    ["", PAY_LINK_REQUIRED],
    ["   ", PAY_LINK_REQUIRED],
    ["http://pay.example.com", PAY_LINK_NOT_HTTPS],
    ["HTTPS://pay.example.com", PAY_LINK_NOT_HTTPS],
    ["https://pay example.com", PAY_LINK_NOT_HTTPS],
    ["https://", PAY_LINK_NOT_HTTPS],
    ["javascript:alert(1)", PAY_LINK_NOT_HTTPS],
    [`https://pay.example.com/${"a".repeat(2000)}`, PAY_LINK_TOO_LONG],
  ])("refuses %s", (raw, error) => {
    expect(parseLivePayLink(raw)).toEqual({ ok: false, error });
  });
});

describe("changePayLinkAction (runChangePayLink)", () => {
  it("valid link: one write with the trimmed link and the rendered updated_at, then 'Pay link updated.'", async () => {
    const d = deps();
    const r = await runChangePayLink(d, { id: "p1", payUrl: " https://ok.example.com/p ", updatedAt: T });
    expect(r).toEqual({ saved: true, notice: PAY_LINK_UPDATED });
    expect(PAY_LINK_UPDATED).toBe("Pay link updated.");
    expect(d.change).toHaveBeenCalledWith("p1", "https://ok.example.com/p", T);
    expect(d.revalidate).toHaveBeenCalledWith("p1");
  });

  it("a refused gate (module off, signed out, role) writes nothing", async () => {
    const d = deps({ gate: vi.fn(async () => ({ error: "Your role can view proposals but not change them." })) });
    const r = await runChangePayLink(d, { id: "p1", payUrl: "https://ok.example.com/p", updatedAt: T });
    expect(r.error).toMatch(/can view proposals/);
    expect(d.change).not.toHaveBeenCalled();
  });

  it("a bad link is refused before any write", async () => {
    const d = deps();
    const r = await runChangePayLink(d, { id: "p1", payUrl: "http://ok.example.com/p", updatedAt: T });
    expect(r).toEqual({ error: PAY_LINK_NOT_HTTPS });
    expect(d.change).not.toHaveBeenCalled();
  });

  it("before 0100: the store's refusal reads as not switched on yet", async () => {
    const d = deps({ change: vi.fn(async () => { throw new ProposalError("unavailable", PAY_LINK_NEEDS_DB_UPDATE); }) });
    const r = await runChangePayLink(d, { id: "p1", payUrl: "https://ok.example.com/p", updatedAt: T });
    expect(r).toEqual({ error: "Changing the pay link isn't switched on for your firm yet. Lectual will turn it on." });
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("an unexpected failure gives the fixed fallback, never the message", async () => {
    const d = deps({ change: vi.fn(async () => { throw new Error("db password"); }) });
    const r = await runChangePayLink(d, { id: "p1", payUrl: "https://ok.example.com/p", updatedAt: T });
    expect(r).toEqual({ error: PAY_LINK_FAILED });
  });
});

describe("0100 refusals and the event line", () => {
  it.each([
    ["client_proposal_pay_link_frozen: the pay link of a accepted proposal is frozen", "frozen"],
    ["client_proposal_pay_link_staff_only: only a signed-in staff member", "forbidden"],
    ["client_proposal_pay_link_required: a live proposal must keep a pay link", "validation"],
  ])("%s maps by prefix, not to the generic 'already gone out'", (message, code) => {
    const e = friendlyProposalError({ code: "23514", message });
    expect(e.code).toBe(code);
    expect(e.message).not.toContain("client_proposal");
    expect(e.message).not.toContain("Start a new version");
  });

  const event = (payload: Record<string, unknown>): ProposalEventRow => ({
    id: "e", org_id: "o", proposal_id: "p", family_id: "p", type: "edited", actor: "staff", actor_user_id: "u", payload, created_at: T,
  });

  it("reads the trigger's {field, from_host, to_host} as a sentence with hosts only", () => {
    const line = describeProposalEvent(event({ field: "pay_url", from_host: "wrong.example.com", to_host: "app.lawmatics.com" }), {
      names: new Map([["u", "Taylor"]]),
    });
    expect(line.who).toBe("Taylor");
    expect(line.what).toBe("changed the live pay link from wrong.example.com to app.lawmatics.com");
  });

  it("degrades without hosts and ignores other payloads", () => {
    expect(describePayLinkEvent({ field: "pay_url" })).toBe("changed the live pay link");
    expect(describePayLinkEvent({ field: "pay_url", from_host: "a.com", to_host: "a.com" })).toBe("changed the live pay link (now a.com)");
    expect(describePayLinkEvent({ fields: ["pay_url"] })).toBeNull();
  });

  it("the control and the action import no mail, queue or service-role code", () => {
    for (const f of ["src/lib/proposal-editor/pay-link.ts", "src/components/proposal-editor/ChangePayLink.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/queue|internal-mail|db\/admin|resend/i);
    }
  });
});
