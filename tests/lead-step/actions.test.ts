import { describe, expect, it, vi } from "vitest";
import { afterYesSentence, cleanReason, runLeadStepEdit, runLeadStepNotThis, runLeadStepSendBack, runLeadStepYes, type LeadStepActionDeps } from "@/lib/lead-step/actions-core";
import type { QueueItem } from "@/lib/queue/api";
import type { ReviewOutcome } from "@/lib/queue/review-core";
import { DONE_NOTE } from "@/lib/ui/words";
import * as W from "@/lib/ui/words";
import type { Role } from "@/lib/auth/roles";
import type { LeadCloserLook } from "@/lib/lead-step/closer-look";
import type { HandoffFact } from "@/lib/lead-step/facts";
import { LEAD, MERGED, ME, RAYN } from "./fixtures";

const ITEM = "q-1";
/** sha256 hex of the body the card drew (any well-formed value: the core does the compare). */
const SHA = "b".repeat(64);

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
    closerLook: vi.fn(async (): Promise<LeadCloserLook | null> => ({ reasons: [], linkNotLive: false })),
    handoff: vi.fn(async (): Promise<HandoffFact> => ({ status: "unknown" })),
    sendBack: vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
    review: vi.fn(async (): Promise<ReviewOutcome> => resolved()),
    revalidate: vi.fn(),
    ...over,
  };
  return d;
}

describe("Yes", () => {
  it("goes through the existing approve core, with a receipt, and never passes the stale confirm", async () => {
    const d = deps();
    const r = await runLeadStepYes(d, LEAD, ITEM, SHA);
    expect(r).toEqual({ ok: true, message: W.leadStepDraftInMailbox(null, "Outlook"), webLink: "https://outlook.example/d/1", warn: false });
    expect(d.review).toHaveBeenCalledWith({ id: ITEM, intent: "approve", withReceipt: true, requireShown: true, shownSha256: SHA });
    expect(d.revalidate).toHaveBeenCalledWith(LEAD);
  });

  it("Yes without the hash of the text shown is refused and approves nothing", async () => {
    for (const bad of [undefined, null, "", "xyz", "B".repeat(64)]) {
      const d = deps();
      expect(await runLeadStepYes(d, LEAD, ITEM, bad)).toEqual({ ok: false, error: W.DRAFT_CHANGED_REFRESH });
      expect(d.review).not.toHaveBeenCalled();
    }
  });

  it("a changed draft: the core's refusal comes back as it is, and nothing is revalidated as approved", async () => {
    const d = deps({ review: vi.fn(async (): Promise<ReviewOutcome> => ({ kind: "error", error: W.DRAFT_CHANGED_REFRESH })) });
    expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.DRAFT_CHANGED_REFRESH });
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("a role that can't act is refused before any read", async () => {
    for (const caller of [null, { userId: ME, role: "viewer" as Role }, { userId: ME, role: "social_media" as Role }]) {
      const d = deps({ caller: vi.fn(async () => caller) });
      expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_NO_APPROVE });
      expect(d.readItem).not.toHaveBeenCalled();
      expect(d.leadIdsOf).not.toHaveBeenCalled();
      expect(d.review).not.toHaveBeenCalled();
    }
  });

  it("Lectual staff viewing as the firm are refused before anything else", async () => {
    const d = deps({ staffPreview: vi.fn(async () => W.DECK_PREVIEW_ONLY) });
    expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_PREVIEW_ONLY });
    expect(d.caller).not.toHaveBeenCalled();
    expect(d.readItem).not.toHaveBeenCalled();
    expect(d.review).not.toHaveBeenCalled();
  });

  it("attorney-only for a non-approver: refused by the routing rule, the core is never called", async () => {
    const d = deps({}, "law_clerk", item({ agent: "post-consult", headline: "Post-consult email" }));
    expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: "Only an attorney can approve this kind of message." });
    expect(d.review).not.toHaveBeenCalled();
    // The same for a routine kind whose text reads as legal advice, even routed to the clerk.
    const routed = deps(
      { routing: vi.fn(async () => ({ status: "ok" as const, routing: { stalled_followup: ME }, members: [{ userId: ME, role: "law_clerk" as Role }] })) },
      "law_clerk",
      item({ final_body: "Your mark will be registered." }),
    );
    expect(await runLeadStepYes(routed, LEAD, ITEM, SHA)).toEqual({ ok: false, error: "Only an attorney can approve this kind of message." });
    expect(routed.review).not.toHaveBeenCalled();
  });

  it("routed to someone else: their sentence", async () => {
    const d = deps({ routing: vi.fn(async () => ({ status: "ok" as const, routing: { stalled_followup: RAYN }, members: [{ userId: RAYN, role: "law_clerk" as Role, displayName: "Rayn" }] })) }, "paralegal");
    expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: "This one is for Rayn. Ask them to approve it, or an owner or admin." });
  });

  it("a stale draft or a refused linked proposal: refused here, the core is never called", async () => {
    for (const reasons of [["stale"], ["linked-proposal"], ["check-first"], ["draft-issue"]] as const) {
      const d = deps({ closerLook: vi.fn(async () => ({ reasons: [...reasons], linkNotLive: false })) });
      expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_CLOSER_LOOK });
      expect(d.review).not.toHaveBeenCalled();
    }
    const unchecked = deps({ closerLook: vi.fn(async () => null) });
    expect(await runLeadStepYes(unchecked, LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_CANT_CHECK });
    expect(unchecked.review).not.toHaveBeenCalled();
  });

  it("the core's own refusal (it checks everything again) is shown as it is, and nothing is revalidated", async () => {
    const d = deps({ review: vi.fn(async (): Promise<ReviewOutcome> => ({ kind: "error", error: "Couldn't check the proposal linked to this email. Nothing was approved. Try again shortly." })) });
    expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: "Couldn't check the proposal linked to this email. Nothing was approved. Try again shortly." });
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("a draft that is no longer on this lead, already decided, or unreadable is refused", async () => {
    expect(await runLeadStepYes(deps({ leadIdsOf: vi.fn(async () => ["99999999-9999-4999-8999-999999999999"]) }), LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_NOT_ON_LEAD });
    expect(await runLeadStepYes(deps({ leadIdsOf: vi.fn(async () => null) }), LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
    expect(await runLeadStepYes(deps({}, "attorney", item({ status: "approved" })), LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_ALREADY_DECIDED });
    expect(await runLeadStepYes(deps({ readItem: vi.fn(async () => null) }), LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
  });

  it("a draft filed on a lead merged into this one counts as this lead's", async () => {
    const d = deps({ leadIdsOf: vi.fn(async () => [MERGED]) });
    expect((await runLeadStepYes(d, LEAD, ITEM, SHA)).ok).toBe(true);
  });

  it("bad ids are refused without a call", async () => {
    const d = deps();
    expect(await runLeadStepYes(d, "not-a-uuid", ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
    expect(await runLeadStepYes(d, LEAD, "../x", SHA)).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
    expect(d.caller).not.toHaveBeenCalled();
  });
});

describe("the after-Yes sentence comes from the approve core's own result", () => {
  it("names the mailbox the core reports, never assumes Outlook", () => {
    expect(afterYesSentence(resolved() as never, "CLIENT_EMAIL")).toBe(W.leadStepDraftInMailbox(null, "Outlook"));
    expect(afterYesSentence(resolved({ send: "mailbox-google", provider: "google" }) as never, "CLIENT_EMAIL")).toBe(W.leadStepDraftInMailbox(null, "Gmail"));
    expect(afterYesSentence(resolved({ send: "mailbox-microsoft", provider: "microsoft" }) as never, "CLIENT_EMAIL", "Rayn")).toBe("Approved. The draft is in Rayn's Outlook. Nothing is sent until Rayn presses Send.");
    expect(afterYesSentence(resolved({ send: "drafted", provider: null, webLink: null }) as never, "CLIENT_EMAIL")).toBe(W.LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX);
    expect(afterYesSentence(resolved({ send: "none", provider: null }) as never, "CLIENT_EMAIL")).toBe(W.LEAD_STEP_APPROVED_NO_DRAFT);
    expect(afterYesSentence(resolved({ send: null, provider: null }) as never, "CLIENT_EMAIL")).toBe(W.LEAD_STEP_APPROVED_NO_DRAFT);
    expect(afterYesSentence(resolved({ send: "failed", provider: null }) as never, "CLIENT_EMAIL")).toBe(W.LEAD_STEP_APPROVED_DRAFT_FAILED);
    // Approver drafts: the approver's own Outlook draft failed, or may have been made; a client email is never "not emailed".
    expect(afterYesSentence(resolved({ send: "mailbox-failed", provider: null }) as never, "CLIENT_EMAIL")).toBe("Approved, but the draft couldn't be made in your Outlook. Nothing was sent.");
    expect(afterYesSentence(resolved({ send: "mailbox-uncertain", provider: null }) as never, "CLIENT_EMAIL")).toBe("Approved. Check your Outlook Drafts before trying again. Nothing was sent.");
    expect(afterYesSentence(resolved({ send: "manual", provider: null }) as never, "CLIENT_EMAIL")).toBe(W.APPROVED_CLIENT_EMAIL_NO_DRAFT);
    expect(afterYesSentence(resolved({ send: "manual", provider: null }) as never, "ENGAGEMENT_LETTER")).toBe(W.LEAD_STEP_APPROVED_MANUAL);
    expect(W.APPROVED_CLIENT_EMAIL_NO_DRAFT).not.toMatch(/isn't emailed/);
    for (const s of [W.LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX, W.LEAD_STEP_APPROVED_NO_DRAFT, W.LEAD_STEP_APPROVED_DRAFT_FAILED, W.LEAD_STEP_APPROVED_MANUAL]) expect(s).not.toMatch(/Outlook/);
  });

  it("approver drafts: the lead page's Yes passes an Outlook refusal on with its connect link, and a failed draft warns", async () => {
    const refused = deps({ review: vi.fn(async () => ({ kind: "error" as const, error: W.APPROVER_NO_OUTLOOK, connect: "/dashboard/settings/integrations/" })) });
    expect(await runLeadStepYes(refused, LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.APPROVER_NO_OUTLOOK, connect: "/dashboard/settings/integrations/" });
    const failed = deps({ review: vi.fn(async () => resolved({ send: "mailbox-failed", provider: null, webLink: null, draftId: null, approvedText: "Hi Ana" })) });
    expect(await runLeadStepYes(failed, LEAD, ITEM, SHA)).toEqual({ ok: true, message: W.APPROVED_DRAFT_FAILED_OUTLOOK, webLink: null, warn: true, text: "Hi Ana" });
    const unsure = deps({ review: vi.fn(async () => resolved({ send: "mailbox-uncertain", provider: null, webLink: null, draftId: null, approvedText: "Hi Ana" })) });
    expect(await runLeadStepYes(unsure, LEAD, ITEM, SHA)).toEqual({ ok: true, message: W.APPROVED_DRAFT_CHECK_OUTLOOK, webLink: null, warn: true, text: "Hi Ana" });
    const firm = deps({ review: vi.fn(async () => resolved({ send: "drafted", provider: null, webLink: null, draftId: null })) });
    expect(await runLeadStepYes(firm, LEAD, ITEM, SHA)).toMatchObject({ ok: true, message: W.LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX, warn: true });
    // The notice above the card carries the approved text to copy.
    const { noticeFor } = await import("@/components/leads/lead-step-card");
    expect(noticeFor("yes", { ok: true, message: "m", warn: true, text: "Hi Ana" }, "q-1")).toMatchObject({ tone: "warn", text: "Hi Ana" });
  });

  it("Sprint 4 S4: passed to the drafter reads passedToDrafter(name) with no warning; a failed pass reads PASS_FAILED as a warning", async () => {
    const DRAFTER = "00000000-0000-4000-8000-0000000000d1";
    const routing = vi.fn(async () => ({ status: "ok" as const, routing: {}, members: [{ userId: DRAFTER, role: "law_clerk" as const, displayName: "Rayn", email: null }] }));
    const passed = deps({ routing, review: vi.fn(async () => resolved({ send: "passed", provider: null, webLink: null, draftId: null, handoff: { status: "passed", drafter: DRAFTER } })) });
    expect(await runLeadStepYes(passed, LEAD, ITEM, SHA)).toEqual({ ok: true, message: W.passedToDrafter("Rayn"), webLink: null, warn: false });
    const failed = deps({ routing, review: vi.fn(async () => resolved({ send: "pass-failed", provider: null, webLink: null, draftId: null, handoff: { status: "failed", drafter: DRAFTER } })) });
    expect(await runLeadStepYes(failed, LEAD, ITEM, SHA)).toEqual({ ok: true, message: W.PASS_FAILED, webLink: null, warn: true });
    expect(afterYesSentence(resolved({ send: "passed", provider: null }) as never, "CLIENT_EMAIL")).toBe(W.passedToDrafter("the drafter"));
  });

  it("the action returns that sentence", async () => {
    const d = deps({ review: vi.fn(async () => resolved({ send: "none", provider: null, webLink: null })) });
    expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: true, message: W.LEAD_STEP_APPROVED_NO_DRAFT, webLink: null, warn: true });
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
  it("saves through the queue's save path; the next Yes is decided on the saved text", async () => {
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
    // No optimistic "may say yes now": the page is revalidated and works it out from the re-read item.
    expect(plain).toEqual({ ok: true, message: W.LEAD_STEP_EDIT_SAVED });
    expect(d.review).toHaveBeenCalledWith({ id: ITEM, intent: "save", body: "Hi Maya,\nJust checking in." });
    expect(d.revalidate).toHaveBeenCalledWith(LEAD);
    // After an edit that adds advice text, the next Yes is refused for the clerk (the item is re-read and re-classified).
    await runLeadStepEdit(d, LEAD, ITEM, "Hi Maya, your mark is likely to be registered.");
    expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: "Only an attorney can approve this kind of message." });
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

describe("review findings", () => {
  it("a linked proposal that isn't live: Yes is refused here with its own sentence (it would turn the link on)", async () => {
    const d = deps({ closerLook: vi.fn(async () => ({ reasons: ["linked-proposal" as const], linkNotLive: true })) });
    expect(await runLeadStepYes(d, LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_LINK_NOT_LIVE });
    expect(d.review).not.toHaveBeenCalled();
  });

  it("the hander of a card now with someone else gets no Yes; the holder and an unknown state are unchanged", async () => {
    const away = deps({ handoff: vi.fn(async (): Promise<HandoffFact> => ({ status: "ok", holder: { userId: RAYN, by: ME, note: null, at: "2026-11-17T12:00:00.000Z" } })) });
    expect(await runLeadStepYes(away, LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_HANDED_AWAY });
    expect(away.review).not.toHaveBeenCalled();
    const held = deps({ handoff: vi.fn(async (): Promise<HandoffFact> => ({ status: "ok", holder: { userId: ME, by: RAYN, note: null, at: "2026-11-17T12:00:00.000Z" } })) });
    expect((await runLeadStepYes(held, LEAD, ITEM, SHA)).ok).toBe(true);
    expect((await runLeadStepYes(deps(), LEAD, ITEM, SHA)).ok).toBe(true);
  });

  it("Send back goes through the deck's own path after the same checks", async () => {
    const d = deps();
    expect(await runLeadStepSendBack(d, LEAD, ITEM, " not mine \u200b")).toEqual({ ok: true, message: W.LEAD_STEP_SENT_BACK });
    expect(d.sendBack).toHaveBeenCalledWith(ITEM, "not mine");
    const v = deps({ caller: vi.fn(async () => ({ userId: ME, role: "viewer" as Role })) });
    expect(await runLeadStepSendBack(v, LEAD, ITEM, "")).toEqual({ ok: false, error: W.LEAD_STEP_NO_EDIT });
    expect(v.sendBack).not.toHaveBeenCalled();
    const refused = deps({ sendBack: vi.fn(async () => ({ ok: false as const, error: W.DECK_NOT_YOURS })) });
    expect(await runLeadStepSendBack(refused, LEAD, ITEM, "")).toEqual({ ok: false, error: W.DECK_NOT_YOURS });
  });

  it("a Send back note over the limit is refused, never cut, and nothing is written", async () => {
    const d = deps();
    expect(await runLeadStepSendBack(d, LEAD, ITEM, "x".repeat(501))).toEqual({ ok: false, error: W.SEND_BACK_NOTE_TOO_LONG });
    expect(d.sendBack).not.toHaveBeenCalled();
    expect(await runLeadStepSendBack(d, LEAD, ITEM, "x".repeat(500))).toMatchObject({ ok: true });
    expect(d.sendBack).toHaveBeenCalledWith(ITEM, "x".repeat(500));
  });

  it("a lead set that couldn't be read in full says 'failed', never 'not on this lead'", async () => {
    expect(await runLeadStepYes(deps({ leadSet: vi.fn(async () => null) }), LEAD, ITEM, SHA)).toEqual({ ok: false, error: W.LEAD_STEP_FAILED });
  });

  it("after a yes: 'sent' reads Approved., and a letter says its document is made", () => {
    expect(afterYesSentence(resolved({ send: "sent", provider: null }) as never, "CLIENT_EMAIL")).toBe(W.LEAD_STEP_APPROVED);
    expect(W.LEAD_STEP_APPROVED).toBe("Approved.");
    for (const type of ["ENGAGEMENT_LETTER", "OPINION_LETTER", "TRADEMARK_CLEARANCE"]) {
      expect(afterYesSentence(resolved({ send: null, provider: null }) as never, type)).toBe(W.LEAD_STEP_APPROVED_LETTER);
    }
    expect(afterYesSentence(resolved({ send: null, provider: null }) as never, "CLIENT_EMAIL")).toBe(W.LEAD_STEP_APPROVED_NO_DRAFT);
  });

  it("a reason of only zero-width or bidi characters is no reason; they never count toward the 200", async () => {
    expect(cleanReason("\u200b\u200e\u202e\u2066")).toBeNull();
    expect(cleanReason("ok\u200b".padEnd(250, "\u200b"))).toBe("ok");
    expect(cleanReason("a\u202eb")).toBe("ab");
    const d = deps();
    expect(await runLeadStepNotThis(d, LEAD, ITEM, "\u200b\u200b")).toEqual({ ok: false, error: W.LEAD_STEP_REASON_NEEDED });
    expect(d.caller).not.toHaveBeenCalled();
  });
});
