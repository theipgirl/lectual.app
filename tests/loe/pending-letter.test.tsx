import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import { CheckFirstPanel, checkFirstShown } from "@/components/proposal-editor/CheckFirstPanel";
import { EngagementLetterSlot } from "@/components/proposal-editor/EngagementLetterSlot";
import { editorLetterState, letterCopyCheck } from "@/lib/loe/editor-state";
import type { ApprovedRead } from "@/lib/loe/templates-store";
import { blockingCount, buildChecklist } from "@/lib/proposal-editor/checklist";
import { runCreateLink } from "@/lib/proposal-editor/create-link";
import { LETTER_SWITCH_UNREADABLE, runSaveDraft, settlePendingLetter, type SaveDraftDeps } from "@/lib/proposal-editor/save-draft";
import { DRAFT_FORM_ID } from "@/lib/proposal-editor/unsaved";
import { attachFirmLetter } from "@/lib/proposals/attach-letter";
import type { ProposalCardReceipts } from "@/lib/proposals/card";
import { LETTER_CHECK_PATH, hasPendingLetterCheck, pendingLetterCheck } from "@/lib/proposals/letter-check";
import type { ApprovedLetter } from "@/lib/proposals/loe-snapshot";
import type { ProposalContent, ProposalRow } from "@/lib/proposals/types";
import { hasErrors, validateContent } from "@/lib/proposals/validate";
import { LETTER_NOT_ATTACHED_CHECK, LETTER_PENDING_FIX, LETTER_PENDING_SWITCH_NOTE } from "@/lib/ui/words";
import { sevetri } from "../proposals/fixture";
import { fullLetterBody } from "./full-letter-fixture";

/**
 * A draft the assistant or Copilot made while the firm's engagement letter couldn't be read carries a check, and no letter.
 * The Engagement letter switch is inside the editor's ONE form, so EVERY Save posts it. These tests hold the rule that follows:
 * a firm with an approved letter never gets a live proposal that silently lacks it.
 *
 * The forms posted here are built from the RENDERED editor section (`formAsRendered`), so "an ordinary Save" is whatever the
 * page really posts when a person touches nothing in that section.
 */

const APPROVED: ApprovedLetter = { id: "11111111-1111-4111-8111-111111111111", kind: "trademark", version: 3, title: "Engagement letter", body: fullLetterBody() };
const ok = (letter: ApprovedLetter | null): ApprovedRead => ({ status: "ok", letter });
const DOWN: ApprovedRead = { status: "unavailable" };
const OTHER = { text: "A credit was applied. Check it.", source: "consult" as const, path: "adjustments[0]" };

/** The draft as the assistant's run stores it when the letter read failed. */
function pendingDraft(): ProposalContent {
  const made = attachFirmLetter({ ...sevetri(), checks: [OTHER] }, DOWN, "assistant");
  expect(made.letter).toBe("unreadable");
  return made.content;
}

const UPDATED = "2026-11-10T12:00:00.000Z";
function row(content: ProposalContent, over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: "p1", org_id: "o", family_id: "p1", version: 1, public_token: "t".repeat(43), lead_id: null, matter_id: null,
    client_name: "Sevetri Wilson", client_email: "s@example.com", title: "Trademark Proposal", status: "draft", content,
    expires_on: "2099-11-10", pay_url: null, source: "agent", created_by: null, updated_by: null, approved_by: null,
    approved_at: null, sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: UPDATED, updated_at: UPDATED, ...over,
  };
}

/** The Engagement letter section as the page draws it for this content and this read of the firm's letter. */
function drawSection(content: ProposalContent, read: ApprovedRead): string {
  const state = editorLetterState({ read, attached: content.loe, pending: hasPendingLetterCheck(content) });
  return renderToStaticMarkup(createElement("form", { id: DRAFT_FORM_ID }, createElement(EngagementLetterSlot, { state, editable: true })));
}

/** What a Save posts when the person changes ONLY the pay link: every other field as stored, the letter section exactly as rendered. */
function formAsRendered(content: ProposalContent, sectionHtml: string, over: Record<string, string | null> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    proposalId: "p1", updatedAt: UPDATED,
    fullName: "Sevetri Wilson", firstName: "Sevetri", company: "Prosperall", clientEmail: "s@example.com", title: "Trademark Proposal",
    greeting: "Hi Sevetri, here is your proposal.", recommendation: "Both marks are best.", officeActionNote: "",
    payUrl: "https://pay.example/x", expiresOn: "2099-11-10",
    package: "Concierge", base: "4950", includedClasses: "3", perClass: "825", secondMarkPct: "20", govPerClass: "350",
    adjFields: "1", incFields: "1",
  };
  content.names.forEach((n, b) => {
    const p = `b.${b}.`;
    base[`${p}nameId`] = n.id; base[`${p}name`] = n.name; base[`${p}pkgFields`] = "1";
    n.marks.forEach((m, i) => { base[`${p}mark.${i}.id`] = m.id; base[`${p}mark.${i}.kind`] = m.kind; base[`${p}mark.${i}.desc`] = m.desc; base[`${p}mark.${i}.preselected`] = "on"; });
    n.classes.forEach((k, i) => { base[`${p}class.${i}.id`] = k.id; base[`${p}class.${i}.label`] = k.label; base[`${p}class.${i}.preselected`] = "on"; });
  });
  // The letter section, read off the markup: the hidden marker, and the checkbox only when it is drawn checked.
  if (/<input type="hidden" name="loeFields" value="1"/.test(sectionHtml)) base.loeFields = "1";
  if (/<input type="checkbox" name="loeOn"[^>]*\schecked=""/.test(sectionHtml)) base.loeOn = "on";
  for (const [k, v] of Object.entries({ ...base, ...over })) {
    if (v === null) f.delete(k);
    else f.set(k, v);
  }
  if (over.loeOn === null) f.delete("loeOn");
  return f;
}

function saveDeps(current: ProposalRow, read: ApprovedRead) {
  const update = vi.fn(async () => current);
  const deps: SaveDraftDeps = {
    gate: vi.fn(async () => null),
    getRow: vi.fn(async () => current),
    settingPricing: vi.fn(async () => ({ packages: [] })),
    approvedLetter: vi.fn(async () => read),
    update,
    describe: proposalActionError,
    revalidate: vi.fn(),
    rand: () => "ab12",
  };
  return { deps, update };
}
const written = (update: ReturnType<typeof vi.fn>) => (update.mock.calls[0] as unknown as [string, { content: ProposalContent; payUrl?: string | null }])[1];
const forApproval = (content: ProposalContent, payUrl: string | null = "https://pay.example/x") =>
  validateContent(content, { forApproval: true, title: "Trademark Proposal", expires_on: "2099-11-10", pay_url: payUrl, client_email: "s@example.com" });

describe("the pending check", () => {
  it("is on a draft made while the letter couldn't be read: no letter, the check first, the others kept", () => {
    const c = pendingDraft();
    expect("loe" in c).toBe(false);
    expect(c.checks).toEqual([{ text: LETTER_NOT_ATTACHED_CHECK, source: "assistant", path: LETTER_CHECK_PATH }, OTHER]);
    expect(hasPendingLetterCheck(c)).toBe(true);
    expect(pendingLetterCheck(c)?.text).toBe(LETTER_NOT_ATTACHED_CHECK);
  });

  it("is not pending once a letter is on the content, or when the check is not there", () => {
    expect(hasPendingLetterCheck(sevetri())).toBe(false);
    expect(hasPendingLetterCheck({ ...pendingDraft(), loe: { kind: "trademark", template_id: APPROVED.id, template_version: 3, title: "t", body: "b" } })).toBe(false);
    expect(hasPendingLetterCheck(null)).toBe(false);
  });

  it("checker's m6: neither sentence tells anyone to 'turn it on' (there may be no switch to turn)", () => {
    for (const s of [LETTER_NOT_ATTACHED_CHECK, LETTER_PENDING_FIX, LETTER_PENDING_SWITCH_NOTE]) expect(s).not.toMatch(/turn it on/i);
    expect(LETTER_NOT_ATTACHED_CHECK).toMatch(/^Couldn't read your engagement letter/);
    expect(LETTER_NOT_ATTACHED_CHECK.length).toBeLessThanOrEqual(300);
  });
});

describe("the switch starts ON for a pending draft", () => {
  it("firm has an approved letter now: the checkbox is drawn checked, with a note that a Save attaches it", () => {
    const html = drawSection(pendingDraft(), ok(APPROVED));
    expect(html).toContain('data-letter-state="off"');
    expect(html).toMatch(/<input type="checkbox" name="loeOn"[^>]*\schecked=""/);
    expect(html).toContain("data-letter-pending");
    expect(html).toContain(LETTER_PENDING_SWITCH_NOTE.replace(/'/g, "&#x27;"));
    expect(html).toContain("Preview the letter");
  });

  it("an ordinary draft with no letter (a person turned it off earlier) still starts OFF", () => {
    const html = drawSection(sevetri(), ok(APPROVED));
    expect(html).toMatch(/<input type="checkbox" name="loeOn"/);
    expect(html).not.toMatch(/<input type="checkbox" name="loeOn"[^>]*\schecked=""/);
    expect(html).not.toContain("data-letter-pending");
  });

  it("no approved letter, or an unreadable one: no switch at all", () => {
    for (const read of [ok(null), { status: "not-set-up" } as ApprovedRead, DOWN]) {
      const html = drawSection(pendingDraft(), read);
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain('name="loeFields"');
      // (The set-up line's own "then turn it on here" is about a switch that appears once a letter is approved; the CHECK's words are tested above.)
      expect(html).not.toContain("data-letter-pending");
    }
  });
});

describe("THE BUG: an ordinary Save of something else must not settle the letter as 'none'", () => {
  it("staff add the pay link and press Save: the letter is ATTACHED, and only then is the check cleared", async () => {
    const draft = pendingDraft();
    const section = drawSection(draft, ok(APPROVED));
    const { deps, update } = saveDeps(row(draft), ok(APPROVED));
    const r = await runSaveDraft(deps, formAsRendered(draft, section, { payUrl: "https://pay.example/new" }));
    expect(r.saved).toBe(true);
    const saved = written(update);
    expect(saved.payUrl).toBe("https://pay.example/new");
    expect(saved.content.loe).toEqual({ kind: "trademark", template_id: APPROVED.id, template_version: 3, title: APPROVED.title, body: APPROVED.body });
    expect(saved.content.checks).toEqual([OTHER]);
    expect(hasPendingLetterCheck(saved.content)).toBe(false);
    // Nothing about the letter blocks the link now.
    expect(forApproval(saved.content).filter((i) => i.path.startsWith("loe"))).toEqual([]);
  });

  it("the form the page posts for such a draft really carries the switch ON (this is what was posted as off before)", () => {
    const draft = pendingDraft();
    const f = formAsRendered(draft, drawSection(draft, ok(APPROVED)));
    expect(f.get("loeFields")).toBe("1");
    expect(f.get("loeOn")).toBe("on");
  });

  it("turning the switch OFF is the explicit choice: the check is cleared with no letter, and nothing blocks", async () => {
    const draft = pendingDraft();
    const { deps, update } = saveDeps(row(draft), ok(APPROVED));
    const r = await runSaveDraft(deps, formAsRendered(draft, drawSection(draft, ok(APPROVED)), { loeOn: null }));
    expect(r.saved).toBe(true);
    const saved = written(update).content;
    expect("loe" in saved).toBe(false);
    expect(saved.checks).toEqual([OTHER]);
    expect(forApproval(saved).filter((i) => i.path.startsWith("loe"))).toEqual([]);
  });

  it("the page could not read the letter when it was drawn (no switch in the form), but it reads at save: attached by default", async () => {
    const draft = pendingDraft();
    const section = drawSection(draft, DOWN);
    const f = formAsRendered(draft, section);
    expect(f.has("loeFields")).toBe(false);
    const { deps, update } = saveDeps(row(draft), ok(APPROVED));
    expect((await runSaveDraft(deps, f)).saved).toBe(true);
    expect(written(update).content.loe?.template_id).toBe(APPROVED.id);
    expect(written(update).content.checks).toEqual([OTHER]);
  });
});

describe("the letter read fails AGAIN at save", () => {
  it("the save still succeeds, nothing is attached, and the check stays", async () => {
    const draft = pendingDraft();
    // Drawn with the switch on (the read worked at render), failing at save: this used to refuse the whole save.
    for (const section of [drawSection(draft, ok(APPROVED)), drawSection(draft, DOWN)]) {
      const { deps, update } = saveDeps(row(draft), DOWN);
      const r = await runSaveDraft(deps, formAsRendered(draft, section, { payUrl: "https://pay.example/new" }));
      expect(r).toMatchObject({ saved: true });
      expect(r.error).toBeUndefined();
      const saved = written(update);
      expect(saved.payUrl).toBe("https://pay.example/new");
      expect("loe" in saved.content).toBe(false);
      expect(saved.content.checks).toEqual(draft.checks);
      expect(hasPendingLetterCheck(saved.content)).toBe(true);
    }
  });

  it("even with the switch turned off, a failed read settles nothing (the choice is made against a letter that can be read)", async () => {
    const draft = pendingDraft();
    const { deps, update } = saveDeps(row(draft), DOWN);
    await runSaveDraft(deps, formAsRendered(draft, drawSection(draft, ok(APPROVED)), { loeOn: null }));
    expect(hasPendingLetterCheck(written(update).content)).toBe(true);
  });

  it("an ORDINARY draft is unchanged: a switch change against an unreadable letter is still refused", async () => {
    const plain = sevetri();
    const { deps, update } = saveDeps(row(plain), DOWN);
    const r = await runSaveDraft(deps, formAsRendered(plain, drawSection(plain, ok(APPROVED)), { loeOn: "on" }));
    expect(r).toEqual({ error: LETTER_SWITCH_UNREADABLE });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("while it is unresolved it BLOCKS the link", () => {
  it("validateContent(forApproval) reports it as an error on the letter; an ordinary validation does not", () => {
    const draft = pendingDraft();
    const issues = forApproval(draft);
    expect(issues.filter((i) => i.path === LETTER_CHECK_PATH)).toEqual([{ level: "error", path: "loe", message: LETTER_PENDING_FIX }]);
    expect(hasErrors(issues)).toBe(true);
    // A draft may still be saved: without forApproval nothing about it is an error.
    expect(validateContent(draft).filter((i) => i.path === LETTER_CHECK_PATH)).toEqual([]);
    // And a content with no such check is untouched.
    expect(forApproval(sevetri()).filter((i) => i.path.startsWith("loe"))).toEqual([]);
  });

  it("the editor's checklist shows ONE item for it, a Fix linked to the Engagement letter section, and it counts as blocking", () => {
    const draft = pendingDraft();
    const list = buildChecklist(forApproval(draft), draft);
    const letter = list.filter((i) => i.href === "#pe-sec-letter");
    expect(letter).toEqual([{ level: "error", text: LETTER_PENDING_FIX, where: "engagement letter", href: "#pe-sec-letter" }]);
    expect(blockingCount(list)).toBeGreaterThanOrEqual(1);
    // The other stored check is still listed, as a Check.
    expect(list.filter((i) => i.level === "check").map((i) => i.text)).toEqual([OTHER.text]);
  });

  it("the letter copy check answers 'unattached' for it, before and whatever the firm's letter reads as", () => {
    const draft = pendingDraft();
    for (const read of [ok(APPROVED), ok(null), DOWN, { status: "not-set-up" } as ApprovedRead]) expect(letterCopyCheck(draft, read)).toBe("unattached");
    expect(letterCopyCheck(sevetri(), ok(APPROVED))).toBe("no_letter");
  });

  it("'Save and create link' refuses with the fixed sentence and neither approves nor sends", async () => {
    const approve = vi.fn(async () => ({}) as never);
    const makeLive = vi.fn(async () => ({}) as never);
    const r = await runCreateLink({ gate: async () => null, letterCurrent: async () => "unattached", approve, makeLive, describe: proposalActionError, revalidate: vi.fn() }, "p1");
    expect(r).toEqual({ error: LETTER_PENDING_FIX });
    expect(approve).not.toHaveBeenCalled();
    expect(makeLive).not.toHaveBeenCalled();
  });

  it("the store's approve step refuses it through the same validation (so a hand-posted approve cannot get past either)", () => {
    const store = readFileSync(join(process.cwd(), "src/lib/proposals/store.ts"), "utf8");
    const fn = store.slice(store.indexOf("export async function approveProposal"), store.indexOf("export async function unapproveProposal"));
    expect(fn).toMatch(/validateContent\(current\.content, \{\s*forApproval: true/);
    expect(fn).toContain("if (hasErrors(issues))");
  });
});

describe("the firm has NO approved letter (a read that worked)", () => {
  it("there is nothing to attach: the next Save drops the check, with no letter, and nothing blocks", async () => {
    for (const read of [ok(null), { status: "not-set-up" } as ApprovedRead]) {
      const draft = pendingDraft();
      const { deps, update } = saveDeps(row(draft), read);
      const r = await runSaveDraft(deps, formAsRendered(draft, drawSection(draft, read)));
      expect(r.saved).toBe(true);
      const saved = written(update).content;
      expect("loe" in saved).toBe(false);
      expect(saved.checks).toEqual([OTHER]);
      expect(forApproval(saved).filter((i) => i.path.startsWith("loe"))).toEqual([]);
    }
  });

  it("when it was the only check, the list goes with it", () => {
    const only = attachFirmLetter(sevetri(), DOWN, "copilot").content;
    const out = settlePendingLetter(only, new FormData(), ok(null));
    expect("checks" in out).toBe(false);
  });
});

describe("checker's m5: the assistant's panel derives the letter line from the check, so it goes when the check goes", () => {
  const receipts: ProposalCardReceipts = { status: "ok", verified: ["a word mark and a logo"], unverified: [], notes: "CHECK FIRST: choose the package before saving.", more: 0 };
  const panel = (letterCheck: string | null) => renderToStaticMarkup(createElement(CheckFirstPanel, { receipts, letterCheck }));

  it("pending: the line is in the panel, first, and counted", () => {
    const html = panel(pendingLetterCheck(pendingDraft())?.text ?? null);
    expect(html).toContain("Check these 3 things");
    const first = html.indexOf(LETTER_NOT_ATTACHED_CHECK.replace(/'/g, "&#x27;"));
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(html.indexOf("choose the package before saving."));
  });

  it("after a Save attached the letter: the line is gone, with the SAME stored notes", async () => {
    const draft = pendingDraft();
    const { deps, update } = saveDeps(row(draft), ok(APPROVED));
    await runSaveDraft(deps, formAsRendered(draft, drawSection(draft, ok(APPROVED))));
    const after = written(update).content;
    const html = panel(pendingLetterCheck(after)?.text ?? null);
    expect(html).toContain("Check these 2 things");
    expect(html).not.toContain("engagement letter");
  });

  it("a panel whose only item is the letter line still draws, and the page keeps one 'Check these' heading", () => {
    const empty: ProposalCardReceipts = { status: "ok", verified: [], unverified: [], notes: null, more: 0 };
    expect(checkFirstShown(empty)).toBe(false);
    expect(checkFirstShown(empty, LETTER_NOT_ATTACHED_CHECK)).toBe(true);
    expect(renderToStaticMarkup(createElement(CheckFirstPanel, { receipts: empty, letterCheck: LETTER_NOT_ATTACHED_CHECK }))).toContain("Check these 1 thing");
  });

  it("the page hands the panel the check from the content, and the run no longer stores the line in the reviewer notes", () => {
    const page = readFileSync(join(process.cwd(), "src/app/dashboard/proposals/[id]/page.tsx"), "utf8");
    expect(page).toContain("<CheckFirstPanel receipts={card.receipts} letterCheck={pendingLetterCheck(content)?.text ?? null} />");
    expect(page).toContain("editorLetterState({ read: letterRead, attached: content.loe, pending: hasPendingLetterCheck(content) })");
    const run = readFileSync(join(process.cwd(), "src/lib/consult-proposal/run.ts"), "utf8");
    expect(run).toContain("notes: draft.reviewerNotes,");
    expect(run).toContain("queueSummary(queueNotes, staffUrl, draft.issues)");
  });
});
