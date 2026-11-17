import { describe, expect, it, vi } from "vitest";
import { afterYesSentence, cleanReason, runLeadStepEdit, runLeadStepNotThis, runLeadStepYes, type LeadStepActionDeps } from "@/lib/lead-step/actions-core";
import type { QueueItem } from "@/lib/queue/api";
import type { ReviewOutcome } from "@/lib/queue/review-core";
import { DONE_NOTE } from "@/lib/ui/words";
import * as W from "@/lib/ui/words";
import type { Role } from "@/lib/auth/roles";
import { LEAD, MERGED, ME, RAYN } from "./fixtures";

const ITEM = "q-1";

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: ITEM,
    org_id: "org-key",
    matter_id: null,
    agent: "morning-brief",
    type: "CLIENT_EMAIL",
    headline: "Follow-up for a stalled lead: Maya Okafor",
    summary: null,
    draft_body: "Hi Maya, checking in on your proposal.",
    final_body: null,
    status: "pending",
    created_at: "2026-11-17T13:00:00.000Z",
    client_name: "Maya Okafor",
    recipient: "maya@brightline.example",
    subject: "Your proposal",
    proposed_send_at: null,
    attachments: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    ...over,
  };
}

const resolved = (over: Partial<Extract<ReviewOutcome, { kind: "resolved" }>> = {}): ReviewOutcome => ({ kind: "resolved", intent: "approve", send: "mailbox-microsoft", webLink: "https://outlook.example/d/1", draftId: "d-1", provider: "microsoft", ...over });

function deps(over: Partial<LeadStepActionDeps> = {}, role: Role = "attorney", stored: QueueItem = item()) {
  const d = {
    staffPreview: vi.fn(async () => null),
    caller: vi.fn(async () => ({ userId: ME, role })),
    readItem: vi.fn(async () => stored),
    leadIdsOf: vi.fn(async () => [LEAD]),
    leadSet: vi.fn(async () => [LEAD, MERGED]),
    routing: vi.fn(async () => ({ status: "ok" as const, routing: {}, members: [] })),
    closerLook: vi.fn(async () => [] as never[]),
    review: vi.fn(async (): Promise<ReviewOutcome> => resolved()),
    revalidate: vi.fn(),
    ...over,
  };
  return d;
}

describe("Yes", () => {
  it("goes through the existing approve core, with a receipt, and never passes the stale confirm", async () => {
    const d = deps();
    const r = await runLeadStepYes(d, LEAD, ITEM);
    expect(r).toEqual({ ok: true, message: W.leadStepDraftInMailbox(null, "Outlook"), webLink: "https://outlook.example/d/1" });
    expect(d.review).toHaveBeenCalledWith({ id: ITEM, intent: "approve", withReceipt: true });
    expect(d.revalidate).toHaveBeenCalledWith(LEAD);
  });

  it("a role that can't act is refused before any read", async () => {
    for (const caller of [null, { userId: ME, role: "viewer" as Role }, { userId: ME, role: "social_media" as Role }]) {
      const d = deps({ caller: vi.fn(async () => caller) });
      expect(await runLeadStepYes(d, LEAD, ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_NO_APPROVE });
      expect(d.readItem).not.toHaveBeenCalled();
      expect(d.leadIdsOf).not.toHaveBeenCalled();
      expect(d.review).not.toHaveBeenCalled();
    }
  });

  it("Lectual staff viewing as the firm are refused before anything else", async () => {
    const d = deps({ staffPreview: vi.fn(async () => W.DECK_PREVIEW_ONLY) });
    expect(await runLeadStepYes(d, LEAD, ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_PREVIEW_ONLY });
    expect(d.caller).not.toHaveBeenCalled();
    expect(d.readItem).not.toHaveBeenCalled();
    expect(d.review).not.toHaveBeenCalled();
  });

  it("attorney-only for a non-approver: refused by the routing rule, the core is never called", async () => {
    const d = deps({}, "law_clerk", item({ agent: "post-consult", headline: "Post-consult email" }));
    expect(await runLeadStepYes(d, LEAD, ITEM)).toEqual({ ok: false, error: "Only an attorney can approve this kind of message." });
    expect(d.review).not.toHaveBeenCalled();
    // The same for a routine kind whose text reads as legal advice, even routed to the clerk.
    const routed = deps(
      { routing: vi.fn(async () => ({ status: "ok" as const, routing: { stalled_followup: ME }, members: [{ userId: ME, role: "law_clerk" as Role }] })) },
      "law_clerk",
      item({ final_body: "Your mark will be registered." }),
    );
    expect(await runLeadStepYes(routed, LEAD, ITEM)).toEqual({ ok: false, error: "Only an attorney can approve this kind of message." });
    expect(routed.review).not.toHaveBeenCalled();
  });

  it("routed to someone else: their sentence", async () => {
    const d = deps({ routing: vi.fn(async () => ({ status: "ok" as const, routing: { stalled_followup: RAYN }, members: [{ userId: RAYN, role: "law_clerk" as Role, displayName: "Rayn" }] })) }, "paralegal");
    expect(await runLeadStepYes(d, LEAD, ITEM)).toEqual({ ok: false, error: "This one is for Rayn. Ask them to approve it, or an owner or admin." });
  });

  it("a stale draft or a refused linked proposal: refused here, the core is never called", async () => {
    for (const reasons of [["stale"], ["linked-proposal"], ["check-first"], ["draft-issue"]] as const) {
      const d = deps({ closerLook: vi.fn(async () => [...reasons]) });
      expect(await runLeadStepYes(d, LEAD, ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_CLOSER_LOOK });
      expect(d.review).not.toHaveBeenCalled();
    }
    const unchecked = deps({ closerLook: vi.fn(async () => null) });
    expect(await runLeadStepYes(unchecked, LEAD, ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_CANT_CHECK });
    expect(unchecked.review).not.toHaveBeenCalled();
  });

  it("the core's own refusal (it checks everything again) is shown as it is, and nothing is revalidated", async () => {
    const d = deps({ review: vi.fn(async (): Promise<ReviewOutcome> => ({ kind: "error", error: "Couldn't check the proposal linked to this email. Nothing was approved. Try again shortly." })) });
    expect(await runLeadStepYes(d, LEAD, ITEM)).toEqual({ ok: false, error: "Couldn't check the proposal linked to this email. Nothing was approved. Try again shortly." });
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("a draft that is no longer on this lead, already decided, or unreadable is refused", async () => {
    expect(await runLeadStepYes(deps({ leadIdsOf: vi.fn(async () => ["99999999-9999-4999-8999-999999999999"]) }), LEAD, ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_NOT_ON_LEAD });
    expect(await runLeadStepYes(deps({ leadIdsOf: vi.fn(async () => null) }), LEAD, ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
    expect(await runLeadStepYes(deps({}, "attorney", item({ status: "approved" })), LEAD, ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_ALREADY_DECIDED });
    expect(await runLeadStepYes(deps({ readItem: vi.fn(async () => null) }), LEAD, ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
  });

  it("a draft filed on a lead merged into this one counts as this lead's", async () => {
    const d = deps({ leadIdsOf: vi.fn(async () => [MERGED]) });
    expect((await runLeadStepYes(d, LEAD, ITEM)).ok).toBe(true);
  });

  it("bad ids are refused without a call", async () => {
    const d = deps();
    expect(await runLeadStepYes(d, "not-a-uuid", ITEM)).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
    expect(await runLeadStepYes(d, LEAD, "../x")).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
    expect(d.caller).not.toHaveBeenCalled();
  });
});

describe("the after-Yes sentence comes from the approve core's own result", () => {
  it("names the mailbox the core reports, never assumes Outlook", () => {
    expect(afterYesSentence(resolved() as never)).toBe(W.leadStepDraftInMailbox(null, "Outlook"));
    expect(afterYesSentence(resolved({ send: "mailbox-google", provider: "google" }) as never)).toBe(W.leadStepDraftInMailbox(null, "Gmail"));
    expect(afterYesSentence(resolved({ send: "mailbox-microsoft", provider: "microsoft" }) as never, "Rayn")).toBe("Approved. The draft is in Rayn's Outlook. Nothing is sent until Rayn presses Send.");
    expect(afterYesSentence(resolved({ send: "drafted", provider: null, webLink: null }) as never)).toBe(W.LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX);
    expect(afterYesSentence(resolved({ send: "none", provider: null }) as never)).toBe(W.LEAD_STEP_APPROVED_NO_DRAFT);
    expect(afterYesSentence(resolved({ send: null, provider: null }) as never)).toBe(W.LEAD_STEP_APPROVED_NO_DRAFT);
    expect(afterYesSentence(resolved({ send: "mailbox-failed", provider: null }) as never)).toBe(W.LEAD_STEP_APPROVED_DRAFT_FAILED);
    expect(afterYesSentence(resolved({ send: "manual", provider: null }) as never)).toBe(W.LEAD_STEP_APPROVED_MANUAL);
    for (const s of [W.LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX, W.LEAD_STEP_APPROVED_NO_DRAFT, W.LEAD_STEP_APPROVED_DRAFT_FAILED, W.LEAD_STEP_APPROVED_MANUAL]) expect(s).not.toMatch(/Outlook/);
  });

  it("the action returns that sentence", async () => {
    const d = deps({ review: vi.fn(async () => resolved({ send: "none", provider: null, webLink: null })) });
    expect(await runLeadStepYes(d, LEAD, ITEM)).toEqual({ ok: true, message: W.LEAD_STEP_APPROVED_NO_DRAFT, webLink: null });
  });
});

describe("Not this", () => {
  it("needs a short reason (1 to 200 characters, cleaned) before anything is read", async () => {
    for (const reason of ["", "   ", undefined, 42, "x".repeat(201)]) {
      const d = deps();
      expect(await runLeadStepNotThis(d, LEAD, ITEM, reason)).toEqual({ ok: false, error: W.LEAD_STEP_REASON_NEEDED });
      expect(d.caller).not.toHaveBeenCalled();
      expect(d.review).not.toHaveBeenCalled();
    }
    expect(cleanReason("  already\tbooked\n by phone ")).toBe("already booked by phone");
    expect(cleanReason("x".repeat(200))).toHaveLength(200);
  });

  it("the Done marker is not a reason", async () => {
    expect(await runLeadStepNotThis(deps(), LEAD, ITEM, DONE_NOTE)).toEqual({ ok: false, error: W.REJECT_NOTE_IS_DONE_MARKER });
  });

  it("rejects through the existing core with the reason as the note; nothing sends", async () => {
    const d = deps({ review: vi.fn(async (): Promise<ReviewOutcome> => ({ kind: "resolved", intent: "reject", send: null, webLink: null, draftId: null, provider: null })) });
    expect(await runLeadStepNotThis(d, LEAD, ITEM, " already booked by phone ")).toEqual({ ok: true, message: W.LEAD_STEP_DROPPED });
    expect(d.review).toHaveBeenCalledWith({ id: ITEM, intent: "reject", note: "already booked by phone" });
  });

  it("the same routing rule as Yes: a non-approver can't drop an attorney-only draft", async () => {
    const d = deps({}, "intake", item({ type: "ENGAGEMENT_LETTER", headline: "LOE" }));
    expect(await runLeadStepNotThis(d, LEAD, ITEM, "wrong client")).toEqual({ ok: false, error: "Only an attorney can approve this kind of message." });
    expect(d.review).not.toHaveBeenCalled();
  });

  it("a viewer is refused before any read", async () => {
    const d = deps({ caller: vi.fn(async () => ({ userId: ME, role: "viewer" as Role })) });
    expect(await runLeadStepNotThis(d, LEAD, ITEM, "no")).toEqual({ ok: false, error: W.LEAD_STEP_NO_APPROVE });
    expect(d.readItem).not.toHaveBeenCalled();
  });
});

describe("Edit", () => {
  it("saves through the queue's save path and recomputes who may say yes", async () => {
    let stored = item();
    const d = deps(
      {
        readItem: vi.fn(async () => stored),
        review: vi.fn(async (input): Promise<ReviewOutcome> => {
          stored = { ...stored, final_body: input.body ?? null };
          return { kind: "saved" };
        }),
        routing: vi.fn(async () => ({ status: "ok" as const, routing: { stalled_followup: ME }, members: [{ userId: ME, role: "law_clerk" as Role }] })),
      },
      "law_clerk",
    );
    const plain = await runLeadStepEdit(d, LEAD, ITEM, "Hi Maya,\nJust checking in.");
    expect(plain).toEqual({ ok: true, message: W.LEAD_STEP_EDIT_SAVED, attorneyOnly: false, canYes: true });
    expect(d.review).toHaveBeenCalledWith({ id: ITEM, intent: "save", body: "Hi Maya,\nJust checking in." });
    // An edit that adds advice text makes the item attorney-only and removes Yes for the clerk.
    const advice = await runLeadStepEdit(d, LEAD, ITEM, "Hi Maya, your mark is likely to be registered.");
    expect(advice).toEqual({ ok: true, message: W.LEAD_STEP_EDIT_SAVED, attorneyOnly: true, canYes: false });
  });

  it("an empty edit is refused before any read; a viewer is refused before any read", async () => {
    const d = deps();
    expect(await runLeadStepEdit(d, LEAD, ITEM, "   ")).toEqual({ ok: false, error: W.LEAD_STEP_EDIT_EMPTY });
    expect(d.caller).not.toHaveBeenCalled();
    const v = deps({ caller: vi.fn(async () => ({ userId: ME, role: "viewer" as Role })) });
    expect(await runLeadStepEdit(v, LEAD, ITEM, "Hi")).toEqual({ ok: false, error: W.LEAD_STEP_NO_EDIT });
    expect(v.readItem).not.toHaveBeenCalled();
  });
});
