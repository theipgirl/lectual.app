import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildDraftContent, type ProposalDraftSpec } from "@/lib/proposals/draft-spec";
import type { ProposalContent } from "@/lib/proposals/types";

/**
 * Replaces create-package-choice.test.tsx (Sprint 3 removed the New proposal form that posted the choice). The same
 * end-to-end claim, now from the one builder: a package choice, a discount or a per-mark choice in a draft spec reaches
 * the stored content with the firm's package snapshot, and the real client page renders "Select your package".
 */

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

const PACKAGES = [
  { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 60_000, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 },
  { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
];

let n = 0;
const newId = () => `i${(n++).toString(36).padStart(4, "0")}`;
const build = (spec: ProposalDraftSpec, pricing: Record<string, unknown> = { packages: PACKAGES }): ProposalContent => {
  const r = buildDraftContent(spec, { pricing, letter: null }, newId);
  if (!r.ok) throw new Error(r.error);
  return r.content;
};
const base = { kind: "trademark", madeBy: "person", client: { fullName: "Danielle Milton", firstName: "Danielle" } } as const;

async function renderClientPage(content: ProposalContent) {
  const { ProposalDocument } = await import("@/components/client-proposal/ProposalDocument");
  return renderToStaticMarkup(
    createElement(ProposalDocument, {
      content,
      title: "Trademark Proposal",
      clientName: "Danielle Milton",
      expiresOn: null,
      firm: { name: "Hartwell", slug: "hartwell" },
      mode: "live",
      onAccept: async () => ({ ok: true as const, payUrl: "https://example.com/pay" }),
    }),
  ).replaceAll("&#x27;", "'");
}

const selectOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  expect(at, `select ${id}`).toBeGreaterThan(-1);
  const sel = html.slice(html.lastIndexOf("<select", at), html.indexOf("</select>", at));
  return {
    options: [...sel.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]),
    selected: /<option value="([^"]+)" selected=""/.exec(sel)?.[1],
  };
};

describe("a spec's package choice reaches the stored content and the client page", () => {
  it("brand-name choice + discount: stored with the package snapshot, and the page shows the select on its default", async () => {
    const content = build({ ...base, names: [{ name: "The Fold", classes: ["Clothing"], offer: { mode: "choice", options: ["Essential", "Enhanced", "Concierge"], start: "Enhanced" }, discountPct: 10 }] });
    const name = content.names[0];
    expect(name.package_choice).toEqual({ options: ["Essential", "Enhanced", "Concierge"], default: "Enhanced" });
    expect(name.discount_pct).toBe(10);
    expect(name.marks.every((m) => !m.package_choice)).toBe(true);
    expect(content.packages?.map((p) => p.package)).toEqual(["Essential", "Enhanced", "Concierge"]);

    const page = await renderClientPage(content);
    expect(page).toContain("Select your package");
    const sel = selectOf(page, `cp-pkg-${name.id}`);
    expect(sel.options).toEqual(["Essential", "Enhanced", "Concierge"]);
    expect(sel.selected).toBe("Enhanced");
  });

  it("per-mark choice (word mark, plus the design mark as an add-on on its own package)", async () => {
    const content = build({
      ...base,
      names: [{ name: "The Fold", classes: ["Clothing"], offer: { mode: "per_mark", marks: { word: { options: ["Enhanced", "Concierge"], start: "Enhanced" }, logo: { options: ["Essential", "Enhanced"], start: "Essential" } } } }],
    });
    const name = content.names[0];
    expect(name.package_choice).toBeUndefined();
    const word = name.marks.find((m) => m.kind === "word")!;
    const logo = name.marks.find((m) => m.kind === "logo")!;
    expect(word.package_choice).toEqual({ options: ["Enhanced", "Concierge"], default: "Enhanced" });
    expect(logo.package_choice).toEqual({ options: ["Essential", "Enhanced"], default: "Essential" });

    const page = await renderClientPage(content);
    expect(selectOf(page, `cp-pkg-${word.id}`)).toEqual({ options: ["Enhanced", "Concierge"], selected: "Enhanced" });
    expect(page).toContain("Add the design mark (logo)");
    expect(selectOf(page, `cp-pkg-${logo.id}`)).toEqual({ options: ["Essential", "Enhanced"], selected: "Essential" });
    expect(page).not.toContain(`id="cp-pkg-${name.id}"`);
  });

  it("nothing set: the content is exactly as before (no choice, no snapshot)", () => {
    const content = build({ ...base, names: [{ name: "The Fold", classes: ["Clothing"] }] });
    expect(content.packages).toBeUndefined();
    expect(content.names[0].package_choice).toBeUndefined();
    expect(content.names[0].discount_pct).toBeUndefined();
  });

  it.each([
    ["a package that isn't the firm's", { options: ["Essential", "Platinum"] }, "Platinum"],
    ["a start outside the options", { options: ["Essential"], start: "Enhanced" }, "starting package"],
    ["four packages", { options: ["Essential", "Enhanced", "Concierge", "Plus"] }, "at most 3"],
  ])("refuses %s and builds nothing", (_label, choice, message) => {
    const r = buildDraftContent({ ...base, names: [{ name: "The Fold", classes: ["x"], offer: { mode: "choice", ...choice } }] }, { pricing: { packages: [...PACKAGES, { ...PACKAGES[0], package: "Plus" }] }, letter: null }, () => `i${(n++).toString(36).padStart(4, "0")}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it.each([["a discount over 50", 60], ["a fractional discount", 12.5]])("refuses %s", (_l, discountPct) => {
    const r = buildDraftContent({ ...base, names: [{ name: "The Fold", classes: ["x"], discountPct }] }, { pricing: { packages: PACKAGES }, letter: null }, () => `i${(n++).toString(36).padStart(4, "0")}`);
    expect(r.ok).toBe(false);
  });
});
