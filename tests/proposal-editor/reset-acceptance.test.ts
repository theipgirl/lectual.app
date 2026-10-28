import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({
  createLinkAction: vi.fn(),
  queuePostConsultEmailAction: vi.fn(),
  resetAcceptanceAction: vi.fn(),
  reviseAction: vi.fn(),
  sendAction: vi.fn(),
  unapproveAction: vi.fn(),
  withdrawAction: vi.fn(),
}));

import {
  RESET_CONFIRM,
  RESET_DONE,
  RESET_FAILED,
  RESET_NEEDS_DB_UPDATE,
  RESET_NOT_ALLOWED,
  RESET_PAID,
  RESET_PAID_UNREADABLE,
  RESET_WITH_EDIT,
  canResetAcceptance,
  describeResetEvent,
  mayResetAcceptance,
  runResetAcceptance,
  type ResetAcceptanceDeps,
} from "@/lib/proposal-editor/reset-acceptance";
import { describeProposalEvent, formatDollars } from "@/lib/proposal-editor/events";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import { ProposalError, friendlyProposalError } from "@/lib/proposals/errors";
import { lastActivityLine } from "@/lib/proposals/list-labels";
import { Lifecycle } from "@/components/proposal-editor/Lifecycle";
import { ROLES, type Role } from "@/lib/auth/roles";
import type { ProposalEventRow } from "@/lib/proposals/types";

const T = "2026-10-28T12:00:00Z";
const row = {} as never;

function deps(over: Partial<ResetAcceptanceDeps> = {}) {
  const calls: string[] = [];
  const d: ResetAcceptanceDeps = {
    gate: vi.fn(async () => (calls.push("gate"), null)),
    authorize: vi.fn(async () => (calls.push("authorize"), { role: "owner" as Role, isApprover: false })),
    paid: vi.fn(async () => (calls.push("paid"), "not_paid" as const)),
    reset: vi.fn(async () => (calls.push("reset"), row)),
    describe: proposalActionError,
    revalidate: vi.fn(),
    ...over,
  };
  return { d, calls };
}

describe("the confirm sentence", () => {
  it("is the spec's wording, word for word", () => {
    expect(RESET_CONFIRM).toBe(
      "Reset this acceptance? The client link opens again and they can accept again. The Lawmatics note and alerts already sent stay as they are.",
    );
    expect(RESET_PAID).toBe("Undo Mark paid first.");
    expect(RESET_NEEDS_DB_UPDATE).toBe("Resetting an acceptance isn't switched on for your firm yet. Lectual will turn it on.");
  });
});

describe("who may reset (mirrors 0101)", () => {
  it("the admin tier, or a named approver in any role; nobody else", () => {
    for (const role of ROLES) {
      const admin = role === "owner" || role === "admin" || role === "senior_admin";
      expect(mayResetAcceptance(role, false), role).toBe(admin);
      expect(mayResetAcceptance(role, true), role).toBe(true);
    }
    expect(mayResetAcceptance(null, false)).toBe(false);
  });

  it("the page offers it only on an accepted, not-paid version whose paid state was read", () => {
    const notPaid = { state: "not_paid" as const, undoneAt: null };
    const paid = { state: "paid" as const, by: "u1", at: T };
    expect(canResetAcceptance({ status: "accepted", role: "owner", isApprover: false, paid: notPaid })).toBe(true);
    expect(canResetAcceptance({ status: "accepted", role: "attorney", isApprover: true, paid: notPaid })).toBe(true);
    expect(canResetAcceptance({ status: "accepted", role: "attorney", isApprover: false, paid: notPaid })).toBe(false);
    expect(canResetAcceptance({ status: "accepted", role: "owner", isApprover: false, paid })).toBe(false);
    expect(canResetAcceptance({ status: "accepted", role: "owner", isApprover: false, paid: null })).toBe(false);
    for (const status of ["draft", "approved", "sent", "superseded", "withdrawn"] as const) {
      expect(canResetAcceptance({ status, role: "owner", isApprover: true, paid: notPaid }), status).toBe(false);
    }
  });
});

describe("resetAcceptanceAction (runResetAcceptance)", () => {
  it("gate, then role/approver, then paid, then one write with the rendered updated_at", async () => {
    const { d, calls } = deps();
    const r = await runResetAcceptance(d, { id: "p1", updatedAt: T });
    expect(r).toEqual({ saved: true, notice: RESET_DONE });
    expect(calls).toEqual(["gate", "authorize", "paid", "reset"]);
    expect(d.reset).toHaveBeenCalledWith("p1", T);
    expect(d.revalidate).toHaveBeenCalledWith("p1");
  });

  it("a refused gate is returned as is and nothing else runs", async () => {
    const { d, calls } = deps({ gate: vi.fn(async () => ({ error: "Your role can view proposals but not change them." })) });
    expect(await runResetAcceptance(d, { id: "p1", updatedAt: T })).toEqual({ error: "Your role can view proposals but not change them." });
    expect(calls).toEqual([]);
  });

  it.each([
    ["an attorney who is not a named approver", { role: "attorney" as Role, isApprover: false }],
    ["a paralegal who is not a named approver", { role: "paralegal" as Role, isApprover: false }],
    ["an unreadable role", { role: null, isApprover: false }],
  ])("refuses %s before reading anything else", async (_label, who) => {
    const { d } = deps({ authorize: vi.fn(async () => who) });
    expect(await runResetAcceptance(d, { id: "p1", updatedAt: T })).toEqual({ error: RESET_NOT_ALLOWED });
    expect(d.paid).not.toHaveBeenCalled();
    expect(d.reset).not.toHaveBeenCalled();
  });

  it("a failed role read refuses", async () => {
    const { d } = deps({ authorize: vi.fn(async () => Promise.reject(new Error("db down"))) });
    expect(await runResetAcceptance(d, { id: "p1", updatedAt: T })).toEqual({ error: RESET_NOT_ALLOWED });
    expect(d.reset).not.toHaveBeenCalled();
  });

  it("a named approver who is an attorney may reset", async () => {
    const { d } = deps({ authorize: vi.fn(async () => ({ role: "attorney" as Role, isApprover: true })) });
    expect(await runResetAcceptance(d, { id: "p1", updatedAt: T })).toEqual({ saved: true, notice: RESET_DONE });
  });

  it("marked paid: 'Undo Mark paid first.' and no write", async () => {
    const { d } = deps({ paid: vi.fn(async () => "paid" as const) });
    expect(await runResetAcceptance(d, { id: "p1", updatedAt: T })).toEqual({ error: RESET_PAID });
    expect(d.reset).not.toHaveBeenCalled();
  });

  it("paid status unreadable (or throwing): refused, never treated as not paid", async () => {
    for (const paid of [vi.fn(async () => "unavailable" as const), vi.fn(async () => Promise.reject(new Error("x")))]) {
      const { d } = deps({ paid });
      expect(await runResetAcceptance(d, { id: "p1", updatedAt: T })).toEqual({ error: RESET_PAID_UNREADABLE });
      expect(d.reset).not.toHaveBeenCalled();
    }
  });

  it("a store refusal is its fixed sentence; an unexpected throw never shows its text", async () => {
    const refused = deps({ reset: vi.fn(async () => Promise.reject(new ProposalError("unavailable", RESET_NEEDS_DB_UPDATE))) });
    expect(await runResetAcceptance(refused.d, { id: "p1", updatedAt: T })).toEqual({ error: RESET_NEEDS_DB_UPDATE });
    const boom = deps({ reset: vi.fn(async () => Promise.reject(new Error("secret internals for sevetri@example.com"))) });
    expect(await runResetAcceptance(boom.d, { id: "p1", updatedAt: T })).toEqual({ error: RESET_FAILED });
    expect(boom.d.revalidate).not.toHaveBeenCalled();
  });
});

describe("0101 refusal prefixes", () => {
  it.each([
    ["client_proposal_reset_not_allowed: only the owner…", "42501", "forbidden", RESET_NOT_ALLOWED],
    ["client_proposal_reset_paid: this proposal is marked paid…", "23514", "conflict", RESET_PAID],
    ["client_proposal_reset_with_edit: reset an acceptance on its own…", "23514", "conflict", RESET_WITH_EDIT],
  ])("%s", (message, code, kind, text) => {
    const err = friendlyProposalError({ code, message });
    expect(err.code).toBe(kind);
    expect(err.message).toBe(text);
  });
});

describe("history and the list", () => {
  const names = new Map([["u-taylor", "Taylor"]]);
  const event = (payload: Record<string, unknown>): ProposalEventRow => ({
    id: "e1",
    org_id: "o",
    proposal_id: "p1",
    family_id: "p1",
    type: "reset",
    actor: "staff",
    actor_user_id: "u-taylor",
    payload,
    created_at: T,
  });

  it("reads 'Acceptance reset by <name>' and keeps the earlier legal fee in the details", () => {
    const line = describeProposalEvent(
      event({ from: "accepted", to: "sent", version: 1, previous_accepted_at: T, previous_snapshot: { quote: { legal_total_cents: 495000, gov_total_cents: 35000 } } }),
      { names },
    );
    expect(line.text).toBe("Acceptance reset by Taylor");
    expect(line.who).toBe("Taylor");
    expect(line.details).toEqual([
      "The client link is live again, and the client can accept again.",
      "The earlier acceptance (legal fee $4,950) is kept in this record.",
    ]);
  });

  it("a payload with no readable snapshot still reads as a reset, never an exception", () => {
    expect(describeResetEvent({}, "A teammate", formatDollars).text).toBe("Acceptance reset by A teammate");
    expect(describeResetEvent({ previous_snapshot: "x" }, "Taylor", formatDollars).details[1]).toBe("The earlier acceptance is kept in this record.");
  });

  it("the list's Last activity names a reset", () => {
    const line = lastActivityLine({
      key: "sent",
      source: "manual",
      updatedAt: T,
      acceptedAt: null,
      offeredCount: 1,
      blockingIssue: null,
      event: { type: "reset", actor: "staff", actor_user_id: "u-taylor", created_at: T },
      names,
      now: Date.parse(T) + 3_600_000,
    });
    expect(line).toBe("Acceptance reset 1h ago · Taylor");
  });
});

describe("Lifecycle: Reset acceptance in More", () => {
  const render = (over: Partial<Parameters<typeof Lifecycle>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(Lifecycle, {
        proposalId: "p1",
        status: "accepted",
        version: 1,
        canWrite: true,
        isApprover: false,
        blockingErrors: 0,
        approverNames: ["Rebecca"],
        clientUrl: "https://proposals.example.com/p/tok/",
        updatedAt: T,
        ...over,
      }),
    );

  it("an accepted version shows More only when the page allows a reset", () => {
    expect(render({ canReset: true })).toContain(">More<");
    expect(render({ canReset: false })).not.toContain(">More<");
    expect(render({ canReset: true, canWrite: false })).not.toContain(">More<");
  });

  it("the confirm is not drawn until asked for, and Withdraw is never offered on an accepted version", () => {
    const html = render({ canReset: true });
    expect(html).not.toContain(RESET_CONFIRM);
    expect(html).not.toContain("Withdraw");
  });
});
