import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));
import {
  defaultSelection,
  generalItemValue,
  generalValueOverFee,
  isFixedOffer,
  lockedSelectionIds,
  normalizeSelection,
  priceForClassCount,
  quoteHasItems,
  quoteProposal,
} from "@/lib/proposals/pricing";
import { emptyClientClassInput, parseClientClassInput, quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { validateContent } from "@/lib/proposals/validate";
import { publicContent, buildAcceptedSnapshot } from "@/lib/proposals/public";
import { acceptanceHeadline, acceptanceNoteBody } from "@/lib/proposals/accept-followups";
import { CHOOSE_LOE_TEMPLATE, LOE_REFUSAL_TEXT, loeInputFromAcceptedProposal } from "@/lib/proposals/loe-adapter";
import { buildProposalCard } from "@/lib/proposals/card";
import { buildProposalRowView, type ListRowInput } from "@/lib/proposals/list-rows";
import { contentChanges } from "@/lib/proposals/diff";
import { applyGeneralForm, buildGeneralContent, generalFormValues, parseGeneralForm } from "@/lib/proposal-editor/general-form";
import { buildManualEmail } from "@/lib/consult-proposal/manual-email";
import { generalProposalEmailSubject } from "@/lib/consult-proposal/email";
import { proposalTypeHrefs, proposalTypeOf, withProposalType } from "@/lib/proposals/new-picker";
import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { ProposalsTable } from "@/components/proposal-list/ProposalsTable";
import { GENERAL_LOE_SENTENCE, PROPOSAL_TYPE_GENERAL, PROPOSAL_TYPE_TRADEMARK } from "@/lib/ui/words";
import { GENERAL_PRICING_STUB, type AcceptedSnapshot, type ProposalContent, type Selection } from "@/lib/proposals/types";
import { faithe } from "./general-fixture";
import { sevetri } from "./fixture";
import { danielle, OPTIONS } from "./danielle-fixture";
import { fold, WORD_OPTIONS, DESIGN_OPTIONS } from "./mark-fixture";

const rand = (() => {
  let n = 0;
  return () => `r${++n}`;
})();

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FAITHE_FORM = {
  matterTitle: "Management agreement: notice of non-renewal and termination",
  summary: "We will review both management agreements and all correspondence and evidence, then draft your notice.",
  "item.0.label": "Review both management agreements",
  "item.0.hours": "1",
  "item.0.rate": "500",
  "item.1.label": "Review all correspondence and evidence",
  "item.1.hours": "0.5",
  "item.1.rate": "500",
  "item.2.label": "Draft the notice of non-renewal and termination",
  "item.2.hours": "1",
  "item.2.rate": "500",
  "item.3.label": "",
  "item.3.hours": "",
  fee: "500",
  excludes: "Litigation or arbitration\n\n",
  termsNote: "Anything further depending on how they respond: we'll talk first and agree a plan.",
};

function snapshotOf(content: ProposalContent): AcceptedSnapshot {
  const quote = quoteProposal(content, {});
  return buildAcceptedSnapshot({ version: 1, content, selection: {}, quote, acceptedAt: "2026-11-02T15:00:00.000Z" });
}

/* ─────────────────────────── the quote ─────────────────────────── */

describe("Spec 9 quote: Faithe Williams, value $1,250, fee $500", () => {
  it("charges the flat fee, no USPTO fee, no classes, and carries the value", () => {
    const q = quoteProposal(faithe(), {});
    expect(q.legal_subtotal_cents).toBe(50_000);
    expect(q.legal_total_cents).toBe(50_000);
    expect(q.gov_total_cents).toBe(0);
    expect(q.gov_class_count).toBe(0);
    expect(q.names).toEqual([]);
    expect(q.general).toEqual({
      value_cents: 125_000,
      fee_cents: 50_000,
      items: [
        { label: "Review both management agreements", hours: 1, value_cents: 50_000 },
        { label: "Review all correspondence and evidence", hours: 0.5, value_cents: 25_000 },
        { label: "Draft the notice of non-renewal and termination", hours: 1, value_cents: 50_000 },
      ],
    });
    expect(quoteHasItems(q)).toBe(true);
    expect(generalValueOverFee(q)).toEqual({ value_cents: 125_000, fee_cents: 50_000 });
  });

  it("an item's value is hours x rate when both are given, else its own value", () => {
    expect(generalItemValue({ hours: 2.5, rate_cents: 50_000 })).toBe(125_000);
    expect(generalItemValue({ hours: 0.25, rate_cents: 33_333 })).toBe(8_333);
    expect(generalItemValue({ value_cents: 40_000 })).toBe(40_000);
    expect(generalItemValue({ hours: 1, value_cents: 40_000 })).toBe(40_000);
    expect(generalItemValue({ hours: 0.3, rate_cents: 50_000 })).toBe(0);
    expect(generalItemValue({})).toBe(0);
  });

  it("the selection is ignored: nothing on a flat-fee proposal is selectable", () => {
    const c = faithe();
    expect(quoteProposal(c, { anything: true, packages: { x: "Concierge" } } as Selection)).toEqual(quoteProposal(c, {}));
    expect(defaultSelection(c)).toEqual({});
    expect(normalizeSelection(c, { anything: true })).toEqual({});
    expect(isFixedOffer(c)).toBe(false);
    expect(lockedSelectionIds(c, {}).size).toBe(0);
  });

  it("a consult credit comes off the fee like on any proposal", () => {
    const c = faithe();
    c.adjustments = [{ id: "credit", label: "Consult credit", kind: "amount", value: 10_000 }];
    const q = quoteProposal(c, {});
    expect(q.legal_subtotal_cents).toBe(50_000);
    expect(q.discount_cents).toBe(10_000);
    expect(q.legal_total_cents).toBe(40_000);
    expect(q.gov_total_cents).toBe(0);
  });

  it("value never above the fee shows just the fee; a zero fee has nothing to accept", () => {
    const c = faithe();
    c.general!.fee_cents = 125_000;
    expect(generalValueOverFee(quoteProposal(c, {}))).toBeNull();
    c.general!.fee_cents = 0;
    expect(quoteHasItems(quoteProposal(c, {}))).toBe(false);
  });

  it("a trademark quote never carries a general block", () => {
    expect(quoteProposal(sevetri(), defaultSelection(sevetri())).general).toBeUndefined();
  });
});

/* ─────────────────────────── validation ─────────────────────────── */

describe("Spec 9 validation", () => {
  const errors = (c: unknown, opts = {}) => validateContent(c, opts).filter((i) => i.level === "error");

  it("Faithe's proposal is clean, for approval too", () => {
    expect(validateContent(faithe())).toEqual([]);
    expect(errors(faithe(), { forApproval: true, expires_on: "2026-11-16", pay_url: "https://pay.example.com/x", client_email: "faithe@example.com" })).toEqual([]);
  });

  it("refuses trademark names with classes, a USPTO fee, a package price and a package list", () => {
    const withNames = faithe();
    withNames.names = sevetri().names;
    expect(errors(withNames).map((i) => i.path)).toContain("names");
    const withGov = faithe();
    withGov.pricing = { ...GENERAL_PRICING_STUB, gov_per_class_cents: 35_000 };
    expect(errors(withGov).map((i) => i.path)).toContain("pricing.gov_per_class_cents");
    const withPrice = faithe();
    withPrice.pricing = { ...GENERAL_PRICING_STUB, base_cents: 495_000 };
    expect(errors(withPrice).map((i) => i.path)).toContain("pricing.base_cents");
    const withPackages = faithe();
    withPackages.packages = danielle().packages;
    expect(errors(withPackages).map((i) => i.path)).toContain("packages");
  });

  it("checks the matter, the work, the fee, the not-included lines and the terms note", () => {
    const c = faithe() as unknown as { general: Record<string, unknown> };
    c.general.matter_title = "";
    c.general.fee_cents = 0;
    c.general.items = [
      { id: "a", label: "", hours: 0.3 },
      { id: "a", label: "x".repeat(201), rate_cents: 100 },
      { id: "b", label: "ok", value_cents: -1 },
    ];
    c.general.excludes = ["", "y".repeat(201)];
    c.general.terms_note = "z".repeat(601);
    const paths = errors(c).map((i) => i.path);
    for (const p of [
      "general.matter_title",
      "general.fee_cents",
      "general.items[0].label",
      "general.items[0].hours",
      "general.items[1].id",
      "general.items[1].label",
      "general.items[1].rate_cents",
      "general.items[2].value_cents",
      "general.excludes[0]",
      "general.excludes[1]",
      "general.terms_note",
    ]) {
      expect(paths, p).toContain(p);
    }
    const none = faithe();
    none.general!.items = [];
    expect(errors(none).map((i) => i.path)).toContain("general.items");
    const tooMany = faithe();
    tooMany.general!.items = Array.from({ length: 21 }, (_, i) => ({ id: `w${i}`, label: `Work ${i}`, value_cents: 100 }));
    expect(errors(tooMany).map((i) => i.path)).toContain("general.items");
  });

  it("an unknown kind is refused; a trademark proposal carrying a general block is refused", () => {
    expect(errors({ ...faithe(), kind: "patent" }).map((i) => i.path)).toEqual(["kind"]);
    expect(errors({ ...sevetri(), general: faithe().general }).map((i) => i.path)).toContain("general");
    expect(errors({ ...sevetri(), kind: "trademark" })).toEqual(errors(sevetri()));
  });
});

/* ─────────────────────────── the form ─────────────────────────── */

describe("Spec 9 form parsing", () => {
  it("reads Faithe's form into the block, skipping the blank spare row", () => {
    const r = parseGeneralForm(form(FAITHE_FORM), rand);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.matter_title).toBe("Management agreement: notice of non-renewal and termination");
    expect(r.value.fee_cents).toBe(50_000);
    expect(r.value.items.map((i) => [i.label, i.hours, i.rate_cents])).toEqual([
      ["Review both management agreements", 1, 50_000],
      ["Review all correspondence and evidence", 0.5, 50_000],
      ["Draft the notice of non-renewal and termination", 1, 50_000],
    ]);
    expect(r.value.excludes).toEqual(["Litigation or arbitration"]);
    const content = buildGeneralContent({ firstName: "Faithe", fullName: "Faithe Williams", general: r.value });
    expect(validateContent(content)).toEqual([]);
    const q = quoteProposal(content, {});
    expect([q.legal_total_cents, q.gov_total_cents, q.general?.value_cents]).toEqual([50_000, 0, 125_000]);
    expect(content.kind).toBe("general");
    expect(content.names).toEqual([]);
    expect(content.greeting).not.toMatch(/strategy call/);
  });

  it("refuses with one fixed sentence: no work, no fee, bad hours, a rate without hours, a label-less row", () => {
    const bad = (over: Record<string, string>) => {
      const r = parseGeneralForm(form({ ...FAITHE_FORM, ...over }), rand);
      return r.ok ? null : r.error;
    };
    expect(bad({ matterTitle: "" })).toBe("Matter: name the matter.");
    expect(bad({ fee: "0" })).toBe("Flat fee: enter an amount above zero.");
    expect(bad({ fee: "abc" })).toMatch(/^Flat fee: enter a dollar amount/);
    expect(bad({ "item.0.hours": "0.3" })).toMatch(/^Work 1: hours go in quarter-hour steps/);
    expect(bad({ "item.1.hours": "" })).toBe("Work 2: give the hours with the hourly rate, or a value instead.");
    expect(bad({ "item.2.label": "" })).toBe("Work 3: say what this piece of work is.");
    const empty = parseGeneralForm(form({ matterTitle: "M", fee: "500", "item.0.label": "" }), rand);
    expect(empty).toEqual({ ok: false, error: "Add at least one piece of work." });
  });

  it("the editor's save keeps the rest of the document, and refuses a trademark proposal", () => {
    const current = faithe();
    const r = applyGeneralForm(form({ ...FAITHE_FORM, fee: "650", greeting: "Hello Faithe." }), current, rand);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.general?.fee_cents).toBe(65_000);
    expect(r.value.greeting).toBe("Hello Faithe.");
    expect(r.value.client).toEqual(current.client);
    expect(applyGeneralForm(form(FAITHE_FORM), sevetri(), rand)).toEqual({
      ok: false,
      error: "This is a trademark proposal. Its matter and flat fee can't be set here.",
    });
  });

  it("the editor's inputs are pre-filled from the saved block in dollars", () => {
    const v = generalFormValues(faithe().general);
    expect(v.fee).toBe("500.00");
    expect(v.items[1]).toMatchObject({ label: "Review all correspondence and evidence", hours: "0.5", rate: "500.00", value: "" });
    expect(v.excludes).toBe("Litigation or arbitration");
  });

  it("the history names a change to the fee", () => {
    const after = faithe();
    after.general!.fee_cents = 65_000;
    expect(contentChanges(faithe(), after)).toEqual([expect.objectContaining({ path: "general.fee_cents", label: "Flat fee", before: 50_000, after: 65_000 })]);
  });
});

/* ─────────────────────────── New proposal's type switch ─────────────────────────── */

describe("New proposal's Type choice", () => {
  it("defaults to the trademark form; only exactly 'general' is the flat-fee form", () => {
    expect(proposalTypeOf(undefined)).toBe("trademark");
    expect(proposalTypeOf("General")).toBe("trademark");
    expect(proposalTypeOf(["general"])).toBe("general");
    expect(PROPOSAL_TYPE_TRADEMARK).toBe("Trademark filing");
    expect(PROPOSAL_TYPE_GENERAL).toBe("Contract or other matter (flat fee)");
  });

  it("keeps the chosen lead or matter, and the trademark link is unchanged", () => {
    expect(proposalTypeHrefs({})).toEqual({ trademark: "/dashboard/proposals/new/", general: "/dashboard/proposals/new/?type=general" });
    expect(proposalTypeHrefs({ lead: "a b" })).toEqual({
      trademark: "/dashboard/proposals/new/?lead=a%20b",
      general: "/dashboard/proposals/new/?lead=a%20b&type=general",
    });
    expect(withProposalType("/x/?lead=1", "trademark")).toBe("/x/?lead=1");
  });
});

/* ─────────────────────────── the client page ─────────────────────────── */

describe("the client page for a flat-fee proposal", () => {
  const page = (mode: "live" | "preview" | "accepted" = "live") =>
    renderToStaticMarkup(
      createElement(ProposalDocument, {
        content: publicContent(faithe()),
        title: "Proposal",
        clientName: "Faithe Williams",
        expiresOn: "2026-11-16",
        firm: { name: "Hartwell", slug: "hartwell", displayName: "Hartwell Law" },
        mode,
        ...(mode === "accepted" ? { acceptedQuote: quoteProposal(faithe(), {}), payUrl: "https://pay.example.com/x" } : { onAccept: async () => ({ ok: true as const, payUrl: "https://pay.example.com/x" }) }),
      }),
    ).replaceAll("&#x27;", "'");

  it("shows the matter, the work with hours, not-included, the terms note and value vs fee", () => {
    const html = page();
    expect(html).toContain("Management agreement: notice of non-renewal and termination");
    expect(html).toContain("Review both management agreements");
    expect(html).toContain("0.5 hrs");
    expect(html).toContain("Not included");
    expect(html).toContain("Litigation or arbitration");
    expect(html).toContain("we'll talk first and agree a plan");
    expect(html).toContain("$1,250");
    expect(html).toContain("$500");
    expect(html).toContain("Accept and pay my fee");
    expect(html).toContain("By accepting, you agree to Hartwell Law starting the work described above for the fee shown.");
  });

  it("has no USPTO fee, no class, no package and no trademark words", () => {
    for (const mode of ["live", "preview", "accepted"] as const) {
      const text = page(mode).replace(/<[^>]+>/g, " ");
      expect(text, mode).not.toMatch(/USPTO/i);
      expect(text, mode).not.toMatch(/\bclass(es)?\b/i);
      expect(text, mode).not.toMatch(/\bpackage\b/i);
      expect(text, mode).not.toMatch(/trademark/i);
    }
  });

  it("only root-relative /_next/static or /brand assets", () => {
    const html = renderToStaticMarkup(
      createElement(ProposalDocument, { content: faithe(), title: "Proposal", clientName: "Faithe Williams", expiresOn: null, firm: { name: "RPB Law Firm", slug: "rpb-law" }, mode: "live" }),
    );
    for (const m of html.matchAll(/src="(\/[^"]*)"/g)) expect(m[1]).toMatch(/^\/(?:_next\/static|brand)\//);
  });

  it("a receipt thanks the client and offers the pay link", () => {
    const html = page("accepted");
    expect(html).toContain("Your acceptance is recorded.");
    expect(html).toContain("Pay my fee");
  });

  it("the public allowlist keeps the general block and drops anything else", () => {
    const raw = { ...faithe(), private: { matter_id: "x" } } as unknown as Record<string, unknown>;
    (raw.general as Record<string, unknown>).secret = "no";
    (raw.general as { items: Array<Record<string, unknown>> }).items[0].internal = "no";
    const pub = publicContent(raw) as unknown as Record<string, unknown>;
    expect(pub.kind).toBe("general");
    expect(pub.private).toBeUndefined();
    expect((pub.general as Record<string, unknown>).secret).toBeUndefined();
    expect((pub.general as { items: Array<Record<string, unknown>> }).items[0].internal).toBeUndefined();
    expect(quoteProposal(pub as unknown as ProposalContent, {})).toEqual(quoteProposal(faithe(), {}));
  });
});

/* ─────────────────────────── the accept path (pure part) ─────────────────────────── */

describe("the accept path prices a flat-fee proposal from the stored content", () => {
  it("an empty selection and nothing written: the fee, recomputed, and something to accept", () => {
    const content = faithe();
    const picked = normalizeSelection(content, { "w-contracts": true, price: 1 });
    const input = parseClientClassInput(content, { entries: { x: "y" }, added: { n: ["z"] } });
    expect(input).toEqual(emptyClientClassInput());
    const priced = quoteWithClientClasses(content, picked, input, { repair: true });
    if (!priced.ok) throw new Error("not ok");
    expect(priced.missing).toEqual([]);
    expect(priced.selection).toEqual({});
    expect(priced.quote.legal_total_cents).toBe(50_000);
    expect(quoteHasItems(priced.quote)).toBe(true);
    expect(priced.content).toEqual(content);
  });
});

/* ─────────────────────────── follow-ups, LOE, list, card, email ─────────────────────────── */

describe("after a flat-fee proposal is accepted", () => {
  const snap = snapshotOf(faithe());

  it("the notice headline names the matter and the fee", () => {
    expect(acceptanceHeadline({ clientName: "Faithe Williams", packageName: "Management agreement: notice of non-renewal and termination", legalTotalCents: 50_000 })).toBe(
      "Faithe Williams accepted Management agreement: notice of non-renewal and termination · legal $500",
    );
  });

  it("the Lawmatics note lists the matter, the work and the fee, with no class lines and no USPTO fee", () => {
    const note = acceptanceNoteBody(snap, "Faithe Williams");
    expect(note.name).toBe("Proposal accepted: Management agreement: notice of non-renewal and termination");
    expect(note.body).toContain("Matter: Management agreement: notice of non-renewal and termination");
    expect(note.body).toContain("- Review all correspondence and evidence (0.5 hrs)");
    expect(note.body).toContain("Flat fee: $500");
    expect(note.body).toContain("Legal fee, due when accepted: $500");
    expect(note.body).not.toMatch(/class|USPTO|Package/i);
  });

  it("the LOE is never the trademark letter: Choose the LOE template, Draft the General LOE", () => {
    const r = loeInputFromAcceptedProposal(snap, { packages: [], todayIso: "2026-11-02" });
    expect(r).toEqual({ ok: false, reason: "general_matter" });
    expect(LOE_REFUSAL_TEXT.general_matter).toBe("Draft the General LOE for this matter.");
    expect(GENERAL_LOE_SENTENCE).toBe(LOE_REFUSAL_TEXT.general_matter);
    expect(CHOOSE_LOE_TEMPLATE).toBe("Choose the LOE template");
  });

  it("the staff card shows the matter, its work and the fee, with no USPTO figure", () => {
    const card = buildProposalCard({ client_name: "Faithe Williams", content: faithe(), expires_on: null }, []);
    expect(card.general).toMatchObject({ matterTitle: "Management agreement: notice of non-renewal and termination", valueCents: 125_000, feeCents: 50_000 });
    expect(card.brands).toEqual([]);
    expect(card.legalAtSigningCents).toBe(50_000);
    expect(card.usptoAtFilingCents).toBe(0);
  });

  it("the list row shows the matter title, the flat fee, and a dash for USPTO", () => {
    const item: ListRowInput = {
      id: "p1",
      family_id: "ab12cd34-0000-4000-8000-000000000000",
      version: 1,
      client_name: "Faithe Williams",
      title: "Proposal",
      status: "sent",
      source: "manual",
      expires_on: "2026-11-16",
      accepted_at: null,
      updated_at: "2026-11-02T13:00:00Z",
      legal_total_cents: 50_000,
      gov_total_cents: 0,
      blocking_issue: null,
      brands: [],
      offered: [],
      class_count: 0,
      signed_package: null,
      package_basis: null,
      matter_title: "Management agreement: notice of non-renewal and termination",
    };
    const view = buildProposalRowView(item, { today: "2026-11-02", tz: "America/New_York", now: Date.parse("2026-11-02T16:00:00Z"), events: new Map(), names: new Map() });
    expect(view.headline).toBe("Proposal — Management agreement: notice of non-renewal and termination");
    expect(view.subline).toBe("pr-ab12cd · Flat fee");
    expect(view.atSigningCents).toBe(50_000);
    expect(view.atFilingCents).toBeNull();
    const html = renderToStaticMarkup(createElement(ProposalsTable, { rows: [view], footerLeft: "", footerRight: "" }));
    // A flat-fee row has no filing line at all (it is omitted, not a dash): one fee, "at signing".
    expect(html).toContain("at signing");
    expect(html).not.toContain("at filing");
    // A trademark row is unchanged.
    const tm = buildProposalRowView({ ...item, matter_title: null, brands: ["Prosperall"], gov_total_cents: 70_000 }, { today: "2026-11-02", tz: "America/New_York", now: 0, events: new Map(), names: new Map() });
    expect(tm.headline).toBe("Proposal — PROSPERALL");
    expect(tm.atFilingCents).toBe(70_000);
  });

  it("the post-consult email is the general one: subject, summary, fee and link, no trademark words", () => {
    const email = buildManualEmail({ content: faithe(), firmName: "RPB Law", proposalUrl: "https://proposals.example.com/p/tok/", signOff: "The RPB Law Team" });
    expect(email.subject).toBe("Your Proposal from RPB Law: Management agreement: notice of non-renewal and termination");
    expect(email.subject).toBe(generalProposalEmailSubject("RPB Law", "Management agreement: notice of non-renewal and termination"));
    expect(email.body).toContain("Hi Faithe,");
    expect(email.body).toContain("We will review both management agreements");
    expect(email.body).toContain("The flat fee for this work is $500.");
    expect(email.body).toContain("https://proposals.example.com/p/tok/");
    expect(email.body).toContain("The RPB Law Team");
    expect(`${email.subject}\n${email.body}`).not.toMatch(/trademark|USPTO|\bclass|\bmark\b|Rebecca/i);
  });
});

/* ─────────────────────────── trademark pricing did not move by a cent ─────────────────────────── */

const BEFORE = "46f47dd";
let oldPricing: string | null = null;
try {
  oldPricing = execSync(`git show ${BEFORE}:src/lib/proposals/pricing.ts`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
} catch {
  oldPricing = null;
}

describe("trademark proposals price byte for byte as before Spec 9", () => {
  it.skipIf(oldPricing === null)("sevetri, danielle and the fold, across many selections, quote exactly as the pre-Spec 9 engine did", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spec9-pricing-"));
    const file = join(dir, "pricing-before.ts");
    writeFileSync(file, oldPricing!);
    const before = (await import(/* @vite-ignore */ file)) as typeof import("@/lib/proposals/pricing");
    const cases: Array<[ProposalContent, Selection]> = [];
    const allSubsets = (content: ProposalContent) => {
      const ids = Object.keys(before.defaultSelection(content)).filter((k) => k !== "packages");
      const out: Selection[] = [];
      for (let mask = 0; mask < Math.min(1 << ids.length, 256); mask++) {
        out.push(Object.fromEntries(ids.map((id, i) => [id, (mask >> i) % 2 === 1])));
      }
      return out;
    };
    const s = sevetri();
    for (const sel of allSubsets(s)) cases.push([s, sel]);
    const credited = sevetri();
    credited.adjustments = [
      { id: "a", label: "Consult credit", kind: "amount", value: 25_000 },
      { id: "b", label: "Event", kind: "percent", value: 10 },
    ];
    for (const sel of allSubsets(credited).slice(0, 64)) cases.push([credited, sel]);
    const custom = sevetri();
    custom.pricing.reduce_under_included = true;
    for (const sel of allSubsets(custom).slice(0, 64)) cases.push([custom, sel]);
    const d = danielle();
    for (const p of OPTIONS) for (const q of OPTIONS) cases.push([d, { ...before.defaultSelection(d), packages: { fold: p, ci: q } }]);
    const f = fold();
    for (const w of WORD_OPTIONS) for (const lg of DESIGN_OPTIONS) for (const on of [true, false]) {
      cases.push([f, { ...before.defaultSelection(f), "fold-logo": on, packages: { "fold-word": w, "fold-logo": lg } }]);
    }
    expect(cases.length).toBeGreaterThan(200);
    for (const [content, selection] of cases) {
      expect(JSON.stringify(quoteProposal(content, selection))).toBe(JSON.stringify(before.quoteProposal(content, selection)));
      expect(JSON.stringify(defaultSelection(content))).toBe(JSON.stringify(before.defaultSelection(content)));
      expect(JSON.stringify(normalizeSelection(content, selection))).toBe(JSON.stringify(before.normalizeSelection(content, selection)));
      expect(isFixedOffer(content)).toBe(before.isFixedOffer(content));
      const q = quoteProposal(content, selection);
      expect(quoteHasItems(q)).toBe(before.quoteHasItems(before.quoteProposal(content, selection)));
      expect([...lockedSelectionIds(content, selection)]).toEqual([...before.lockedSelectionIds(content, selection)]);
    }
    for (let n = 0; n <= 5; n++) expect(priceForClassCount(s.pricing, n)).toBe(before.priceForClassCount(s.pricing, n));
  });
});
