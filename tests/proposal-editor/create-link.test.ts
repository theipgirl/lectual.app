import { describe, it, expect, vi } from "vitest";
import { runCreateLink, type CreateLinkDeps } from "@/lib/proposal-editor/create-link";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import { ProposalError } from "@/lib/proposals/errors";
import { readFileSync } from "node:fs";

const row = {} as never;

function deps(over: Partial<CreateLinkDeps> = {}) {
  const calls: string[] = [];
  const d: CreateLinkDeps = {
    gate: vi.fn(async () => null),
    approve: vi.fn(async () => (calls.push("approve"), row)),
    makeLive: vi.fn(async () => (calls.push("live"), row)),
    describe: proposalActionError,
    revalidate: vi.fn((id: string) => void calls.push(`revalidate:${id}`)),
    ...over,
  };
  return { d, calls };
}

describe("createLinkAction (runCreateLink)", () => {
  it("approve ok + send ok: success, each once, approve first", async () => {
    const { d, calls } = deps();
    const r = await runCreateLink(d, "p1");
    expect(r.saved).toBe(true);
    expect(r.error).toBeUndefined();
    expect(d.approve).toHaveBeenCalledTimes(1);
    expect(d.makeLive).toHaveBeenCalledTimes(1);
    expect(calls.slice(0, 2)).toEqual(["approve", "live"]);
  });

  it("approve ok + send failing: the plain failure sentence, and the page is refreshed so it reads Saved", async () => {
    const { d, calls } = deps({ makeLive: vi.fn(async () => { throw new Error("boom: secret detail"); }) });
    const r = await runCreateLink(d, "p1");
    expect(r).toEqual({ error: "Saved, but the link couldn't be turned on. Try again." });
    expect(calls).toEqual(["approve", "revalidate:p1"]);
  });

  it("approve failing never calls send and keeps the existing sentence", async () => {
    const { d } = deps({ approve: vi.fn(async () => { throw new ProposalError("forbidden", "Only the firm's named approvers can create a client link."); }) });
    const r = await runCreateLink(d, "p1");
    expect(r.error).toBe("Only the firm's named approvers can create a client link.");
    expect(d.makeLive).not.toHaveBeenCalled();
  });

  it("an unexpected approve failure gives the fixed fallback, not the message", async () => {
    const { d } = deps({ approve: vi.fn(async () => { throw new Error("db password"); }) });
    const r = await runCreateLink(d, "p1");
    expect(r.error).toBe("Couldn't save this proposal.");
    expect(d.makeLive).not.toHaveBeenCalled();
  });

  it("a refused gate (module off, signed out, role) calls neither step", async () => {
    const { d } = deps({ gate: vi.fn(async () => ({ error: "Your role can view proposals but not change them." })) });
    const r = await runCreateLink(d, "p1");
    expect(r.error).toMatch(/can view proposals/);
    expect(d.approve).not.toHaveBeenCalled();
    expect(d.makeLive).not.toHaveBeenCalled();
  });
});

describe("the action file", () => {
  const actions = readFileSync("src/app/dashboard/proposals/[id]/actions.ts", "utf8");
  const create = readFileSync("src/lib/proposal-editor/create-link.ts", "utf8");
  it("createLinkAction goes through the gate and reaches no mail, queue or service role", () => {
    const body = actions.slice(actions.indexOf("export async function createLinkAction"), actions.indexOf("export async function unapproveAction"));
    expect(body).toContain("gate: gateStaffAction");
    for (const text of [body, create]) expect(text).not.toMatch(/resend|sendMail|mailer|internal-mail|queue|admin|service[- ]role/i);
    expect(create).not.toMatch(/^import .*(admin|mail|queue)/m);
  });
  it("sendAction is still the recovery action", () => {
    expect(actions).toContain("export async function sendAction");
  });
});
