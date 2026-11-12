import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EngagementLetterSlot } from "@/components/proposal-editor/EngagementLetterSlot";
import { UnsavedGuardProvider } from "@/components/proposal-editor/UnsavedGuard";
import { editorLetterState, letterCopyCheck, wantedFromForm } from "@/lib/loe/editor-state";
import { runSaveDraft, type SaveDraftDeps } from "@/lib/proposal-editor/save-draft";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import { DRAFT_FORM_ID } from "@/lib/proposal-editor/unsaved";
import { loeIsCurrent, withLoeSnapshot, type ApprovedLetter } from "@/lib/proposals/loe-snapshot";
import type { ProposalContent, ProposalRow } from "@/lib/proposals/types";
import type { ApprovedRead } from "@/lib/loe/templates-store";
import { sevetri } from "../proposals/fixture";
import { faithe } from "../proposals/general-fixture";
import { fullLetterBody } from "./full-letter-fixture";
import { renderLetter } from "@/lib/loe/render";
import { PLACEHOLDER_VALUES } from "@/lib/loe/editor-state";
import { GENERAL_LETTER_BODY } from "./signed-fixtures";
import { withLoe } from "./loe-fixtures";

/** P1a, P1c and the unsaved-changes guard: the editor's Engagement letter section and the Save that refreshes its copy. */

const APPROVED: ApprovedLetter = { id: "11111111-1111-4111-8111-111111111111", kind: "trademark", version: 3, title: "Engagement letter", body: fullLetterBody() };
const NEWER: ApprovedLetter = { ...APPROVED, id: "33333333-3333-4333-8333-333333333333", version: 4, body: `${fullLetterBody()}\n\nA new closing paragraph.` };
const ok = (letter: ApprovedLetter | null): ApprovedRead => ({ status: "ok", letter });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function draw(read: ApprovedRead | null, attached: ProposalContent["loe"], editable = true, guard = false) {
  const state = editorLetterState({ read, attached });
  const slot = createElement(EngagementLetterSlot, { state, editable });
  const inner = guard ? createElement(UnsavedGuardProvider, { initial: { dirty: true } }, slot) : slot;
  return renderToStaticMarkup(createElement("form", { id: DRAFT_FORM_ID }, inner));
}

const ATTACHED = withLoe(sevetri()).loe;

describe("P1c: the four states each render, and the unreadable state is not the set-up line", () => {
  it("no approved letter: the set-up line and NO switch (no checkbox input in the markup)", () => {
    for (const read of [ok(null), { status: "not-set-up" } as ApprovedRead]) {
      const html = draw(read, undefined);
      expect(html).toContain('data-letter-state="none"');
      expect(html).toContain("no approved engagement letter");
      expect(html).toContain('href="/dashboard/settings/proposals/engagement-letter"');
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain("Preview the letter");
    }
  });

  it("approved letter, switch on: the switch checked, 'Version 3, approved' and a Preview control", () => {
    const html = draw(ok(APPROVED), ATTACHED);
    expect(html).toContain('data-letter-state="on"');
    expect(html).toMatch(/<input type="checkbox" name="loeOn"[^>]*checked/);
    expect(html).toContain("Version 3, approved");
    expect(html).toContain("Preview the letter");
    expect(html).not.toContain("newer version");
  });

  it("switch off: the switch unchecked and no Preview", () => {
    const html = draw(ok(APPROVED), undefined);
    expect(html).toContain('data-letter-state="off"');
    expect(html).toMatch(/<input type="checkbox" name="loeOn"/);
    expect(html).not.toMatch(/<input type="checkbox" name="loeOn"[^>]*checked/);
    expect(html).not.toContain("Preview the letter");
    expect(html).not.toContain("Version 3, approved");
  });

  it("unreadable: says so, never the set-up line, and no switch", () => {
    const html = draw({ status: "unavailable" }, undefined);
    expect(html).toContain('data-letter-state="unreadable"');
    expect(html).toContain("couldn&#x27;t be loaded");
    expect(html).not.toContain("no approved engagement letter");
    expect(html).not.toContain('type="checkbox"');
  });

  it("a copy that is older than the firm's approved version says a newer one exists", () => {
    const html = draw(ok(NEWER), ATTACHED);
    expect(html).toContain("Your firm has approved a newer version. Save this proposal to use it.");
  });

  it("a version that can no longer be edited shows what it carries, with no switch; one with no letter says so", () => {
    const live = draw(null, ATTACHED, false);
    expect(live).toContain("Version 3, approved");
    expect(live).not.toContain('type="checkbox"');
    const none = draw(null, undefined, false);
    expect(none).toContain("This proposal has no engagement letter.");
  });

  it("a role that can't write (viewer, social media) never gets the switch input", () => {
    const html = draw(ok(APPROVED), ATTACHED, false);
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Your role can read this but not change it.");
  });

  it("the section is never empty markup: every state draws the heading", () => {
    for (const html of [draw(ok(null), undefined), draw({ status: "unavailable" }, undefined), draw(ok(APPROVED), ATTACHED), draw(ok(APPROVED), undefined), draw(null, undefined, false)]) {
      expect(html).toContain('id="pe-sec-letter"');
      expect(html).toContain("Engagement letter");
      expect(html).not.toMatch(/TODO|Coming soon|Lorem/i);
    }
  });
});

describe("Preview the letter", () => {
  it("holds every paragraph of the full-length letter, merge fields as [placeholders], and the version attached", () => {
    const html = draw(ok(APPROVED), ATTACHED);
    const result = renderLetter(fullLetterBody(), PLACEHOLDER_VALUES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.length).toBeGreaterThan(20);
    for (const b of result.blocks) {
      if (b.lead) expect(html, b.lead).toContain(`<strong>${esc(b.lead)}</strong>`);
      for (const line of b.text.split("\n").map((l) => l.trim()).filter(Boolean)) expect(html, line.slice(0, 50)).toContain(esc(line));
    }
    expect(html).toContain("[client&#x27;s name]");
    expect(html).toContain("[date]");
    expect(html).not.toContain("{{");
    expect(html).toContain("Version 3, approved");
  });

  it("is React text: a letter body with markup is shown as characters, never as elements", () => {
    const evil = { ...ATTACHED!, body: "**Lead.** <script>alert(1)</script> {{client_name}}" };
    const html = draw(ok(APPROVED), evil);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("a letter body the renderer refuses shows its problems, not a half letter", () => {
    const html = draw(ok(APPROVED), { ...ATTACHED!, body: "Dear {{client_nam}}" });
    expect(html).toContain("not a merge field");
  });
});

describe("the unsaved-changes guard", () => {
  it("the switch is a field of the editor's one form (the guard listens on that form), and the page says Unsaved changes when it changes", () => {
    const html = draw(ok(APPROVED), ATTACHED, true, true);
    expect(html).toContain(`id="${DRAFT_FORM_ID}"`);
    expect(html.indexOf('name="loeOn"')).toBeGreaterThan(html.indexOf(`id="${DRAFT_FORM_ID}"`));
    expect(html).toContain('name="loeFields" value="1"');
    expect(html).toContain("Unsaved changes");
  });

  it("the existing guard reacts to the same flag: the saved version's 'Turn on the link' waits for a save, and 'Save and create link' says it saves first", async () => {
    vi.resetModules();
    vi.doMock("@/app/dashboard/proposals/[id]/actions", () => ({
      deleteProposalAction: vi.fn(), resetAcceptanceAction: vi.fn(), reviseAction: vi.fn(), sendAction: vi.fn(), unapproveAction: vi.fn(), withdrawAction: vi.fn(),
    }));
    const { Lifecycle } = await import("@/components/proposal-editor/Lifecycle");
    const { UnsavedGuardProvider: Guard } = await import("@/components/proposal-editor/UnsavedGuard");
    const html = renderToStaticMarkup(
      createElement(Guard, { initial: { dirty: true } }, createElement(Lifecycle, { proposalId: "p1", status: "approved", version: 1, canWrite: true, clientUrl: null })),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Turn on the link<\/button>/);
    expect(html).toContain("Save your changes first.");
    vi.doUnmock("@/app/dashboard/proposals/[id]/actions");
  });
});

/* ── Save refreshes the copy (P1a), through the real save path with a fake store ── */

const UPDATED = "2026-10-18T12:00:00Z";
function row(content: ProposalContent): ProposalRow {
  return {
    id: "p1", org_id: "o", family_id: "p1", version: 1, public_token: "t".repeat(43), lead_id: null, matter_id: null,
    client_name: "Sevetri Wilson", client_email: "s@example.com", title: "Trademark Proposal", status: "draft", content,
    expires_on: "2026-11-10", pay_url: null, source: "manual", created_by: null, updated_by: null, approved_by: null, approved_at: null,
    sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: UPDATED, updated_at: UPDATED,
  };
}

function trademarkForm(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    proposalId: "p1", updatedAt: UPDATED,
    fullName: "Sevetri Wilson", firstName: "Sevetri", company: "Prosperall", clientEmail: "s@example.com", title: "Trademark Proposal",
    greeting: "Hi Sevetri, here is your proposal.", recommendation: "Both marks are best.", officeActionNote: "",
    payUrl: "https://pay.example/x", expiresOn: "2026-11-10",
    package: "Concierge", base: "4950", includedClasses: "3", perClass: "825", secondMarkPct: "20", govPerClass: "350",
    adjFields: "1", incFields: "1",
  };
  sevetri().names.forEach((n, b) => {
    const p = `b.${b}.`;
    base[`${p}nameId`] = n.id; base[`${p}name`] = n.name; base[`${p}pkgFields`] = "1";
    n.marks.forEach((m, i) => { base[`${p}mark.${i}.id`] = m.id; base[`${p}mark.${i}.kind`] = m.kind; base[`${p}mark.${i}.desc`] = m.desc; base[`${p}mark.${i}.preselected`] = "on"; });
    n.classes.forEach((k, i) => { base[`${p}class.${i}.id`] = k.id; base[`${p}class.${i}.label`] = k.label; base[`${p}class.${i}.preselected`] = "on"; });
  });
  for (const [k, v] of Object.entries({ ...base, ...over })) f.set(k, v);
  return f;
}

function saveDeps(current: ProposalRow, read: ApprovedRead | (() => ApprovedRead)) {
  const approvedLetter = vi.fn(async () => (typeof read === "function" ? read() : read));
  const update = vi.fn(async () => current);
  const deps: SaveDraftDeps = {
    gate: vi.fn(async () => null),
    getRow: vi.fn(async () => current),
    settingPricing: vi.fn(async () => ({ packages: [] })),
    approvedLetter,
    update,
    describe: proposalActionError,
    revalidate: vi.fn(),
    rand: () => "ab12",
  };
  return { deps, approvedLetter, update };
}
const written = (update: ReturnType<typeof vi.fn>) => (update.mock.calls[0] as unknown as [string, { content: ProposalContent }])[1].content;

describe("P1a: Save attaches, removes and refreshes the copy", () => {
  it("switch on with an approved letter of the right kind: the saved content carries `loe` equal to that version", async () => {
    const { deps, update } = saveDeps(row(sevetri()), ok(APPROVED));
    const r = await runSaveDraft(deps, trademarkForm({ loeFields: "1", loeOn: "on" }));
    expect(r.saved).toBe(true);
    expect(written(update).loe).toEqual({ kind: "trademark", template_id: APPROVED.id, template_version: 3, title: APPROVED.title, body: APPROVED.body });
    expect(deps.approvedLetter).toHaveBeenCalledWith("trademark");
  });

  it("switch off: `loe` is removed", async () => {
    const { deps, update } = saveDeps(row(withLoe(sevetri())), ok(APPROVED));
    await runSaveDraft(deps, trademarkForm({ loeFields: "1" }));
    expect(written(update).loe).toBeUndefined();
    expect("loe" in written(update)).toBe(false);
  });

  it("a re-save after the firm approved a newer version replaces the copy", async () => {
    const current = row(withLoe(sevetri()));
    const { deps, update } = saveDeps(current, ok(NEWER));
    await runSaveDraft(deps, trademarkForm({ loeFields: "1", loeOn: "on" }));
    const loe = written(update).loe!;
    expect(loe.template_id).toBe(NEWER.id);
    expect(loe.template_version).toBe(4);
    expect(loe.body).toBe(NEWER.body);
  });

  it("a save from a form that does not carry the switch keeps the copy as it is (on stays on, off stays off), refreshed from the firm's version", async () => {
    const on = saveDeps(row(withLoe(sevetri())), ok(NEWER));
    await runSaveDraft(on.deps, trademarkForm());
    expect(written(on.update).loe?.template_version).toBe(4);
    const off = saveDeps(row(sevetri()), ok(APPROVED));
    await runSaveDraft(off.deps, trademarkForm());
    expect(written(off.update).loe).toBeUndefined();
  });

  it("a kind mismatch removes `loe`: a general template is never attached to a trademark proposal", () => {
    const general: ApprovedLetter = { id: "22222222-2222-4222-8222-222222222222", kind: "general", version: 1, title: "Engagement letter", body: GENERAL_LETTER_BODY };
    expect(withLoeSnapshot(sevetri(), general, true).loe).toBeUndefined();
    expect(withLoeSnapshot(withLoe(sevetri()), general, true).loe).toBeUndefined();
    expect(withLoeSnapshot(faithe(), general, true).loe?.kind).toBe("general");
    expect(withLoeSnapshot(faithe(), APPROVED, true).loe).toBeUndefined();
  });

  it("no approved letter: the copy is removed even with the switch on", async () => {
    const { deps, update } = saveDeps(row(withLoe(sevetri())), ok(null));
    await runSaveDraft(deps, trademarkForm({ loeFields: "1", loeOn: "on" }));
    expect(written(update).loe).toBeUndefined();
  });

  it("an unreadable approved-letter read: the switch is not changed on a guess (refused), but an unrelated save keeps the copy untouched", async () => {
    const turnOff = saveDeps(row(withLoe(sevetri())), { status: "unavailable" });
    const refused = await runSaveDraft(turnOff.deps, trademarkForm({ loeFields: "1" }));
    expect(refused.error).toContain("couldn't load the firm's letter");
    expect(turnOff.update).not.toHaveBeenCalled();

    const same = saveDeps(row(withLoe(sevetri())), { status: "unavailable" });
    const saved = await runSaveDraft(same.deps, trademarkForm({ loeFields: "1", loeOn: "on" }));
    expect(saved.saved).toBe(true);
    expect(written(same.update).loe?.template_version).toBe(3);
  });

  it("the general kind reads the general letter", async () => {
    const { deps } = saveDeps(row({ ...faithe() }), ok(null));
    const f = new FormData();
    const fields = { proposalId: "p1", updatedAt: UPDATED, fullName: "Faithe Williams", firstName: "Faithe", title: "T", matterTitle: "Management agreement", summary: "S", "item.0.id": "w1", "item.0.label": "Review the agreements", "item.0.hours": "1", "item.0.rate": "500", fee: "500", loeFields: "1", loeOn: "on" };
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    const general: ApprovedLetter = { id: "22222222-2222-4222-8222-222222222222", kind: "general", version: 1, title: "Engagement letter", body: GENERAL_LETTER_BODY };
    const g = saveDeps(row({ ...faithe() }), ok(general));
    const r = await runSaveDraft(g.deps, f);
    expect(r.error).toBeUndefined();
    expect(g.approvedLetter).toHaveBeenCalledWith("general");
    expect(written(g.update).loe).toMatchObject({ kind: "general", template_version: 1 });
    expect(deps.approvedLetter).not.toHaveBeenCalled();
  });

  // The draft whose letter couldn't be attached when it was made (the pending check) has its own file: tests/loe/pending-letter.test.tsx.
  // An earlier test here pinned "left off on purpose" for a switch that merely STARTED off; that was wrong (every Save posts the switch).

  it("helpers: wantedFromForm and letterCopyCheck", () => {
    const f = new FormData();
    expect(wantedFromForm(f, true)).toBe(true);
    expect(wantedFromForm(f, false)).toBe(false);
    f.set("loeFields", "1");
    expect(wantedFromForm(f, true)).toBe(false);
    f.set("loeOn", "on");
    expect(wantedFromForm(f, false)).toBe(true);
    expect(letterCopyCheck(sevetri(), ok(APPROVED))).toBe("no_letter");
    expect(letterCopyCheck(withLoe(sevetri()), ok(APPROVED))).toBe("current");
    expect(letterCopyCheck(withLoe(sevetri()), ok(NEWER))).toBe("stale");
    expect(letterCopyCheck(withLoe(sevetri()), ok(null))).toBe("stale");
    expect(letterCopyCheck(withLoe(sevetri()), { status: "unavailable" })).toBe("unreadable");
    expect(loeIsCurrent(withLoe(sevetri()), APPROVED)).toBe(true);
  });
});
