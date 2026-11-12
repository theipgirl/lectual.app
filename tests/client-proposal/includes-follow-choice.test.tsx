import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, includesComparison, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { chosenPackageNames } from "@/lib/proposals/chosen-packages";
import { withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import { normalisePackages, withPackages } from "@/lib/proposals/package-list";
import { defaultSelection, normalizeSelection, quoteProposal } from "@/lib/proposals/pricing";
import type { ProposalContent, ProposalInclude, Selection } from "@/lib/proposals/types";
import { danielle } from "../proposals/danielle-fixture";
import { fold } from "../proposals/mark-fixture";
import { sevetri } from "../proposals/fixture";

const ROWS: Record<string, ProposalInclude[]> = {
  Essential: [{ label: "Search report", included: "Basic" }],
  Enhanced: [{ label: "Search report", included: "Full" }, { label: "Office action review", included: "✓" }],
  Concierge: [{ label: "Search report", included: "Full" }, { label: "Monitoring", included: "1 year" }],
};

function withIncludes(c: ProposalContent): ProposalContent {
  return { ...c, packages: c.packages!.map((p) => ({ ...p, includes: ROWS[p.package] })) };
}

function render(content: ProposalContent, over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={content}
      title="Trademark Proposal"
      clientName="Danielle Milton"
      expiresOn={null}
      firm={{ name: "Hartwell", slug: "hartwell" }}
      mode="live"
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      {...over}
    />,
  ).replaceAll("&#x27;", "'");
}

/** The firm's starting ticks plus `over` (package picks merged), as the page builds its selection. */
function sel(c: ProposalContent, over: Selection = {}): Selection {
  const start = defaultSelection(c);
  return normalizeSelection(c, { ...start, ...over, packages: { ...(start.packages ?? {}), ...(over.packages ?? {}) } });
}

const col = (name: string) => `<th scope="col" class="cp-vcell">${name}</th>`;

describe("chosenPackageNames", () => {
  it("name-level choice: the default, or the client's pick, de-duplicated", () => {
    const c = danielle();
    expect(chosenPackageNames(c, sel(c))).toEqual(["Enhanced"]);
    expect(chosenPackageNames(c, sel(c, { packages: { fold: "Concierge", ci: "Essential" } }))).toEqual(["Essential", "Concierge"]);
  });

  it("an unticked brand name adds nothing", () => {
    const c = danielle();
    const picked = sel(c, { "ci-word": false, packages: { fold: "Concierge", ci: "Essential" } });
    expect(chosenPackageNames(c, picked)).toEqual(["Concierge"]);
  });

  it("mark-level choice: only ticked marks count, ordered by content.packages", () => {
    const c = fold();
    expect(chosenPackageNames(c, sel(c))).toEqual(["Enhanced"]);
    const both = sel(c, { "fold-logo": true, packages: { "fold-word": "Enhanced", "fold-logo": "Essential" } });
    expect(chosenPackageNames(c, both)).toEqual(["Essential", "Enhanced"]);
    const same = sel(c, { "fold-logo": true, packages: { "fold-word": "Essential", "fold-logo": "Essential" } });
    expect(chosenPackageNames(c, same)).toEqual(["Essential"]);
  });

  it("no package choice anywhere: nothing", () => {
    const c = sevetri();
    expect(chosenPackageNames(c, sel(c))).toEqual([]);
  });
});

describe("includesComparison follows the choice", () => {
  it("chosen packages only, in the given order", () => {
    const t = includesComparison(withIncludes(danielle()), ["Essential", "Concierge"]);
    expect(t?.mode).toBe("chosen");
    expect(t?.packages).toEqual(["Essential", "Concierge"]);
    expect(t?.rows.map((r) => r.label)).toEqual(["Search report", "Monitoring"]);
    expect(t?.rows[1].cells).toEqual(["—", "1 year"]);
  });

  it("falls back to every offered package when nothing is chosen or no chosen package has rows", () => {
    const c = withIncludes(danielle());
    expect(includesComparison(c, [])?.mode).toBe("all");
    expect(includesComparison(c, [])?.packages).toEqual(["Essential", "Enhanced", "Concierge"]);
    const partial: ProposalContent = { ...c, packages: c.packages!.map((p) => (p.package === "Essential" ? { ...p, includes: undefined } : p)) };
    expect(includesComparison(partial, ["Essential"])?.mode).toBe("all");
    expect(includesComparison(danielle(), ["Essential"])).toBeNull();
  });
});

describe("the client page's included table", () => {
  it("one brand name on Essential: only an Essential column", () => {
    const c = withIncludes(danielle());
    const html = render(c, { initialSelection: { "ci-word": false, packages: { fold: "Essential" } } });
    expect(html).toContain("What your package includes");
    expect(html).toContain(col("Essential"));
    expect(html).not.toContain(col("Enhanced"));
    expect(html).not.toContain(col("Concierge"));
  });

  it("two marks on Essential + Enhanced: both columns, compared", () => {
    const c = withIncludes(fold());
    const html = render(c, { initialSelection: { "fold-logo": true, packages: { "fold-word": "Enhanced", "fold-logo": "Essential" } } });
    expect(html).toContain("Compare your packages");
    expect(html).toContain(col("Essential"));
    expect(html).toContain(col("Enhanced"));
    expect(html).not.toContain(col("Concierge"));
  });

  it("changing the selection changes the columns", () => {
    const c = withIncludes(fold());
    const a = render(c, { initialSelection: { packages: { "fold-word": "Concierge" } } });
    const b = render(c, { initialSelection: { packages: { "fold-word": "Essential" } } });
    expect(a).toContain(col("Concierge"));
    expect(a).not.toContain(col("Essential"));
    expect(b).toContain(col("Essential"));
    expect(b).not.toContain(col("Concierge"));
  });

  it("the receipt follows the accepted selection", () => {
    const c = withIncludes(danielle());
    const accepted = sel(c, { packages: { fold: "Concierge", ci: "Concierge" } });
    const html = render(c, { mode: "accepted", initialSelection: accepted, acceptedQuote: quoteProposal(c, accepted), payUrl: "https://example.com/pay" });
    expect(html).toContain("What your package includes");
    expect(html).toContain(col("Concierge"));
    expect(html).not.toContain(col("Enhanced"));
  });

  it("a proposal with no package choice renders the old single-package table", () => {
    const c = sevetri();
    const html = render(c);
    expect(html).toContain("What your package includes");
    expect(html).not.toContain("cp-cmp");
    for (const r of c.includes) expect(html).toContain(r.label.replaceAll("&", "&amp;"));
  });
});

describe("withPackageSnapshot keeps a proposal's includes", () => {
  const setting = { packages: normalisePackages({ packages: danielle().packages }) };

  it("keeps the earlier entry's includes when the firm's list has none, and the custom discount", () => {
    const c = withIncludes(danielle());
    c.packages = c.packages!.map((p) => (p.package === "Concierge" ? { ...p, custom_discount: { label: "Custom", per_class_under_cents: 82_500 } } : p));
    const out = withPackageSnapshot(c, setting);
    expect(out.packages!.find((p) => p.package === "Enhanced")?.includes).toEqual(ROWS.Enhanced);
    const concierge = out.packages!.find((p) => p.package === "Concierge");
    expect(concierge?.includes).toEqual(ROWS.Concierge);
    expect(concierge?.custom_discount).toEqual({ label: "Custom", per_class_under_cents: 82_500 });
  });

  it("the firm's includes win when the firm's list has them", () => {
    const c = withIncludes(danielle());
    const firmRows = [{ label: "Firm row", included: "Yes" }];
    const firm = { packages: setting.packages.map((p) => ({ ...p, includes: firmRows })) };
    const out = withPackageSnapshot(c, firm);
    expect(out.packages!.every((p) => JSON.stringify(p.includes) === JSON.stringify(firmRows))).toBe(true);
  });

  it("a package new to the proposal gets the firm's includes, or none", () => {
    const c = withIncludes(danielle());
    c.packages = c.packages!.filter((p) => p.package !== "Concierge");
    const out = withPackageSnapshot(c, setting);
    expect(out.packages!.find((p) => p.package === "Concierge")?.includes).toBeUndefined();
    const firm = { packages: setting.packages.map((p) => (p.package === "Concierge" ? { ...p, includes: [{ label: "X", included: "Y" }] } : p)) };
    expect(withPackageSnapshot(c, firm).packages!.find((p) => p.package === "Concierge")?.includes).toEqual([{ label: "X", included: "Y" }]);
  });
});

describe("withPackages keeps each package's includes across a settings save", () => {
  it("carries includes by name (case-insensitive, trimmed) and invents none", () => {
    const stored = {
      includes: [{ label: "Firm table", included: "✓" }],
      packages: [
        { ...normalisePackages({ packages: danielle().packages })[0], includes: ROWS.Essential },
        { ...normalisePackages({ packages: danielle().packages })[1], package: " ENHANCED ", includes: ROWS.Enhanced },
      ],
    };
    const list = normalisePackages({ packages: danielle().packages });
    const out = withPackages(stored, list);
    const pkgs = out.packages as { package: string; includes?: ProposalInclude[] }[];
    expect(pkgs.find((p) => p.package === "Essential")?.includes).toEqual(ROWS.Essential);
    expect(pkgs.find((p) => p.package === "Enhanced")?.includes).toEqual(ROWS.Enhanced);
    expect(pkgs.find((p) => p.package === "Concierge")?.includes).toBeUndefined();
    // The firm's own top-level table is untouched by the first package's rows.
    expect(out.includes).toEqual([{ label: "Firm table", included: "✓" }]);
    expect(out.package).toBe("Essential");
  });
});

describe("a note typed on any package's row is shown (2026-11-12)", () => {
  const withNotes = (): ProposalContent => ({
    ...danielle(),
    packages: danielle().packages!.map((p) => ({
      ...p,
      includes: [
        { label: "Search report", value: p.package === "Concierge" ? "$900" : undefined, included: "✓", note: p.package === "Essential" ? undefined : p.package === "Enhanced" ? "Shared note" : "Concierge only" },
        { label: "Monitoring", included: p.package === "Essential" ? "—" : "1 year", highlight: p.package === "Concierge" ? true : undefined },
      ],
    })),
  });

  it("the row's note, worth and highlight come from the first package that has one; a different note goes under its own cell", () => {
    const table = includesComparison(withNotes());
    const search = table!.rows[0];
    expect(search.note).toBe("Shared note");
    expect(search.value).toBe("$900");
    expect(search.cellNotes).toEqual([undefined, undefined, "Concierge only"]);
    expect(table!.rows[1].highlight).toBe(true);
    expect(table!.rows[1].cellNotes).toBeUndefined();
  });

  it("a note on the only chosen package (not the first offered) is drawn", () => {
    const c = withNotes();
    const html = render(c, { initialSelection: sel(c, { packages: { fold: "Concierge", ci: "Concierge" } }) });
    expect(html).toContain("Concierge only");
    expect(html).toContain("$900");
  });

  it("side by side, the differing note sits under that package's cell and the shared one under the label", () => {
    const c = withNotes();
    const html = render(c, { initialSelection: sel(c, { packages: { fold: "Enhanced", ci: "Concierge" } }) });
    expect(html).toContain('<span class="cp-sub-note">Shared note</span></th>');
    expect(html).toContain('<td class="cp-vcell">\u2713<span class="cp-sub-note">Concierge only</span></td>');
  });
});
