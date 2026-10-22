import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConsultMark, StoredConsultDetails } from "@/lib/consult/vocab";
import type { ReviewedConsultRead } from "@/lib/consult/store";
import type { ProposalContent } from "@/lib/proposals/types";
import { MARK_KIND_DEFAULT_DESC } from "@/lib/proposals/types";
import { newBrandName } from "@/lib/proposal-editor/form";

/**
 * createProposalAction with "Use the marks and classes from the reviewed consult" ticked. The action
 * re-reads the lead's consult details itself, so the browser never supplies a mark or a class; these
 * tests fake that read and the create call, and look at the document that reaches `createProposal`.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";

class Redirected extends Error {
  constructor(public to: string) {
    super(to);
  }
}

const PACKAGES = [
  { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 },
];

const mark = (id: string, text: string, type: ConsultMark["mark_type"], classes: Array<[number | null, string]> = []): ConsultMark => ({
  id,
  mark: text,
  mark_type: type,
  classes: classes.map(([cls, goods]) => ({ class: cls, goods })),
  filing_basis: "unknown",
  extracted_basis: null,
  basis_evidence: null,
  first_use_date: null,
});
const details = (marks: ConsultMark[], over: Partial<StoredConsultDetails> = {}): StoredConsultDetails => ({
  version: 1,
  rev: 1,
  marks,
  recommended_package: null,
  discount_discussed: null,
  extracted: null,
  review: { reviewed_at: "2026-10-21T16:00:00Z", reviewed_by: "u1", reviewed_by_name: "Rebecca Beliard", reviewed_by_role: "senior_admin" },
  ...over,
});
const reviewed = (d: StoredConsultDetails): ReviewedConsultRead => ({ status: "ok", details: d, unreadable: false, unreviewed: false });
const NONE: ReviewedConsultRead = { status: "ok", details: null, unreadable: false, unreviewed: false };

const ZEPHYR = mark("m1", "Zephyr", "word", [
  [25, "Clothing, namely t-shirts"],
  [35, "Online retail store services"],
]);
const SWIRL = mark("m2", "Swirl", "design");

const base = { fullName: "Ana Ruiz", firstName: "Ana", expiresOn: "2026-11-10", package: "Concierge" };
const settings = { default_pay_url: "https://pay.example/x", pricing: { packages: PACKAGES } };

async function setup(opts: { consult?: ReviewedConsultRead; gate?: { error: string } | "notFound" | null } = {}) {
  vi.resetModules();
  const created = vi.fn<(input: unknown) => Promise<{ id: string }>>(async () => ({ id: "new-1" }));
  const loadConsult = vi.fn<(leadId: string) => Promise<ReviewedConsultRead>>(async () => opts.consult ?? NONE);
  let draws = 0;
  vi.doMock("node:crypto", () => ({ randomBytes: () => ({ toString: () => String(++draws).padStart(8, "0") }) }));
  vi.doMock("next/navigation", () => ({
    redirect: vi.fn((to: string): never => {
      throw new Redirected(to);
    }),
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/app/dashboard/proposals/gate", () => ({
    gateStaffAction: vi.fn(async () => {
      if (opts.gate === "notFound") throw new Error("NEXT_NOT_FOUND");
      return opts.gate ?? null;
    }),
  }));
  vi.doMock("@/lib/proposals/store", () => ({ createProposal: created, getProposalSettings: vi.fn(async () => settings) }));
  vi.doMock("@/lib/proposals/consult-prefill-load", () => ({ loadConsultForPrefill: loadConsult }));
  const { createProposalAction } = await import("../../src/app/dashboard/proposals/actions");
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  return { created, loadConsult, run: (fields: Record<string, string>) => createProposalAction({}, form(fields)) };
}

type Created = { content: ProposalContent & { package_basis?: { name: string; edited: string[] } }; leadId: string | null; matterId: string | null };
const contentOf = (created: ReturnType<typeof vi.fn>) => (created.mock.calls[0][0] as Created).content;

beforeEach(() => vi.resetModules());

describe("the box ticked, the consult reviewed", () => {
  it("creates one brand name per distinct mark, with word and logo marks as the consult said, and classes as their goods", async () => {
    const { created, loadConsult, run } = await setup({ consult: reviewed(details([ZEPHYR, SWIRL])) });
    await expect(run({ ...base, leadId: LEAD, useConsult: "on" })).rejects.toMatchObject({ to: "/dashboard/proposals/new-1/" });
    expect(loadConsult).toHaveBeenCalledWith(LEAD);
    const { names } = contentOf(created);
    expect(names.map((x) => x.name)).toEqual(["Zephyr", "Swirl"]);
    expect(names[0].marks).toEqual([expect.objectContaining({ kind: "word", desc: MARK_KIND_DEFAULT_DESC.word, preselected: true })]);
    expect(names[1].marks).toEqual([expect.objectContaining({ kind: "logo", desc: MARK_KIND_DEFAULT_DESC.logo, preselected: true })]);
    expect(names[0].classes.map((c) => c.label)).toEqual(["Clothing, namely t-shirts", "Online retail store services"]);
    expect(names[0].classes.every((c) => c.preselected)).toBe(true);
    expect(names[1].classes).toEqual([]);
  });

  it("no class number is anywhere in the document, ids are unique and non-empty, at most 3 classes and 10 names", async () => {
    const wide = Array.from({ length: 10 }, (_, i) =>
      mark(`m${i}`, `Brand${String.fromCharCode(97 + i)}`, i % 2 ? "design" : "word", [[25, "Goods one"], [35, "Goods two"], [9, "Goods three"], [41, "Goods four"]]),
    );
    const { created, run } = await setup({ consult: reviewed(details(wide)) });
    await expect(run({ ...base, leadId: LEAD, useConsult: "on", brandName: "Typed Extra" })).rejects.toBeInstanceOf(Redirected);
    const { names } = contentOf(created);
    expect(names).toHaveLength(10);
    expect(names.every((x) => x.classes.length <= 3)).toBe(true);
    const ids = names.flatMap((x) => [x.id, ...x.marks.map((m) => m.id), ...x.classes.map((c) => c.id)]);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // The consult's class numbers (25, 35, 9, 41) are not carried anywhere in the document's names.
    expect(JSON.stringify(names)).not.toMatch(/"label":"[^"]*\b(25|35|41)\b/);
    expect(JSON.stringify(names)).not.toMatch(/"class":\s*\d/);
    expect(JSON.stringify(names)).not.toMatch(/Class \d/);
  });

  it("a typed name that matches a consult mark is that mark's brand name; the others follow", async () => {
    const { created, run } = await setup({ consult: reviewed(details([ZEPHYR, SWIRL])) });
    await expect(run({ ...base, leadId: LEAD, useConsult: "on", brandName: "ZEPHYR!" })).rejects.toBeInstanceOf(Redirected);
    const { names } = contentOf(created);
    expect(names.map((x) => x.name)).toEqual(["ZEPHYR!", "Swirl"]);
    expect(names[0].classes).toHaveLength(2);
  });

  it("a typed name that matches none stays first with the default pair; a blank one creates only the consult marks", async () => {
    const first = await setup({ consult: reviewed(details([ZEPHYR])) });
    await expect(first.run({ ...base, leadId: LEAD, useConsult: "on", brandName: "Other" })).rejects.toBeInstanceOf(Redirected);
    const { names } = contentOf(first.created);
    expect(names.map((x) => x.name)).toEqual(["Other", "Zephyr"]);
    expect(names[0].marks.map((m) => m.kind)).toEqual(["word", "logo"]);
    expect(names[0].classes).toEqual([]);

    const blank = await setup({ consult: reviewed(details([ZEPHYR])) });
    await expect(blank.run({ ...base, leadId: LEAD, useConsult: "on", brandName: "" })).rejects.toBeInstanceOf(Redirected);
    expect(contentOf(blank.created).names.map((x) => x.name)).toEqual(["Zephyr"]);
  });

  it("the browser cannot supply marks or classes: posted mark and class rows are ignored", async () => {
    const { created, run } = await setup({ consult: reviewed(details([ZEPHYR])) });
    await expect(
      run({ ...base, leadId: LEAD, useConsult: "on", "mark.0.kind": "logo", "class.0.label": "Injected goods", "names.0.name": "Injected" }),
    ).rejects.toBeInstanceOf(Redirected);
    expect(JSON.stringify(contentOf(created))).not.toContain("Injected");
  });

  it("an unchanged package posts no 'edited' flags; editing one price records that field only", async () => {
    const same = await setup({ consult: reviewed(details([ZEPHYR])) });
    await expect(
      same.run({ ...base, package: "Enhanced", base: "3250.00", includedClasses: "2", perClass: "700.00", secondMarkPct: "15", govPerClass: "350.00", leadId: LEAD, useConsult: "on" }),
    ).rejects.toBeInstanceOf(Redirected);
    expect(contentOf(same.created).pricing).toEqual(PACKAGES[1]);
    expect(contentOf(same.created).package_basis).toBeUndefined();

    const edited = await setup({ consult: reviewed(details([ZEPHYR])) });
    await expect(
      edited.run({ ...base, package: "Enhanced", base: "2900", includedClasses: "2", perClass: "700.00", secondMarkPct: "15", govPerClass: "350.00", leadId: LEAD, useConsult: "on" }),
    ).rejects.toBeInstanceOf(Redirected);
    expect(contentOf(edited.created).package_basis).toEqual({ name: "Enhanced", edited: ["price"] });
  });

  it("carries the lead and matter ids as before", async () => {
    const { created, run } = await setup({ consult: reviewed(details([ZEPHYR])) });
    await expect(run({ ...base, leadId: LEAD, matterId: MATTER, useConsult: "on" })).rejects.toBeInstanceOf(Redirected);
    expect(created.mock.calls[0][0]).toMatchObject({ leadId: LEAD, matterId: MATTER });
  });
});

describe("refused when the consult is no longer reviewed: nothing is created", () => {
  const changed = "The consult details changed since this page loaded. Reload the page and try again.";

  it.each<[string, ReviewedConsultRead]>([
    ["unreviewed", { status: "ok", details: null, unreadable: false, unreviewed: true }],
    ["unreadable", { status: "ok", details: null, unreadable: true, unreviewed: false }],
    ["unavailable", { status: "unavailable" }],
    ["absent (or another firm's lead: the scoped read sees no notes)", NONE],
  ])("%s", async (_name, consult) => {
    const { created, run } = await setup({ consult });
    const result = await run({ ...base, leadId: LEAD, useConsult: "on", brandName: "Zephyr" });
    expect(result).toEqual({ error: changed });
    expect(created).not.toHaveBeenCalled();
  });

  it("details whose review stamp is gone are refused too", async () => {
    const { created, run } = await setup({ consult: reviewed(details([ZEPHYR], { review: null })) });
    expect(await run({ ...base, leadId: LEAD, useConsult: "on" })).toEqual({ error: changed });
    expect(created).not.toHaveBeenCalled();
  });

  it("never falls back to an unreviewed record: no marks reach the document", async () => {
    const { created, run } = await setup({ consult: { status: "ok", details: null, unreadable: false, unreviewed: true } });
    await run({ ...base, leadId: LEAD, useConsult: "on" });
    expect(created).not.toHaveBeenCalled();
  });
});

describe("the box without a lead, or not ticked", () => {
  it("a ticked box with no lead id is ignored: the consult is never read", async () => {
    const { created, loadConsult, run } = await setup({ consult: reviewed(details([ZEPHYR])) });
    await expect(run({ ...base, useConsult: "on", brandName: "Prosperall" })).rejects.toBeInstanceOf(Redirected);
    expect(loadConsult).not.toHaveBeenCalled();
    expect(contentOf(created).names.map((x) => x.name)).toEqual(["Prosperall"]);
  });

  it("not ticked: today's single typed name, exactly as before the sprint, and the consult is never read", async () => {
    const { created, loadConsult, run } = await setup({ consult: reviewed(details([ZEPHYR, SWIRL])) });
    await expect(run({ ...base, leadId: LEAD, brandName: "Prosperall" })).rejects.toBeInstanceOf(Redirected);
    expect(loadConsult).not.toHaveBeenCalled();
    // The first draws of the id source go to the one name, as they always did.
    let i = 0;
    const expected = newBrandName("Prosperall", new Set<string>(), () => String(++i).padStart(8, "0"));
    expect(contentOf(created).names).toEqual([expected]);
    expect(expected.marks.map((m) => m.kind)).toEqual(["word", "logo"]);
    expect(expected.classes).toEqual([]);
  });

  it("not ticked and no typed name: no brand name at all", async () => {
    const { created, run } = await setup({ consult: reviewed(details([ZEPHYR])) });
    await expect(run({ ...base, leadId: LEAD })).rejects.toBeInstanceOf(Redirected);
    expect(contentOf(created).names).toEqual([]);
  });
});

describe("the gate runs first", () => {
  it("a refused role gets the gate's sentence and nothing is read", async () => {
    const { created, loadConsult, run } = await setup({ gate: { error: "Your role can view proposals but not change them." } });
    expect(await run({ ...base, leadId: LEAD, useConsult: "on" })).toEqual({ error: "Your role can view proposals but not change them." });
    expect(loadConsult).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  });

  it("no Proposals module: not-found before anything is read", async () => {
    const { created, loadConsult, run } = await setup({ gate: "notFound" });
    await expect(run({ ...base, leadId: LEAD, useConsult: "on" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadConsult).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  });
});
