import { describe, it, expect, vi } from "vitest";
import { applyPackagesToAll, brandForm, brandIndexes, runSaveDraft, type SaveDraftDeps } from "@/lib/proposal-editor/save-draft";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import { PROPOSAL_SAVE_CONFLICT } from "@/lib/proposals/store";
import type { ProposalRow } from "@/lib/proposals/types";
import { faithe } from "../proposals/general-fixture";
import { sevetri } from "../proposals/fixture";

const UPDATED = "2026-10-18T12:00:00Z";

function row(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: "p1", org_id: "o", family_id: "p1", version: 1, public_token: "t".repeat(43), lead_id: null, matter_id: null,
    client_name: "Sevetri Wilson", client_email: "s@example.com", title: "Trademark Proposal", status: "draft", content: sevetri(),
    expires_on: "2026-11-10", pay_url: null, source: "manual", created_by: null, updated_by: null, approved_by: null, approved_at: null,
    sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: UPDATED, updated_at: UPDATED, ...over,
  };
}

function deps(over: Partial<SaveDraftDeps> = {}, r: ProposalRow = row()) {
  const d: SaveDraftDeps = {
    gate: vi.fn(async () => null),
    getRow: vi.fn(async () => r),
    settingPricing: vi.fn(async () => ({ packages: [] })),
    update: vi.fn(async () => ({ ...r, status: r.status })),
    describe: proposalActionError,
    revalidate: vi.fn(),
    rand: () => "ab12",
    ...over,
  };
  return d;
}

/** What the editor posts for the Sevetri fixture: both brands, every section. */
function form(over: Record<string, string> = {}, drop: string[] = []): FormData {
  const f = new FormData();
  const set = (k: string, v: string) => f.set(k, v);
  const base: Record<string, string> = {
    proposalId: "p1", updatedAt: UPDATED,
    fullName: "Sevetri Wilson", firstName: "Sevetri", company: "Prosperall", clientEmail: "s@example.com", title: "Trademark Proposal",
    greeting: "Hi Sevetri, here is your proposal.", recommendation: "Both marks are best.", officeActionNote: "",
    payUrl: "https://pay.example/x", expiresOn: "2026-11-10",
    package: "Concierge", base: "4950", includedClasses: "3", perClass: "825", secondMarkPct: "20", govPerClass: "350",
    adjFields: "1", incFields: "1",
  };
  const c = sevetri();
  c.names.forEach((n, b) => {
    const p = `b.${b}.`;
    base[`${p}nameId`] = n.id; base[`${p}name`] = n.name; base[`${p}pkgFields`] = "1";
    n.marks.forEach((m, i) => { base[`${p}mark.${i}.id`] = m.id; base[`${p}mark.${i}.kind`] = m.kind; base[`${p}mark.${i}.desc`] = m.desc; base[`${p}mark.${i}.preselected`] = "on"; });
    n.classes.forEach((k, i) => { base[`${p}class.${i}.id`] = k.id; base[`${p}class.${i}.label`] = k.label; base[`${p}class.${i}.preselected`] = "on"; });
  });
  for (const [k, v] of Object.entries({ ...base, ...over })) if (!drop.includes(k)) set(k, v);
  return f;
}

describe("runSaveDraft: one post, one write (F2)", () => {
  it("a changed client email, a brand's package choice, the pay link and the greeting make ONE updateProposal call carrying all four", async () => {
    const d = deps();
    const r = await runSaveDraft(
      d,
      form({
        clientEmail: "new@example.com",
        greeting: "A new greeting.",
        payUrl: "https://pay.example/new",
        "b.0.pkgChoice": "on",
        "b.0.pkgOption": "Concierge",
        "b.0.pkgDefault": "Concierge",
      }),
    );
    expect(r).toEqual({ saved: true });
    expect(d.update).toHaveBeenCalledTimes(1);
    const [id, input, opts] = (d.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe("p1");
    expect(opts).toEqual({ expectedUpdatedAt: UPDATED });
    expect(input.clientEmail).toBe("new@example.com");
    expect(input.payUrl).toBe("https://pay.example/new");
    expect(input.content.greeting).toBe("A new greeting.");
    expect(input.content.names[0].package_choice).toEqual({ options: ["Concierge"], default: "Concierge" });
    expect(input.content.names[1].package_choice).toBeUndefined();
    // a package choice reads the firm's current list (once) so the proposal carries its snapshot
    expect(d.settingPricing).toHaveBeenCalledTimes(1);
    expect(d.revalidate).toHaveBeenCalledWith("p1");
  });

  it("a stale updated_at: the store's conflict comes back as the conflict sentence, with no second write", async () => {
    const { ProposalError } = await import("@/lib/proposals/errors");
    const d = deps({ update: vi.fn(async () => { throw new ProposalError("conflict", PROPOSAL_SAVE_CONFLICT); }) });
    const r = await runSaveDraft(d, form());
    expect(r.error).toBe(PROPOSAL_SAVE_CONFLICT);
    expect(d.update).toHaveBeenCalledTimes(1);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("a missing updatedAt is refused before any read", async () => {
    const d = deps();
    const r = await runSaveDraft(d, form({}, ["updatedAt"]));
    expect(r.error).toBe(PROPOSAL_SAVE_CONFLICT);
    expect(d.getRow).not.toHaveBeenCalled();
    expect(d.update).not.toHaveBeenCalled();
  });

  it("the gate runs first: a refusal returns before any read", async () => {
    const d = deps({ gate: vi.fn(async () => ({ error: "Your role can't change proposals." })) });
    const r = await runSaveDraft(d, form());
    expect(r.error).toMatch(/role/);
    expect(d.getRow).not.toHaveBeenCalled();
  });

  it("a row that is not there is 'not found' and nothing is written", async () => {
    const d = deps({ getRow: vi.fn(async () => null) });
    expect((await runSaveDraft(d, form())).error).toBe("Proposal not found.");
    expect(d.update).not.toHaveBeenCalled();
  });

  it("saving a saved (approved) version says it went back to draft", async () => {
    const approved = row({ status: "approved" });
    const d = deps({ update: vi.fn(async () => ({ ...approved, status: "draft" as const })) }, approved);
    const r = await runSaveDraft(d, form());
    expect(r.saved).toBe(true);
    expect(r.notice).toMatch(/back to draft/);
  });

  it("an unreadable firm package list saves nothing when a brand offers a choice", async () => {
    const d = deps({ settingPricing: vi.fn(async () => { throw new Error("x"); }) });
    const r = await runSaveDraft(d, form({ "b.0.pkgChoice": "on", "b.0.pkgOption": "Concierge", "b.0.pkgDefault": "Concierge" }));
    expect(r.error).toBe("Couldn't load the firm's packages. Try again.");
    expect(d.update).not.toHaveBeenCalled();
  });
});

describe("runSaveDraft: a refusal names the section and the field, and writes nothing (F3)", () => {
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ["a bad brand discount", { "b.1.discountPct": "70" }, /^Brand name Tech4PublicGood: Discount on this brand name: enter a whole percent/],
    ["a missing client name", { fullName: "" }, /^Who: Client name: /],
    ["bad money in the package numbers", { base: "abc" }, /^Fees and payment: Base price: enter a dollar amount/],
    ["a bad expiry date", { expiresOn: "2026-02-31" }, /^Who: Expiry date/],
    ["a brand with no name", { "b.0.name": "" }, /^Brand name 1: Brand name: enter the name being protected/],
  ];
  for (const [label, over, re] of cases) {
    it(label, async () => {
      const d = deps();
      const r = await runSaveDraft(d, form(over));
      expect(r.error).toMatch(re);
      expect(d.update).not.toHaveBeenCalled();
    });
  }
});

describe("runSaveDraft: a flat-fee draft saves through the same action (F6)", () => {
  it("calls the general parser and carries the matter, fee and credits in one write", async () => {
    const r0 = row({ content: faithe() });
    const d = deps({}, r0);
    const f = new FormData();
    for (const [k, v] of Object.entries({
      proposalId: "p1", updatedAt: UPDATED, fullName: "Faithe Williams", firstName: "Faithe", title: "Proposal", clientEmail: "f@example.com",
      greeting: "Hello Faithe.", matterTitle: "Contractor agreement", summary: "", fee: "500", excludes: "", termsNote: "",
      "item.0.id": "w1", "item.0.label": "Review", "item.0.hours": "2.5", "item.0.rate": "500", "item.0.value": "",
      payUrl: "https://pay.example/g", expiresOn: "2026-11-10", adjFields: "1",
    })) f.set(k, v);
    const r = await runSaveDraft(d, f);
    expect(r.error).toBeUndefined();
    expect(d.update).toHaveBeenCalledTimes(1);
    const input = (d.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(input.content.general.matter_title).toBe("Contractor agreement");
    expect(input.content.general.fee_cents).toBe(50_000);
    expect(input.content.names).toEqual([]);
  });
});

describe("Use these package options for every brand (D6)", () => {
  it("copies the ticked brand's package choice to the others on save", async () => {
    const d = deps();
    const r = await runSaveDraft(
      d,
      form({ "b.0.pkgChoice": "on", "b.0.pkgOption": "Concierge", "b.0.pkgDefault": "Concierge", "b.0.applyAll": "on" }),
    );
    expect(r.saved).toBe(true);
    const names = (d.update as ReturnType<typeof vi.fn>).mock.calls[0][1].content.names;
    expect(names[1].package_choice).toEqual(names[0].package_choice);
  });

  it("refuses, by brand name, when another brand has its own price", () => {
    const c = sevetri();
    c.names[0].package_choice = { options: ["Concierge"], default: "Concierge" };
    c.names[1].price_override = { base_cents: 100 };
    const r = applyPackagesToAll(c.names, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Brand name Tech4PublicGood: it has its own price/);
  });

  it("per-mark choices are copied mark by mark", () => {
    const c = sevetri();
    c.names[0].marks[0].package_choice = { options: ["Essential"], default: "Essential" };
    const r = applyPackagesToAll(c.names, 0);
    expect(r.ok && r.value[1].marks[0].package_choice).toEqual({ options: ["Essential"], default: "Essential" });
  });
});

describe("brand field helpers", () => {
  it("strips the b.<n>. prefix and lists the indexes in order", () => {
    const f = new FormData();
    f.set("b.1.nameId", "t"); f.set("b.0.nameId", "p"); f.set("b.1.name", "T"); f.set("greeting", "x");
    expect(brandIndexes(f)).toEqual([0, 1]);
    expect([...brandForm(f, 1).entries()]).toEqual([["nameId", "t"], ["name", "T"]]);
  });
});
