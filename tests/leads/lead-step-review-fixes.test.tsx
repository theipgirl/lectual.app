import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/lead-step/actions", () => ({ leadStepYesAction: vi.fn(), leadStepNotThisAction: vi.fn(), leadStepEditAction: vi.fn(), leadStepSendBackAction: vi.fn() }));

import { NeedsYourYes } from "@/components/leads/NeedsYourYes";
import { OtherApprovals } from "@/components/leads/OtherApprovals";
import { TopCardFrame } from "@/components/leads/TopCardFrame";
import { isDone, noticeFor, settle, toggleEdit, type CardState } from "@/components/leads/lead-step-card";
import { afterYesWarns, runLeadStepYes } from "@/lib/lead-step/actions-core";
import { buildLeadStepView, type NeedsYesView } from "@/lib/lead-step/view-model";
import type { HandoffFact } from "@/lib/lead-step/facts";
import type { Role } from "@/lib/auth/roles";
import * as W from "@/lib/ui/words";
import { LEAD, ME, RAYN, draft, facts, pending } from "../lead-step/fixtures";

const root = path.resolve(__dirname, "../..");
const src = (f: string) => readFileSync(path.join(root, f), "utf8");
const text = (h: string) => h.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const needs = (f = facts({ approvals: pending(draft()) })) => buildLeadStepView(f).top as NeedsYesView;

describe("1. a saved edit does not end the card", () => {
  const start: CardState = { mode: "editing", body: "typed", outcome: null };
  it("edit success: sentence to the notice, editor closed, not done; then Yes still ends it", () => {
    const afterEdit = settle(start, "edit", { ok: true, message: W.LEAD_STEP_EDIT_SAVED });
    expect(afterEdit).toEqual({ mode: "idle", body: "typed", outcome: null });
    expect(isDone(afterEdit)).toBe(false);
    const afterYes = settle(afterEdit, "yes", { ok: true, message: "Approved.", webLink: null, warn: false });
    expect(isDone(afterYes)).toBe(true);
  });
  it("only Yes, Not this and Send back end the card; a refusal never does", () => {
    for (const k of ["yes", "not-this", "send-back"] as const) expect(isDone(settle(start, k, { ok: true, message: "x" })), k).toBe(true);
    for (const k of ["edit", "yes"] as const) expect(isDone(settle(start, k, { ok: false, error: "no" })), k).toBe(false);
  });
  it("an old failure is cleared by a later edit success", () => {
    const failed = settle(start, "edit", { ok: false, error: "no" });
    expect(settle(failed, "edit", { ok: true, message: "ok" }).outcome).toBeNull();
  });
});

describe("2. a failed-draft approval is a warning with a link, not a green success", () => {
  const r = (send: string | null) => ({ kind: "resolved" as const, intent: "approve" as const, send, webLink: null, draftId: null, provider: null });
  it("warns for failed, mailbox-failed and no draft made; not for a draft, manual, sent or a letter", () => {
    // Approver drafts (changed on purpose): an uncertain draft and a client email with no draft ("manual") warn too.
    // Approver drafts (changed on purpose): a client email the queue drafted in the FIRM's mailbox warns too.
    for (const s of ["failed", "mailbox-failed", "mailbox-uncertain", "manual", "drafted", "unexpected"]) expect(afterYesWarns(r(s), "CLIENT_EMAIL"), s).toBe(true);
    for (const s of ["mailbox-microsoft", "mailbox-google", "sent"]) expect(afterYesWarns(r(s), "CLIENT_EMAIL"), s).toBe(false);
    expect(afterYesWarns(r("drafted"), "BRIEFING")).toBe(false);
    expect(afterYesWarns(r("manual"), "ENGAGEMENT_LETTER")).toBe(false);
    expect(afterYesWarns(r(null), "ENGAGEMENT_LETTER")).toBe(false);
  });
  it("the notice is a warn with the approval link, built from the captured id", () => {
    const n = noticeFor("yes", { ok: true, message: W.LEAD_STEP_APPROVED_DRAFT_FAILED, warn: true }, "q-7");
    expect(n).toMatchObject({ tone: "warn", href: "/dashboard/queue/q-7/", hrefLabel: W.LEAD_PAGE_OPEN_IN_APPROVALS });
    expect(noticeFor("yes", { ok: true, message: "m", webLink: "https://o.example/d", warn: false }, "q-7")).toMatchObject({ tone: "ok", href: "https://o.example/d" });
    expect(noticeFor("yes", { ok: true, message: "m", webLink: "javascript:x", warn: false }, "q-7").href).toBeNull();
    const html = text(renderToStaticMarkup(<TopCardFrame initial={n}>x</TopCardFrame>));
    expect(html).toContain("lx-banner-warn");
    expect(html).toContain('href="/dashboard/queue/q-7/"');
    expect(html).not.toContain("_blank");
  });
  it("approver drafts: a failed draft's notice shows the approved text to copy", () => {
    const n = noticeFor("yes", { ok: true, message: W.APPROVED_DRAFT_FAILED_OUTLOOK, warn: true, text: "Hi Ana, approved words" }, "q-7");
    const html = renderToStaticMarkup(<TopCardFrame initial={n}>x</TopCardFrame>);
    expect(html).toContain("Hi Ana, approved words");
    expect(html).toContain(W.APPROVED_TEXT_LABEL);
  });
  it("the action reports warn from the core's own send state", async () => {
    const d = {
      staffPreview: async () => null, caller: async () => ({ userId: ME, role: "attorney" as Role }),
      readItem: async () => ({ id: "q-1", status: "pending", type: "CLIENT_EMAIL", agent: "morning-brief", headline: "h", summary: null, recipient: null, subject: null, draft_body: "x", final_body: null }) as never,
      leadIdsOf: async () => [LEAD], leadSet: async () => [LEAD], routing: async () => ({ status: "ok" as const, routing: {}, members: [] }),
      closerLook: async () => ({ reasons: [], linkNotLive: false }), handoff: async () => ({ status: "unknown" as const }), sendBack: async () => ({ ok: true as const }),
      review: async () => r("mailbox-failed"), revalidate: () => {},
    };
    expect(await runLeadStepYes(d, LEAD, "q-1", "c".repeat(64))).toMatchObject({ ok: true, warn: true, message: W.APPROVED_DRAFT_FAILED_OUTLOOK });
    // 7: a stale draft says this page's own sentence, never a confirmation box
    const stale = await runLeadStepYes({ ...d, review: async () => ({ kind: "error" as const, error: "Status changed. Tick the confirmation box to approve it anyway, or reject it." }) }, LEAD, "q-1", "c".repeat(64));
    expect(stale).toEqual({ ok: false, error: W.LEAD_PAGE_STALE_DRAFT });
    expect(W.LEAD_PAGE_STALE_DRAFT).not.toMatch(/box|tick/i);
  });
});

describe("3. nothing the old Waiting on attorney review list showed is lost", () => {
  const lines = (html: string) => text(html);
  it("a lead with only a briefing: no draft card, the briefing listed and labelled, with its link", () => {
    const f = facts({ approvals: { status: "ok", value: { items: [], total: 0, refs: [], briefings: [{ id: "b-1", headline: "Consult heads-up: Maya", createdAt: "2026-11-16T12:00:00Z" }] } } });
    const v = buildLeadStepView(f);
    expect(v.top.kind).not.toBe("needs-yes");
    const html = lines(renderToStaticMarkup(<OtherApprovals queue={v.queue} />));
    expect(html).toContain(W.LEAD_PAGE_BRIEFINGS);
    expect(html).toContain("Consult heads-up: Maya");
    expect(html).toContain('href="/dashboard/queue/b-1/"');
    expect(html).toContain("queued Nov 16");
    expect(html).not.toContain(W.LEAD_PAGE_ALSO_WAITING);
  });
  it("three drafts: the oldest is the card, the other two are listed with links and ages", () => {
    const f = facts({ approvals: pending(draft({ id: "q-1", createdAt: "2026-11-14T12:00:00Z" }), draft({ id: "q-2", headline: "Second draft", createdAt: "2026-11-15T12:00:00Z" }), draft({ id: "q-3", headline: "Third draft", createdAt: "2026-11-16T12:00:00Z" })) });
    const v = buildLeadStepView(f);
    expect((v.top as NeedsYesView).itemId).toBe("q-1");
    expect(v.queue?.others.map((o) => o.id)).toEqual(["q-2", "q-3"]);
    const html = lines(renderToStaticMarkup(<OtherApprovals queue={v.queue} />));
    expect(html).toContain(W.LEAD_PAGE_ALSO_WAITING);
    expect(html).toContain('href="/dashboard/queue/q-2/"');
    expect(html).toContain('href="/dashboard/queue/q-3/"');
    expect(html).toContain("queued Nov 15");
    expect(html).not.toContain(W.LEAD_PAGE_BRIEFINGS);
  });
  it("the card item is not repeated, an unread queue lists nothing, and the card's own link goes to Approvals with everyone shown", () => {
    expect(renderToStaticMarkup(<OtherApprovals queue={buildLeadStepView(facts({ approvals: pending(draft()) })).queue} />)).toBe("");
    expect(buildLeadStepView(facts({ approvals: { status: "unavailable" } })).queue).toBeNull();
    const many = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={needs(facts({ approvals: pending(draft(), draft({ id: "q-2" })) }))} />));
    expect(many).toMatch(/\/dashboard\/queue\/?\?who=all/);
  });
});

describe("4. last contact", () => {
  it("shows when they last wrote while the firm wrote last", () => {
    const f = facts({ lead: { ...facts().lead, lastInboundAt: "2026-11-10T14:00:00Z", lastOutboundAt: "2026-11-16T14:00:00Z" } });
    expect(buildLeadStepView(f).facts.contact.sub).toBe(`${W.LEAD_STEP_WE_WROTE} · ${W.LEAD_STEP_THEIR_TURN} · ${W.leadStepTheyLastWrote("Nov 10")}`);
    const theyLast = facts({ lead: { ...facts().lead, lastInboundAt: "2026-11-16T14:00:00Z", lastOutboundAt: "2026-11-10T14:00:00Z" } });
    expect(buildLeadStepView(theyLast).facts.contact.sub).toBe(`${W.LEAD_STEP_THEY_WROTE} · ${W.OUR_TURN}`);
  });
  it("a future timestamp is no contact", () => {
    const f = facts({ lead: { ...facts().lead, lastInboundAt: "2027-03-01T00:00:00Z", lastOutboundAt: null } });
    expect(buildLeadStepView(f).facts.contact.value).toBe(W.LEAD_STEP_NO_CONTACT);
    const one = facts({ lead: { ...facts().lead, lastInboundAt: "2027-03-01T00:00:00Z", lastOutboundAt: "2026-11-10T14:00:00Z" } });
    expect(buildLeadStepView(one).facts.contact.sub).toContain(W.LEAD_STEP_WE_WROTE);
    expect(buildLeadStepView(one).facts.contact.sub).not.toContain("They last wrote");
  });
  it("the old last-heard line is hidden only when the facts are drawn", () => {
    expect(src("src/app/dashboard/leads/[id]/page.tsx")).toContain("hideLastHeard={!!step}");
  });
});

describe("5. a view that can't be built is the couldn't-load card", () => {
  it("buildLeadStepView is guarded in the page", () => {
    expect(src("src/app/dashboard/leads/[id]/page.tsx")).toMatch(/try \{\s*step = buildLeadStepView\(stepLoad\.facts\);\s*\} catch \{\s*step = null;/);
  });
});

describe("6. Send back and the editor", () => {
  const away: HandoffFact = { status: "ok", holder: { userId: ME, by: RAYN, note: null, at: "2026-11-17T14:00:00Z" } };
  const routing = { status: "ok" as const, routing: {}, members: [{ userId: RAYN, role: "law_clerk" as Role, displayName: "Rayn" }] };
  const view = needs(facts({ approvals: pending(draft({ handoff: away })), routing }));
  it("Send back is disabled while editing, and enabled otherwise", () => {
    const editing = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={view} initial={{ mode: "editing" }} />));
    expect(editing).toMatch(/<button[^>]*disabled=""[^>]*>Send back<\/button>/);
    const idle = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={view} />));
    expect(idle).not.toMatch(/<button[^>]*disabled=""[^>]*>Send back<\/button>/);
  });
  it("closing the editor discards the unsaved text (the choice: discard, same as Cancel)", () => {
    const s: CardState = { mode: "editing", body: "unsaved words", outcome: null };
    expect(toggleEdit(s, "saved text")).toEqual({ mode: "idle", body: "saved text", outcome: null });
    expect(toggleEdit({ ...s, mode: "idle" }, "saved text").mode).toBe("editing");
  });
});

describe("7 and 8. wording and unused words", () => {
  it("only the first reviewer note is labelled First step; a check-first note says so instead", () => {
    const plain = needs(facts({ approvals: pending(draft({ summary: "First step: read it.\nSecond thing.\nThird thing." })) }));
    const html = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={plain} />));
    expect(html.match(/First step:/g)).toHaveLength(1);
    expect(html).toContain("Second thing.");
    const check = needs(facts({ approvals: pending(draft({ summary: "Second thing.\nCHECK FIRST: the date." })) }));
    const h2 = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={check} />));
    expect(h2).toContain(W.LEAD_PAGE_CHECK_FIRST);
    expect(h2).not.toContain("First step:");
  });
  it("a thrown Yes says it couldn't confirm, and says to check Approvals", () => {
    expect(W.LEAD_PAGE_YES_UNCONFIRMED).toBe("We couldn't confirm that. Check Approvals before trying again. Nothing was sent.");
    expect(src("src/components/leads/NeedsYourYes.tsx")).toMatch(/kind === "yes" \? LEAD_PAGE_YES_UNCONFIRMED/);
  });
  it("the three unused words are gone", () => {
    for (const w of ["LEAD_PAGE_TOP_LABEL", "LEAD_PAGE_YES_HELD", "LEAD_PAGE_DID_NO_UNDO_NOTE"]) expect(Object.keys(W)).not.toContain(w);
  });
});
