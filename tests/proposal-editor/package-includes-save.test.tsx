import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { runSaveDraft, type SaveDraftDeps } from "@/lib/proposal-editor/save-draft";
import { editorPackageIncludes } from "@/lib/proposal-editor/package-includes";
import { withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import { FeesSection } from "@/components/proposal-editor/Sections";
import type { ProposalContent, ProposalInclude, ProposalRow } from "@/lib/proposals/types";
import { CONCIERGE, ENHANCED, ESSENTIAL, danielle } from "../proposals/danielle-fixture";
import { sevetri } from "../proposals/fixture";

vi.mock("next/font/google", () => ({ Bodoni_Moda: () => ({ variable: "b" }), Source_Serif_4: () => ({ variable: "s" }) }));

/**
 * Editor fixes (2026-11-12), bug 1: "What the package includes: the editor does not apply changes."
 *
 * Cause: when the proposal offers packages that carry their own "what's included" rows (Settings -> Proposals ->
 * Packages, 2026-11-10), the client page draws ONE comparison table from `content.packages[].includes` and never
 * reads `content.includes`. The editor only edited `content.includes`, so every change saved but nobody ever saw it;
 * and each save refreshed the package rows from the firm's list, so even a hand edit of those rows would have been
 * overwritten.
 */

const UPDATED = "2026-11-12T12:00:00Z";
const FIRM_ROWS: ProposalInclude[] = [
  { label: "Clearance search", included: "✓" },
  { label: "Non-Substantive Office Action Response", value: "$450 each", included: "Unlimited" },
];

function withRows(): ProposalContent {
  const c = danielle();
  c.packages = [ESSENTIAL, ENHANCED, CONCIERGE].map((p) => ({ ...p, includes: FIRM_ROWS.map((r) => ({ ...r })) }));
  return c;
}

const SETTING = { packages: [ESSENTIAL, ENHANCED, CONCIERGE].map((p) => ({ ...p, includes: FIRM_ROWS })) };

function row(content: ProposalContent): ProposalRow {
  return {
    id: "p1", org_id: "o", family_id: "p1", version: 1, public_token: "t".repeat(43), lead_id: null, matter_id: null,
    client_name: "Danielle Milton", client_email: "d@example.com", title: "Trademark Proposal", status: "draft", content,
    expires_on: "2026-12-10", pay_url: null, source: "manual", created_by: null, updated_by: null, approved_by: null, approved_at: null,
    sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: UPDATED, updated_at: UPDATED,
  };
}

function deps(r: ProposalRow, over: Partial<SaveDraftDeps> = {}): SaveDraftDeps {
  return {
    gate: vi.fn(async () => null),
    getRow: vi.fn(async () => r),
    settingPricing: vi.fn(async () => SETTING),
    update: vi.fn(async () => r),
    describe: proposalActionError,
    revalidate: vi.fn(),
    rand: () => "ab12",
    ...over,
  };
}

/** What the editor posts for a draft: the client, every brand, the package numbers, and the extra fields given. */
function form(content: ProposalContent, extra: Record<string, string>): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    proposalId: "p1", updatedAt: UPDATED, fullName: "Danielle Milton", firstName: "Danielle", clientEmail: "d@example.com", title: "Trademark Proposal",
    greeting: "Hi", package: "Concierge", base: "4950", includedClasses: "3", perClass: "825", secondMarkPct: "20", govPerClass: "350", adjFields: "1",
  };
  content.names.forEach((n, b) => {
    const p = `b.${b}.`;
    base[`${p}nameId`] = n.id;
    base[`${p}name`] = n.name;
    n.marks.forEach((m, i) => {
      base[`${p}mark.${i}.id`] = m.id;
      base[`${p}mark.${i}.kind`] = m.kind;
      base[`${p}mark.${i}.desc`] = m.desc;
      base[`${p}mark.${i}.preselected`] = "on";
    });
    n.classes.forEach((k, i) => {
      base[`${p}class.${i}.id`] = k.id;
      base[`${p}class.${i}.label`] = k.label;
      base[`${p}class.${i}.preselected`] = "on";
    });
    if (n.package_choice) {
      base[`${p}pkgFields`] = "1";
      base[`${p}pkgChoice`] = "on";
      base[`${p}pkgDefault`] = n.package_choice.default;
    }
  });
  for (const [k, v] of Object.entries({ ...base, ...extra })) f.set(k, v);
  content.names.forEach((n, b) => n.package_choice?.options.forEach((o) => f.append(`b.${b}.pkgOption`, o)));
  return f;
}

/** The package rows exactly as the editor draws them, then the given overrides (`pkgInc.<n>.<row>.<field>`). */
function packageRows(content: ProposalContent, over: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { pkgIncFields: "1" };
  (editorPackageIncludes(content) ?? []).forEach((p, n) => {
    out[`pkgInc.${n}.package`] = p.package;
    p.includes.forEach((r, i) => {
      out[`pkgInc.${n}.${i}.label`] = r.label;
      out[`pkgInc.${n}.${i}.value`] = r.value ?? "";
      out[`pkgInc.${n}.${i}.included`] = r.included;
      out[`pkgInc.${n}.${i}.note`] = r.note ?? "";
      if (r.highlight) out[`pkgInc.${n}.${i}.highlight`] = "on";
    });
  });
  return { ...out, ...over };
}

const saved = (d: SaveDraftDeps) => (d.update as ReturnType<typeof vi.fn>).mock.calls[0][1].content as ProposalContent;

describe("the single 'what the package includes' table (no package rows)", () => {
  it("a changed item name, cell and highlight reach the one updateProposal call", async () => {
    const c = sevetri();
    const r = row(c);
    const d = deps(r);
    const res = await runSaveDraft(
      d,
      form(c, { incFields: "1", "inc.0.label": "Clearance search, renamed", "inc.0.included": "Twice", "inc.0.highlight": "on", "inc.1.label": "Second row", "inc.1.included": "✓" }),
    );
    expect(res).toEqual({ saved: true });
    expect(d.update).toHaveBeenCalledTimes(1);
    expect(saved(d).includes).toEqual([
      { label: "Clearance search, renamed", included: "Twice", highlight: true },
      { label: "Second row", included: "✓" },
    ]);
  });
});

describe("packages with their own rows: the editor edits the table the client sees", () => {
  it("the editor offers one table per offered package, exactly when the client page shows the comparison", async () => {
    const { includesComparison } = await import("@/components/client-proposal/ProposalDocument");
    for (const c of [withRows(), danielle(), sevetri()]) {
      expect(editorPackageIncludes(c) !== null, JSON.stringify(c.packages?.map((p) => p.includes?.length))).toBe(includesComparison(c) !== null);
    }
    expect(editorPackageIncludes(withRows())?.map((p) => p.package)).toEqual(["Essential", "Enhanced", "Concierge"]);
  });

  it("a changed item name, cell and highlight of one package reach the one updateProposal call, and the client sees them", async () => {
    const c = withRows();
    const d = deps(row(c));
    const res = await runSaveDraft(
      d,
      form(c, packageRows(c, { "pkgInc.2.0.label": "Full clearance search", "pkgInc.2.0.included": "Included twice", "pkgInc.2.1.highlight": "on" })),
    );
    expect(res).toEqual({ saved: true });
    expect(d.update).toHaveBeenCalledTimes(1);
    const out = saved(d);
    const concierge = out.packages?.find((p) => p.package === "Concierge");
    expect(concierge?.includes).toEqual([
      { label: "Full clearance search", included: "Included twice" },
      { label: "Non-Substantive Office Action Response", value: "$450 each", included: "Unlimited", highlight: true },
    ]);
    // the packages nobody touched keep the firm's rows
    expect(out.packages?.find((p) => p.package === "Essential")?.includes).toEqual(FIRM_ROWS);
    // what the client page draws from the saved content
    const { includesComparison } = await import("@/components/client-proposal/ProposalDocument");
    const cmp = includesComparison(out, ["Concierge"]);
    expect(cmp?.rows.map((r) => [r.label, r.cells[0], r.highlight === true])).toEqual([
      ["Full clearance search", "Included twice", false],
      ["Non-Substantive Office Action Response", "Unlimited", true],
    ]);
  });

  it("the edit survives the next save, although the firm's list still has its own rows for that package", async () => {
    const c = withRows();
    const first = deps(row(c));
    await runSaveDraft(first, form(c, packageRows(c, { "pkgInc.2.0.label": "Full clearance search" })));
    const afterFirst = saved(first);
    const second = deps(row(afterFirst));
    await runSaveDraft(second, form(afterFirst, packageRows(afterFirst, { greeting: "Hello again" })));
    expect(saved(second).packages?.find((p) => p.package === "Concierge")?.includes?.[0].label).toBe("Full clearance search");
    // and the settings refresh on its own keeps it too
    const refreshed = withPackageSnapshot(afterFirst, SETTING);
    expect(refreshed.packages?.find((p) => p.package === "Concierge")?.includes?.[0].label).toBe("Full clearance search");
  });

  it("rows posted back unchanged leave the firm's rows in charge (#23): a firm change still reaches the draft", async () => {
    const c = withRows();
    const newer = { packages: SETTING.packages.map((p) => ({ ...p, includes: [{ label: "Firm's new row", included: "✓" }] })) };
    const d = deps(row(c), { settingPricing: vi.fn(async () => newer) });
    await runSaveDraft(d, form(c, packageRows(c)));
    expect(saved(d).packages?.find((p) => p.package === "Concierge")?.includes).toEqual([{ label: "Firm's new row", included: "✓" }]);
  });

  it("a row that names the office action response is refused like any other included item", async () => {
    const c = withRows();
    const { validateContent } = await import("@/lib/proposals/validate");
    const d = deps(row(c));
    await runSaveDraft(d, form(c, packageRows(c, { "pkgInc.0.0.label": "Substantive Office Action Response" })));
    const out = saved(d);
    expect(validateContent(out).some((i) => i.level === "error" && /^packages\[0\]\.includes\[0\]/.test(i.path))).toBe(true);
  });
});

describe("the editor's includes inputs all belong to the one editor form", () => {
  function fees(content: ProposalContent) {
    return renderToStaticMarkup(
      createElement(
        "form",
        { id: "pe-draft" },
        createElement(FeesSection, {
          editable: true,
          issues: [],
          payUrl: "",
          expiresOn: "",
          adjustments: [],
          pricing: { package: "Concierge", base: "4950", includedClasses: "3", perClass: "825", secondMarkPct: "20", govPerClass: "350" },
          includes: content.includes ?? [],
          packageIncludes: editorPackageIncludes(content),
        }),
      ),
    );
  }

  it("with package rows: one table per package, the marker, and every input inside the form", () => {
    const html = fees(withRows());
    const end = html.indexOf("</form>");
    expect(html).toContain('name="pkgIncFields"');
    for (const pkg of ["Essential", "Enhanced", "Concierge"]) expect(html).toContain(`value="${pkg}"`);
    const names = [...html.matchAll(/name="((?:pkgInc|inc)\.[^"]+)"/g)];
    expect(names.length).toBeGreaterThan(0);
    for (const m of names) expect(m.index!, m[1]).toBeLessThan(end);
    // the single table the client never sees is not offered beside them
    expect(html).not.toContain('name="incFields"');
    expect(html).not.toMatch(/name="inc\.\d/);
  });

  it("without package rows: the single table and its marker, inside the form", () => {
    const html = fees(sevetri());
    expect(html).toContain('name="incFields"');
    expect(html).not.toContain('name="pkgIncFields"');
    const end = html.indexOf("</form>");
    for (const m of html.matchAll(/name="(inc\.[^"]+)"/g)) expect(m.index!, m[1]).toBeLessThan(end);
  });
});
