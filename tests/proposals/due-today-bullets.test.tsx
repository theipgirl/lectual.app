import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { execSync } from "node:child_process";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { GeneralProposalDocument } from "@/components/client-proposal/GeneralProposalDocument";
import { activePaymentTerms, dueToday } from "@/lib/proposals/due-today";
import { acceptedDueToday, staffDueTodayLine } from "@/lib/proposals/due-today-staff";
import { feeSummary, sectionFigures, usesWorkSections } from "@/lib/proposals/general-sections";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { validateContent } from "@/lib/proposals/validate";
import { buildAcceptedSnapshot, publicContent } from "@/lib/proposals/public";
import { buildProposalCard } from "@/lib/proposals/card";
import { money } from "@/components/client-proposal/format";
import { parsePackageChoiceFields } from "@/lib/proposal-editor/form";
import { applyGeneralForm, generalFormValues, parseGeneralForm } from "@/lib/proposal-editor/general-form";
import { applyPaymentTermsForm, parsePaymentTermsFields } from "@/lib/proposal-editor/payment-terms-form";
import { MAX_PACKAGE_CHOICE_OPTIONS, type ProposalContent } from "@/lib/proposals/types";
import { callum } from "./fixture";
import { imogen } from "./general-fixture";
import { ESSENTIAL, renata } from "./renata-fixture";

const errorPaths = (c: unknown) => validateContent(c).filter((i) => i.level === "error").map((i) => i.path);
const accept = async () => ({ ok: true as const, payUrl: "https://example.com/pay" });
const FIRM = { name: "RPB Law", slug: "rpb-law" };

function renderTrademark(content: ProposalContent, state: "live" | "accepted"): string {
  const common = { content, title: "Trademark Proposal", clientName: "Callum Ferreira", expiresOn: "2026-12-01", firm: FIRM };
  if (state === "live") return renderToStaticMarkup(<ProposalDocument {...common} mode="live" onAccept={accept} />);
  const selection = defaultSelection(content);
  return renderToStaticMarkup(
    <ProposalDocument {...common} mode="accepted" initialSelection={selection} acceptedQuote={quoteProposal(content, selection)} payUrl="https://example.com/pay" />,
  );
}

function renderGeneral(content: ProposalContent, state: "live" | "accepted"): string {
  const common = { content, title: "Proposal", clientName: "Imogen Pellegrino", expiresOn: "2026-12-01", firm: FIRM };
  if (state === "live") return renderToStaticMarkup(<GeneralProposalDocument {...common} mode="live" onAccept={accept} />);
  return renderToStaticMarkup(
    <GeneralProposalDocument {...common} mode="accepted" initialSelection={{}} acceptedQuote={quoteProposal(content, {})} payUrl="https://example.com/pay" />,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

/* ─────────────────────────── Feature B: the math ─────────────────────────── */

describe("dueToday", () => {
  it("50% of $3,465 is $1,732.50 today and $1,732.50 later", () => {
    expect(dueToday({ legal_total_cents: 346_500 }, { due_now_pct: 50 })).toEqual({ total_cents: 346_500, due_now_cents: 173_250, balance_cents: 173_250 });
  });

  it("odd cents round once, and today + balance always equals the total", () => {
    expect(dueToday({ legal_total_cents: 100_001 }, { due_now_pct: 50 })).toEqual({ total_cents: 100_001, due_now_cents: 50_001, balance_cents: 50_000 });
    for (const total of [1, 99, 333, 100_001, 346_599, 999_999]) {
      for (const pct of [1, 7, 33, 50, 67, 99, 100]) {
        const s = dueToday({ legal_total_cents: total }, { due_now_pct: pct });
        expect(Number.isInteger(s.due_now_cents)).toBe(true);
        expect(s.due_now_cents + s.balance_cents).toBe(total);
        expect(s.due_now_cents).toBe(Math.round((total * pct) / 100));
      }
    }
  });

  it("100% and absent terms: the whole total today, no balance; and no active terms", () => {
    expect(dueToday({ legal_total_cents: 346_500 }, { due_now_pct: 100 })).toEqual({ total_cents: 346_500, due_now_cents: 346_500, balance_cents: 0 });
    expect(dueToday({ legal_total_cents: 346_500 }, undefined)).toEqual({ total_cents: 346_500, due_now_cents: 346_500, balance_cents: 0 });
    expect(activePaymentTerms({ payment_terms: { due_now_pct: 100 } })).toBeNull();
    expect(activePaymentTerms({})).toBeNull();
    expect(activePaymentTerms({ payment_terms: { due_now_pct: 50, balance_note: " upon delivery " } })).toEqual({ due_now_pct: 50, balance_note: "upon delivery" });
  });

  it("is a new file: pricing.ts has no diff", () => {
    expect(execSync("git diff HEAD --stat -- src/lib/proposals/pricing.ts").toString()).toBe("");
  });
});

/* ─────────────────────────── validation ─────────────────────────── */

describe("validateContent: payment_terms, details, intro", () => {
  it("accepts good terms on both kinds and refuses bad ones", () => {
    expect(errorPaths({ ...callum(), payment_terms: { due_now_pct: 50, balance_note: "upon delivery of the agreements" } })).toEqual([]);
    expect(errorPaths({ ...imogen(), payment_terms: { due_now_pct: 100 } })).toEqual([]);
    for (const pct of [0, 101, 12.5, "50", -1]) {
      expect(errorPaths({ ...imogen(), payment_terms: { due_now_pct: pct } })).toContain("payment_terms.due_now_pct");
    }
    expect(errorPaths({ ...callum(), payment_terms: { due_now_pct: 50, balance_note: "x".repeat(121) } })).toContain("payment_terms.balance_note");
    expect(errorPaths({ ...callum(), payment_terms: { due_now_pct: 50, balance_note: "<b>soon</b>" } })).toContain("payment_terms.balance_note");
    expect(errorPaths({ ...callum(), payment_terms: { due_now_pct: 50, balance_note: "  " } })).toContain("payment_terms.balance_note");
    expect(errorPaths({ ...callum(), payment_terms: "half" })).toContain("payment_terms");
  });

  it("accepts up to 12 bullets of up to 300 characters and an intro of up to 600, plain text", () => {
    const ok = imogen();
    ok.general!.items[0].details = Array.from({ length: 12 }, (_, i) => `Line ${i} ${"x".repeat(200)}`);
    ok.general!.items[0].intro = "y".repeat(600);
    expect(errorPaths(ok)).toEqual([]);

    const bad = (mut: (c: ProposalContent) => void, path: string) => {
      const c = imogen();
      mut(c);
      expect(errorPaths(c)).toContain(path);
    };
    bad((c) => (c.general!.items[0].details = Array.from({ length: 13 }, () => "x")), "general.items[0].details");
    bad((c) => (c.general!.items[0].details = ["x".repeat(301)]), "general.items[0].details[0]");
    bad((c) => (c.general!.items[0].details = ["ok", " "]), "general.items[0].details[1]");
    bad((c) => (c.general!.items[0].details = ["<script>x</script>"]), "general.items[0].details[0]");
    bad((c) => ((c.general!.items[0] as unknown as Record<string, unknown>).details = "one line"), "general.items[0].details");
    bad((c) => (c.general!.items[1].intro = "z".repeat(601)), "general.items[1].intro");
    bad((c) => (c.general!.items[1].intro = "a <b> tag"), "general.items[1].intro");
    bad((c) => (c.general!.items[1].intro = "   "), "general.items[1].intro");
  });
});

/* ─────────────────────────── Feature C: four options ─────────────────────────── */

describe("up to four packages per choice", () => {
  it(`the limit is ${MAX_PACKAGE_CHOICE_OPTIONS}`, () => expect(MAX_PACKAGE_CHOICE_OPTIONS).toBe(4));

  it("a name-level choice of 4 is accepted and 5 refused", () => {
    const c = renata();
    c.packages = [...c.packages!, { ...ESSENTIAL, package: "Extra" }, { ...ESSENTIAL, package: "More" }];
    c.names[0].package_choice = { options: ["Essential", "Enhanced", "Concierge", "Extra"], default: "Extra" };
    expect(errorPaths(c)).toEqual([]);
    c.names[0].package_choice = { options: ["Essential", "Enhanced", "Concierge", "Extra", "More"], default: "Extra" };
    expect(errorPaths(c)).toContain("names[0].package_choice.options");
  });

  it("a mark-level choice of 4 is accepted and 5 refused", () => {
    const c = renata();
    c.packages = [...c.packages!, { ...ESSENTIAL, package: "Extra" }, { ...ESSENTIAL, package: "More" }];
    delete c.names[0].package_choice;
    c.names[0].marks[0].package_choice = { options: ["Essential", "Enhanced", "Concierge", "Extra"], default: "Essential" };
    expect(errorPaths(c)).toEqual([]);
    c.names[0].marks[0].package_choice = { options: ["Essential", "Enhanced", "Concierge", "Extra", "More"], default: "Essential" };
    expect(errorPaths(c)).toContain("names[0].marks[0].package_choice.options");
  });

  it("the editor reads 4 ticked packages and refuses 5", () => {
    const form = (n: number) => {
      const f = new FormData();
      f.set("pkgChoice", "on");
      for (const p of ["Essential", "Enhanced", "Concierge", "Extra", "More"].slice(0, n)) f.append("pkgOption", p);
      return f;
    };
    expect(parsePackageChoiceFields(form(4), "")).toEqual({ ok: true, value: { options: ["Essential", "Enhanced", "Concierge", "Extra"], default: "Essential" } });
    const five = parsePackageChoiceFields(form(5), "");
    expect(five.ok).toBe(false);
    if (!five.ok) expect(five.error).toContain("tick from 1 to 4 packages");
  });

  it("the client page offers all four packages in the select and the comparison table has four columns", () => {
    const c = renata();
    const rows = [{ label: "Search", included: "✓" }];
    c.packages = [...c.packages!.map((p) => ({ ...p, includes: rows })), { ...ESSENTIAL, package: "Extra", includes: rows }];
    c.names[0].package_choice = { options: ["Essential", "Enhanced", "Concierge", "Extra"], default: "Enhanced" };
    const html = renderToStaticMarkup(
      <ProposalDocument content={c} title="Trademark Proposal" clientName="Renata" expiresOn="2026-12-01" firm={FIRM} mode="live" onAccept={accept} />,
    );
    const select = html.match(/<select[^>]*id="cp-pkg-fold"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect((select.match(/<option/g) ?? []).length).toBe(4);
    expect(select).toContain(">Extra<");
  });
});

/* ─────────────────────────── Feature B: the page ─────────────────────────── */

describe("Due today on the client page", () => {
  const terms = { due_now_pct: 50, balance_note: "upon delivery of the agreements" };

  it("no terms and 100% render byte for byte the same (both kinds, live and accepted)", () => {
    for (const state of ["live", "accepted"] as const) {
      expect(renderTrademark({ ...callum(), payment_terms: { due_now_pct: 100 } }, state)).toBe(renderTrademark(callum(), state));
      expect(renderGeneral({ ...imogen(), payment_terms: { due_now_pct: 100 } }, state)).toBe(renderGeneral(imogen(), state));
    }
  });

  it("a flat-fee proposal shows the total, Due today (50%) in bold, and the balance; the phone bar and pay note say what to pay now", () => {
    const html = renderGeneral({ ...imogen(), payment_terms: terms }, "live");
    const t = text(html);
    expect(t).toContain("Flat fee");
    expect(t).toContain("Total, paid in two parts");
    expect(html).toMatch(/<b>Due today \(50%\)<\/b>[\s\S]*?<div class="cp-big cp-num">\$250<\/div>/);
    expect(t).toContain("Balance (50%) due upon delivery of the agreements");
    expect(t).toContain("You’ll pay $250 through");
    expect(html).toMatch(/<div class="cp-bar">[\s\S]*Due today <b class="cp-num">\$250<\/b>/);
    expect(t).not.toContain("Flat fee due now");
  });

  it("a trademark proposal splits the legal fee only; the USPTO fees stay due at filing", () => {
    const content = { ...callum(), payment_terms: { due_now_pct: 50 } };
    const quote = quoteProposal(content, defaultSelection(content));
    const split = dueToday(quote, { due_now_pct: 50 });
    const t = text(renderTrademark(content, "live"));
    expect(t).toContain("Legal fee");
    expect(t).toContain(`Due today (50%)The amount to pay now${money(split.due_now_cents)}`);
    expect(t).toContain(`Balance (50%) due later${money(split.balance_cents)}`);
    expect(t).toContain("USPTO filing fees, due at filing");
    expect(t).toContain(money(quote.gov_total_cents));
    expect(t).not.toContain("Legal fee due now");
  });

  it("after acceptance the pay button is next to 'Pay $X today' (and the review panel keeps the split)", () => {
    const g = text(renderGeneral({ ...imogen(), payment_terms: terms }, "accepted"));
    expect(g).toContain("Pay $250 today");
    expect(g).toContain("Due today (50%)");
    const content = { ...callum(), payment_terms: { due_now_pct: 50 } };
    const split = dueToday(quoteProposal(content, defaultSelection(content)), { due_now_pct: 50 });
    expect(text(renderTrademark(content, "accepted"))).toContain(`Pay ${money(split.due_now_cents)} today`);
    expect(text(renderTrademark(callum(), "accepted"))).not.toMatch(/Pay \$[\d,.]+ today/);
  });

  it("publicContent keeps payment_terms' two keys and the items' intro and details; the snapshot records the terms and what was due", () => {
    const c = { ...imogen(), payment_terms: { due_now_pct: 50, balance_note: "later on", secret: 1 } } as unknown as ProposalContent;
    c.general!.items[0].details = ["One"];
    c.general!.items[0].intro = "Intro";
    const pub = publicContent(c);
    expect(pub.payment_terms).toEqual({ due_now_pct: 50, balance_note: "later on" });
    expect(pub.general!.items[0]).toMatchObject({ intro: "Intro", details: ["One"] });

    const quote = quoteProposal(pub, {});
    const snap = buildAcceptedSnapshot({ version: 1, content: pub, selection: {}, quote, acceptedAt: "2026-11-24T00:00:00Z" });
    expect(snap.payment_terms).toEqual({ due_now_pct: 50, balance_note: "later on" });
    expect(snap.due_now_cents).toBe(25_000);
    expect(acceptedDueToday(snap)).toBe("Due today $250 · Balance $250");

    const plain = buildAcceptedSnapshot({ version: 1, content: imogen(), selection: {}, quote: quoteProposal(imogen(), {}), acceptedAt: "2026-11-24T00:00:00Z" });
    expect("payment_terms" in plain).toBe(false);
    expect("due_now_cents" in plain).toBe(false);
    expect(acceptedDueToday(plain)).toBeNull();
    // An older snapshot with terms in its content but no recorded figure: worked out from the snapshot itself.
    expect(acceptedDueToday({ ...plain, content: { ...imogen(), payment_terms: { due_now_pct: 25 } } })).toBe("Due today $125 · Balance $375");
  });

  it("the staff page line and card", () => {
    const content = { ...imogen(), payment_terms: { due_now_pct: 50 } };
    expect(staffDueTodayLine(content, quoteProposal(content, {}))).toBe("Due today $250 · Balance $250");
    expect(staffDueTodayLine(imogen(), quoteProposal(imogen(), {}))).toBeNull();
    const row = { client_name: "Imogen", content, expires_on: null } as unknown as Parameters<typeof buildProposalCard>[0];
    expect(buildProposalCard(row, []).dueToday).toEqual({ dueNowCents: 25_000, balanceCents: 25_000 });
  });
});

/* ─────────────────────────── Feature A: sections and bullets ─────────────────────────── */

function withSections(): ProposalContent {
  const c = imogen();
  c.general!.items[0].details = ["Read the 2019 agreement (0.5 hours).", "Read the 2023 renewal (0.5 hours)."];
  c.general!.items[1].intro = "To keep your costs down, we will reuse the first review.";
  return c;
}

describe("flat-fee work as numbered sections", () => {
  it("content without intro or details is not sections; with either it is", () => {
    expect(usesWorkSections(imogen())).toBe(false);
    const empty = imogen();
    empty.general!.items[0].details = [];
    expect(usesWorkSections(empty)).toBe(false);
    expect(usesWorkSections(withSections())).toBe(true);
    // The byte-for-byte check of the old one-line list for content without them is tests/client-proposal/loe-baseline.test.tsx.
    expect(renderGeneral(empty, "live")).toBe(renderGeneral(imogen(), "live"));
  });

  it("each item is its own numbered section with hours and amount, its intro, then its bullets, hairline rows", () => {
    const html = renderGeneral(withSections(), "live");
    expect(html).toContain('<ol class="cp-work-secs">');
    expect((html.match(/<li class="cp-work-sec">/g) ?? []).length).toBe(3);
    expect(html).toContain('<b>1. Review both management agreements</b><span class="cp-num"> (1 Hour | $500)</span>');
    expect(html).toContain('<b>2. Review all correspondence and evidence</b><span class="cp-num"> (0.5 Hours | $250)</span>');
    expect(html).toMatch(/<ul class="cp-work-details"><li>Read the 2019 agreement \(0\.5 hours\)\.<\/li><li>Read the 2023 renewal \(0\.5 hours\)\.<\/li><\/ul>/);
    expect(html).toMatch(/\(0\.5 Hours \| \$250\)<\/span><\/p><p class="cp-work-intro">To keep your costs down/);
    // The old one-line list (a <span> label per item) is not drawn; "Not included" keeps its own list.
    expect(html).not.toContain('<ul class="cp-work"><li><span>');
  });

  it("the Legal Fee Summary: a row per item, then a bold Total of hours and fees", () => {
    const t = text(renderGeneral(withSections(), "live"));
    expect(t).toContain("Legal Fee SummaryScope of ServicesEstimated HoursLegal Fees");
    expect(t).toContain("Review both management agreements1$500");
    expect(t).toContain("Total2.5$1,250");
    const c = withSections();
    delete c.general!.items[1].hours;
    delete c.general!.items[1].rate_cents;
    c.general!.items[1].value_cents = 10_000;
    const s = feeSummary(quoteProposal(c, {}), money)!;
    expect(s.rows[1]).toEqual({ label: "Review all correspondence and evidence", hours: "—", fees: "$100" });
    expect(s.total).toEqual({ label: "Total", hours: "—", fees: "$1,100" });
  });

  it("one item: sections but no summary table; figures omit what the item lacks", () => {
    const c = withSections();
    c.general!.items = [c.general!.items[0]];
    const html = renderGeneral(c, "live");
    expect(html).toContain("cp-work-sec");
    expect(html).not.toContain("Legal Fee Summary");
    expect(sectionFigures({ hours: 5, value_cents: 247_500 }, money)).toBe("(5 Hours | $2,475)");
    expect(sectionFigures({ hours: 1, value_cents: 0 }, money)).toBe("(1 Hour)");
    expect(sectionFigures({ value_cents: 247_500 }, money)).toBe("($2,475)");
    expect(sectionFigures({ value_cents: 0 }, money)).toBe("");
  });

  it("client text is shown as text, never markup", () => {
    const c = withSections();
    c.general!.items[0].details = ["<img src=x onerror=alert(1)>"];
    expect(renderGeneral(c, "live")).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

/* ─────────────────────────── the editor ─────────────────────────── */

describe("editor parsing", () => {
  const rand = (() => {
    let n = 0;
    return () => `r${n++}`;
  })();

  function generalForm(extra: Record<string, string> = {}): FormData {
    const f = new FormData();
    f.set("matterTitle", "Client service agreements");
    f.set("fee", "2475");
    f.set("item.0.id", "w1");
    f.set("item.0.label", "One-Off Client Service Agreement");
    f.set("item.0.hours", "5");
    f.set("item.0.rate", "495");
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  it("reads details one per line (blank lines dropped) and the intro", () => {
    const r = parseGeneralForm(generalForm({ "item.0.details": "Drafting (2.5 hours).\n\n  Review (1 hour).  \n", "item.0.intro": "We start here." }), rand);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items[0]).toMatchObject({ details: ["Drafting (2.5 hours).", "Review (1 hour)."], intro: "We start here." });
    const none = parseGeneralForm(generalForm({ "item.0.details": "\n \n" }), rand);
    if (none.ok) expect("details" in none.value.items[0]).toBe(false);
  });

  it("refuses too many or too long bullets and a long intro", () => {
    expect(parseGeneralForm(generalForm({ "item.0.details": Array.from({ length: 13 }, () => "x").join("\n") }), rand).ok).toBe(false);
    expect(parseGeneralForm(generalForm({ "item.0.details": "x".repeat(301) }), rand).ok).toBe(false);
    expect(parseGeneralForm(generalForm({ "item.0.intro": "x".repeat(601) }), rand).ok).toBe(false);
  });

  it("form values round-trip details and intro", () => {
    const v = generalFormValues(withSections().general);
    expect(v.items[0].details).toBe("Read the 2019 agreement (0.5 hours).\nRead the 2023 renewal (0.5 hours).");
    expect(v.items[1].intro).toBe("To keep your costs down, we will reuse the first review.");
  });

  it("Due today: blank = full amount, 100 = full amount, 50 + note saved, bad input refused", () => {
    const f = (pct: string, note = "") => {
      const d = new FormData();
      d.set("dueNowPct", pct);
      d.set("balanceNote", note);
      return d;
    };
    expect(parsePaymentTermsFields(f(""))).toEqual({ ok: true, value: null });
    expect(parsePaymentTermsFields(f("100"))).toEqual({ ok: true, value: null });
    expect(parsePaymentTermsFields(f("50", "upon delivery"))).toEqual({ ok: true, value: { due_now_pct: 50, balance_note: "upon delivery" } });
    expect(parsePaymentTermsFields(f("50%"))).toEqual({ ok: true, value: { due_now_pct: 50 } });
    for (const bad of ["0", "101", "12.5", "half"]) expect(parsePaymentTermsFields(f(bad)).ok).toBe(false);
    expect(parsePaymentTermsFields(f("", "upon delivery")).ok).toBe(false);
    expect(parsePaymentTermsFields(f("50", "x".repeat(121))).ok).toBe(false);
  });

  it("the marker decides: without it the stored terms are left alone; with it blank removes them", () => {
    const content = { ...callum(), payment_terms: { due_now_pct: 40 } };
    const noMarker = applyPaymentTermsForm(new FormData(), content);
    expect(noMarker.ok && noMarker.value.payment_terms).toEqual({ due_now_pct: 40 });
    const cleared = new FormData();
    cleared.set("payTermsFields", "1");
    cleared.set("dueNowPct", "");
    const r = applyPaymentTermsForm(cleared, content);
    expect(r.ok && "payment_terms" in r.value).toBe(false);
  });

  it("the flat-fee section's save carries the terms", () => {
    const r = applyGeneralForm(generalForm({ payTermsFields: "1", dueNowPct: "50", balanceNote: "upon delivery of the agreements" }), imogen(), rand);
    expect(r.ok && r.value.payment_terms).toEqual({ due_now_pct: 50, balance_note: "upon delivery of the agreements" });
  });
});
