import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ProposalContent } from "@/lib/proposals/types";

/**
 * Bug 2026-10-30 (Taylor): a package choice set while creating a proposal never reached the client page, because
 * `createProposalAction` read none of those fields. End to end here: the field names come from the RENDERED New proposal
 * form, the FormData is what that form would post after a person ticks the boxes, the real action builds and "stores"
 * the content (the store is mocked to capture it), and the real client page renders "Select your package" from it.
 */

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

class Redirected extends Error {
  constructor(public to: string) {
    super(to);
  }
}

const PACKAGES = [
  { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 60_000, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 },
  { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
];

type Field = { tag: "input" | "select"; name: string; type: string; value: string; options: string[]; selected: string };

/** Every named control in the markup, as a browser would see it. */
function controls(html: string): Field[] {
  const out: Field[] = [];
  const attr = (tag: string, a: string) => new RegExp(`\\s${a}="([^"]*)"`).exec(tag)?.[1];
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    const name = attr(m[0], "name");
    if (!name) continue;
    out.push({ tag: "input", name, type: attr(m[0], "type") ?? "text", value: attr(m[0], "value") ?? "", options: [], selected: "" });
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const name = attr(m[0], "name");
    if (!name) continue;
    const options = [...m[2].matchAll(/<option value="([^"]*)"/g)].map((o) => o[1]);
    const selected = /<option value="([^"]*)" selected=""/.exec(m[2])?.[1] ?? options[0] ?? "";
    out.push({ tag: "select", name, type: "select", value: "", options, selected });
  }
  return out;
}

/**
 * The FormData the form posts once a person has acted: `ticked` holds "name" or "name=value" for checkboxes they tick,
 * `typed` the value they type or pick. Every name the person touches must exist in the markup.
 */
function submit(html: string, ticked: string[], typed: Record<string, string>): FormData {
  const fields = controls(html);
  const has = (key: string) =>
    fields.some((f) => (key.includes("=") ? `${f.name}=${f.value}` === key : f.name === key));
  for (const key of [...ticked, ...Object.keys(typed)]) {
    if (!has(key)) throw new Error(`The rendered form has no control for ${key}`);
  }
  const fd = new FormData();
  const seen = new Set<string>();
  for (const f of fields) {
    if (f.type === "checkbox") {
      const value = f.value || "on";
      if (ticked.includes(f.name) || ticked.includes(`${f.name}=${f.value}`)) fd.append(f.name, value);
    } else if (f.tag === "select") {
      fd.append(f.name, typed[f.name] ?? f.selected);
    } else if (!seen.has(f.name)) {
      fd.append(f.name, typed[f.name] ?? f.value);
    }
    seen.add(f.name);
  }
  return fd;
}

async function setup() {
  vi.resetModules();
  const created = vi.fn<(input: { content: ProposalContent }) => Promise<{ id: string }>>(async () => ({ id: "new-1" }));
  vi.doMock("next/navigation", () => ({
    redirect: vi.fn((to: string): never => {
      throw new Redirected(to);
    }),
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateStaffAction: vi.fn(async () => null) }));
  vi.doMock("@/lib/proposals/store", () => ({
    createProposal: created,
    getProposalSettings: vi.fn(async () => ({ pricing: { packages: PACKAGES } })),
  }));
  const { createProposalAction } = await import("../../src/app/dashboard/proposals/actions");
  const { NewProposalForm } = await import("@/components/proposal-editor/NewProposalForm");
  const { packageOption } = await import("@/lib/proposals/package-list");
  const html = renderToStaticMarkup(
    createElement(NewProposalForm, {
      defaults: { leadId: "", matterId: "", fullName: "Danielle Milton", firstName: "Danielle", company: "", clientEmail: "", brandName: "The Fold", title: "Trademark Proposal", expiresOn: "", payUrl: "" },
      hasSettings: true,
      packages: PACKAGES.map(packageOption),
    }),
  ).replaceAll("&#x27;", "'");
  const run = async (fd: FormData) => {
    try {
      return await createProposalAction({}, fd);
    } catch (e) {
      if (e instanceof Redirected) return { redirected: e.to };
      throw e;
    }
  };
  return { html, run, created };
}

/** What the editor's next step does before a client sees it: describe what the brand is used for. */
function withClass(content: ProposalContent): ProposalContent {
  const [first, ...rest] = content.names;
  return { ...content, names: [{ ...first, classes: [{ id: "c-one", label: "Clothing", preselected: true }] }, ...rest] };
}

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

describe("New proposal: the package choice the form posts reaches the stored content and the client page", () => {
  beforeEach(() => vi.resetModules());

  it("the rendered form carries the package-choice controls (names the action reads)", async () => {
    const { html } = await setup();
    const names = new Set(controls(html).map((f) => `${f.name}${f.type === "checkbox" && f.value ? `=${f.value}` : ""}`));
    for (const n of [
      "pkgFields",
      "pkgChoice",
      "pkgOption=Essential",
      "pkgOption=Enhanced",
      "pkgOption=Concierge",
      "pkgDefault",
      "discountPct",
      "newMark.word.pkgChoice",
      "newMark.word.pkgOption=Enhanced",
      "newMark.word.pkgDefault",
      "newMark.logo.pkgChoice",
      "newMark.logo.pkgOption=Essential",
      "newMark.logo.pkgDefault",
    ]) {
      expect(names, n).toContain(n);
    }
    expect(html).toContain("Let the client choose a package");
    expect(html).toContain("Discount on this brand name (%)");
  });

  it("brand-name choice + discount: stored with the package snapshot, and the client page shows the select with its default", async () => {
    const { html, run, created } = await setup();
    const fd = submit(html, ["pkgChoice", "pkgOption=Essential", "pkgOption=Enhanced", "pkgOption=Concierge"], { pkgDefault: "Enhanced", discountPct: "10" });
    expect(await run(fd)).toEqual({ redirected: "/dashboard/proposals/new-1/" });
    const content = created.mock.calls[0][0].content;
    const name = content.names[0];
    expect(name.name).toBe("The Fold");
    expect(name.package_choice).toEqual({ options: ["Essential", "Enhanced", "Concierge"], default: "Enhanced" });
    expect(name.discount_pct).toBe(10);
    expect(name.marks.every((m) => !m.package_choice)).toBe(true);
    expect(content.packages?.map((p) => p.package)).toEqual(["Essential", "Enhanced", "Concierge"]);

    const page = await renderClientPage(withClass(content));
    expect(page).toContain("Select your package");
    const sel = selectOf(page, `cp-pkg-${name.id}`);
    expect(sel.options).toEqual(["Essential", "Enhanced", "Concierge"]);
    expect(sel.selected).toBe("Enhanced");
  });

  it("per-mark choice (word mark, plus the design mark as an add-on on its own package)", async () => {
    const { html, run, created } = await setup();
    const fd = submit(
      html,
      ["newMark.word.pkgChoice", "newMark.word.pkgOption=Enhanced", "newMark.word.pkgOption=Concierge", "newMark.logo.pkgChoice", "newMark.logo.pkgOption=Essential", "newMark.logo.pkgOption=Enhanced"],
      { "newMark.word.pkgDefault": "Enhanced", "newMark.logo.pkgDefault": "Essential" },
    );
    expect(await run(fd)).toEqual({ redirected: "/dashboard/proposals/new-1/" });
    const content = created.mock.calls[0][0].content;
    const name = content.names[0];
    expect(name.package_choice).toBeUndefined();
    const word = name.marks.find((m) => m.kind === "word")!;
    const logo = name.marks.find((m) => m.kind === "logo")!;
    expect(word.package_choice).toEqual({ options: ["Enhanced", "Concierge"], default: "Enhanced" });
    expect(logo.package_choice).toEqual({ options: ["Essential", "Enhanced"], default: "Essential" });
    expect(content.packages?.map((p) => p.package)).toEqual(["Essential", "Enhanced", "Concierge"]);

    const page = await renderClientPage(withClass(content));
    const w = selectOf(page, `cp-pkg-${word.id}`);
    expect(w.options).toEqual(["Enhanced", "Concierge"]);
    expect(w.selected).toBe("Enhanced");
    expect(page).toContain("Add the design mark (logo)");
    const l = selectOf(page, `cp-pkg-${logo.id}`);
    expect(l.options).toEqual(["Essential", "Enhanced"]);
    expect(l.selected).toBe("Essential");
    expect(page).not.toContain(`id="cp-pkg-${name.id}"`);
  });

  it("nothing ticked: the content is exactly as before (no choice, no snapshot)", async () => {
    const { html, run, created } = await setup();
    await run(submit(html, [], {}));
    const content = created.mock.calls[0][0].content;
    expect(content.packages).toBeUndefined();
    expect(content.names[0].package_choice).toBeUndefined();
    expect(content.names[0].discount_pct).toBeUndefined();
  });

  it.each([
    ["a package that isn't the firm's", (fd: FormData) => fd.append("pkgOption", "Platinum"), "That package isn't one of your firm's packages. Pick one from the list."],
    ["a discount over 50", (fd: FormData) => fd.set("discountPct", "60"), "Discount on this brand name: enter a whole percent from 0 to 50."],
    ["a fractional discount", (fd: FormData) => fd.set("discountPct", "12.5"), "Discount on this brand name: enter a whole percent from 0 to 50."],
    [
      "a choice per brand name AND per mark",
      (fd: FormData) => {
        fd.append("newMark.word.pkgChoice", "on");
        fd.append("newMark.word.pkgOption", "Enhanced");
      },
      "Let the client choose a package for this brand name or for each mark, not both. Untick one.",
    ],
  ])("refuses %s and creates nothing", async (_label, tamper, error) => {
    const { html, run, created } = await setup();
    const fd = submit(html, ["pkgChoice", "pkgOption=Essential"], {});
    tamper(fd);
    expect(await run(fd)).toEqual({ error });
    expect(created).not.toHaveBeenCalled();
  });

  it("refuses a choice when the firm's packages can't be read, and a choice with no brand name", async () => {
    const { html, run, created } = await setup();
    const noName = submit(html, ["pkgChoice", "pkgOption=Essential"], { brandName: "" });
    expect(await run(noName)).toEqual({ error: "Enter a first brand name to let the client choose its package or to give it a discount." });
    expect(created).not.toHaveBeenCalled();

    vi.resetModules();
    vi.doMock("@/lib/proposals/store", () => ({
      createProposal: created,
      getProposalSettings: vi.fn(async () => {
        throw new Error("db down");
      }),
    }));
    const { createProposalAction } = await import("../../src/app/dashboard/proposals/actions");
    const fd = submit(html, ["pkgChoice", "pkgOption=Essential"], {});
    fd.delete("package");
    expect(await createProposalAction({}, fd)).toEqual({ error: "Couldn't read your packages, so nothing was created. Try again shortly." });
    expect(created).not.toHaveBeenCalled();
  });
});
