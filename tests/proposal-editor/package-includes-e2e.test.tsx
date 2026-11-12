import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runSaveDraft, type SaveDraftDeps } from "@/lib/proposal-editor/save-draft";
import { proposalActionError } from "@/app/dashboard/proposals/errors";
import { validateContent } from "@/lib/proposals/validate";
import { chosenPackageNames } from "@/lib/proposals/chosen-packages";
import { defaultSelection, normalizeSelection } from "@/lib/proposals/pricing";
import type { ProposalDetail } from "@/lib/proposals/store";
import type { ProposalContent, ProposalInclude, ProposalRow, Selection } from "@/lib/proposals/types";
import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { CONCIERGE, ENHANCED, ESSENTIAL, danielle } from "../proposals/danielle-fixture";

vi.mock("next/font/google", () => ({ Bodoni_Moda: () => ({ variable: "b" }), Source_Serif_4: () => ({ variable: "s" }) }));

/**
 * Editor fixes (2026-11-12), "the edits are not showing": the WHOLE path with a realistic proposal, three packages of
 * 17 rows each. The real edit page is rendered, its form fields are collected the way a browser submits them, a few cells
 * are changed, the one save runs, and the client page is drawn from what was saved.
 */

const ID = "77777777-7777-4777-8777-777777777777";
const UPDATED = "2026-11-12T12:00:00Z";
const INCLUDED = ["✓", "1", "Unlimited", "✓", "2 rounds"];

function firmRows(pkg: string): ProposalInclude[] {
  return Array.from({ length: 17 }, (_, i) => ({
    label: `Item ${i + 1}`,
    ...(i % 3 === 0 ? { value: "$450 each" } : {}),
    included: pkg === "Essential" && i % 2 === 1 ? "—" : INCLUDED[i % INCLUDED.length],
    ...(i % 4 === 0 ? { note: `Note ${i + 1}` } : {}),
    ...(i === 2 ? { highlight: true as const } : {}),
  }));
}

function content(): ProposalContent {
  const c = danielle();
  c.packages = [ESSENTIAL, ENHANCED, CONCIERGE].map((p) => ({ ...p, includes: firmRows(p.package) }));
  return c;
}

const SETTING = { packages: [ESSENTIAL, ENHANCED, CONCIERGE].map((p) => ({ ...p, includes: firmRows(p.package) })) };

function row(c: ProposalContent): ProposalRow {
  return {
    id: ID, org_id: "o", family_id: ID, version: 1, public_token: "t".repeat(43), lead_id: null, matter_id: null,
    client_name: "Danielle Milton", client_email: "d@example.com", title: "Trademark Proposal", status: "draft", content: c,
    expires_on: "2026-12-10", pay_url: "https://pay.example/x", source: "manual", created_by: null, updated_by: null, approved_by: null,
    approved_at: null, sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: UPDATED, updated_at: UPDATED,
  };
}

async function renderEditor(proposal: ProposalRow, setting: unknown = SETTING) {
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined), gateStaffAction: vi.fn(async () => null) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner", org: { id: "o", name: "RPB Law", slug: "rpb" }, user: { id: "u" } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: "u9", displayName: "Rebecca Cole", email: "r@example.com" }]) }));
  vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.example") }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: vi.fn(async (): Promise<ProposalDetail> => ({ proposal, versions: [], events: [] })),
    getProposalSettings: vi.fn(async () => ({ pricing: setting, approver_user_ids: ["u9"] })),
    isCurrentUserApprover: vi.fn(async () => true),
    listProposalStepEvents: vi.fn(async () => ({ ok: true, events: [] })),
    listProposalOpens: vi.fn(async () => new Map()),
  }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ GOES_LIVE_ON_APPROVAL: "x", proposalSendBlock: vi.fn(async () => ({ blocked: false })) }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/proposals/lead-link", () => ({ loadLeadLink: vi.fn(async () => ({ state: "none" })) }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: vi.fn(async () => ({ status: "ok", leads: [] })) }));
  vi.doMock("@/components/client-proposal/ProposalDocument", () => ({ ProposalDocument: () => createElement("div", { "data-stub": "document" }) }));
  vi.doMock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn(), retryUploadAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/[id]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ id: ID }) })));
}

const decode = (v: string) => v.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function attrs(tag: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const m of tag.matchAll(/\s([A-Za-z][\w:-]*)(?:="([^"]*)")?/g)) out[m[1]] = m[2] === undefined ? true : decode(m[2]);
  return out;
}

/**
 * What a browser would submit for the form `formId`: every input, select and textarea that sits inside the `<form id>` or names it
 * with `form=`, skipping disabled controls (and anything inside a disabled fieldset), with checkbox and radio semantics.
 */
function submittedFields(html: string, formId: string): FormData {
  const start = html.indexOf(`<form id="${formId}"`);
  expect(start, "the editor form is on the page").toBeGreaterThan(-1);
  const end = html.indexOf("</form>", start);
  const f = new FormData();
  const controls = /<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/g;
  for (const m of html.matchAll(controls)) {
    const tag = m[0];
    const head = /^<[^>]*>/.exec(tag)![0];
    const a = attrs(head);
    const inside = m.index! > start && m.index! < end;
    if (!inside && a.form !== formId) continue;
    if (!a.name || a.disabled !== undefined) continue;
    const name = String(a.name);
    if (tag.startsWith("<input")) {
      const type = String(a.type ?? "text");
      if (["button", "submit", "reset", "file", "image"].includes(type)) continue;
      if ((type === "checkbox" || type === "radio") && a.checked === undefined) continue;
      f.append(name, typeof a.value === "string" ? a.value : type === "checkbox" || type === "radio" ? "on" : "");
    } else if (tag.startsWith("<select")) {
      const opts = [...tag.matchAll(/<option\b[^>]*>/g)].map((o) => attrs(o[0]));
      const chosen = opts.find((o) => o.selected !== undefined) ?? opts[0];
      if (chosen) f.append(name, typeof chosen.value === "string" ? chosen.value : "");
    } else {
      f.append(name, decode(tag.replace(/^<[^>]*>/, "").replace(/<\/textarea>$/, "")));
    }
  }
  return f;
}

function deps(r: ProposalRow, setting: unknown = SETTING): SaveDraftDeps {
  return {
    gate: vi.fn(async () => null),
    getRow: vi.fn(async () => r),
    settingPricing: vi.fn(async () => setting),
    update: vi.fn(async () => r),
    describe: proposalActionError,
    revalidate: vi.fn(),
    rand: () => "ab12",
  };
}
const saved = (d: SaveDraftDeps) => (d.update as ReturnType<typeof vi.fn>).mock.calls[0][1].content as ProposalContent;

/** The `pkgInc.<n>` number the editor gave a package. */
function indexOfPackage(f: FormData, name: string): number {
  for (const [k, v] of f.entries()) {
    const m = /^pkgInc\.(\d+)\.package$/.exec(k);
    if (m && v === name) return Number(m[1]);
  }
  throw new Error(`no table for ${name}`);
}

function clientPage(c: ProposalContent, selection?: Selection) {
  return renderToStaticMarkup(
    createElement(ProposalDocument, {
      content: c, title: "Trademark Proposal", clientName: "Danielle Milton", expiresOn: null, firm: { name: "Hartwell", slug: "hartwell" }, mode: "live",
      ...(selection ? { initialSelection: selection } : {}),
      onAccept: async () => ({ ok: true, payUrl: "https://example.com/pay" }),
    }),
  ).replaceAll("&#x27;", "'");
}

/** The default selection with every brand name on `pkg`. */
function selectionOn(c: ProposalContent, pkg: string): Selection {
  const start = defaultSelection(c);
  const packages: Record<string, string> = {};
  for (const n of c.names) packages[n.id] = pkg;
  return normalizeSelection(c, { ...start, packages });
}

beforeEach(() => vi.resetModules());

describe("the edit page, a browser's submission, the save, and the client page (3 packages x 17 rows)", () => {
  it("every row of every package is in the form, and the form as drawn saves without changing anything", async () => {
    const c = content();
    const f = submittedFields(await renderEditor(row(c)), "pe-draft");
    expect(f.get("pkgIncFields")).toBe("1");
    for (const name of ["Essential", "Enhanced", "Concierge"]) {
      const n = indexOfPackage(f, name);
      for (let i = 0; i < 17; i++) expect(f.get(`pkgInc.${n}.${i}.label`), `${name} row ${i}`).toBe(`Item ${i + 1}`);
    }
    const d = deps(row(c));
    expect(await runSaveDraft(d, f)).toEqual({ saved: true });
    expect(saved(d).packages).toEqual(c.packages);
    expect(validateContent(saved(d)).filter((i) => i.level === "error" && /includes/.test(i.path))).toEqual([]);
  });

  it("a changed cell, a note and a highlight reach the one update, are marked edited, and the client sees them for each package", async () => {
    const c = content();
    const f = submittedFields(await renderEditor(row(c)), "pe-draft");
    const enh = indexOfPackage(f, "Enhanced");
    const ess = indexOfPackage(f, "Essential");
    const con = indexOfPackage(f, "Concierge");
    f.set(`pkgInc.${enh}.5.included`, "Twice a year"); // "In this package", Enhanced
    f.set(`pkgInc.${ess}.7.note`, "Essential-only wording"); // a note on Essential
    f.set(`pkgInc.${con}.9.highlight`, "on"); // a highlight on Concierge
    const d = deps(row(c));
    expect(await runSaveDraft(d, f)).toEqual({ saved: true });
    expect(d.update).toHaveBeenCalledTimes(1);
    const out = saved(d);
    const pkg = (n: string) => out.packages!.find((p) => p.package === n)!;
    expect(pkg("Enhanced").includes?.[5].included).toBe("Twice a year");
    expect(pkg("Essential").includes?.[7].note).toBe("Essential-only wording");
    expect(pkg("Concierge").includes?.[9].highlight).toBe(true);
    for (const n of ["Enhanced", "Essential", "Concierge"]) expect(pkg(n).includes_edited, n).toBe(true);
    expect(validateContent(out).filter((i) => i.level === "error")).toEqual([]);

    // the client page: default (Enhanced), then each package chosen
    expect(clientPage(out)).toContain("Twice a year");
    const onEssential = clientPage(out, selectionOn(out, "Essential"));
    expect(onEssential).toContain("Essential-only wording");
    expect(onEssential).toContain("Item 8"); // the row that carries the note
    const onConcierge = clientPage(out, selectionOn(out, "Concierge"));
    expect(onConcierge).toMatch(/<tr class="cp-hl"><th scope="row">Item 10/);
    expect(chosenPackageNames(out, selectionOn(out, "Concierge"))).toEqual(["Concierge"]);
  });

  it("a second save with no change keeps the edits, also after the firm's own rows change", async () => {
    const c = content();
    const f1 = submittedFields(await renderEditor(row(c)), "pe-draft");
    const enh = indexOfPackage(f1, "Enhanced");
    f1.set(`pkgInc.${enh}.5.included`, "Twice a year");
    const d1 = deps(row(c));
    await runSaveDraft(d1, f1);
    const afterFirst = saved(d1);

    vi.resetModules();
    const newer = { packages: SETTING.packages.map((p) => ({ ...p, includes: [{ label: "Firm's new row", included: "✓" }] })) };
    const f2 = submittedFields(await renderEditor(row(afterFirst), newer), "pe-draft");
    const d2 = deps(row(afterFirst), newer);
    expect(await runSaveDraft(d2, f2)).toEqual({ saved: true });
    const out = saved(d2);
    // the edited package keeps its own 17 rows ...
    expect(out.packages!.find((p) => p.package === "Enhanced")?.includes).toHaveLength(17);
    expect(out.packages!.find((p) => p.package === "Enhanced")?.includes?.[5].included).toBe("Twice a year");
    // ... and a package nobody edited follows the firm (#23)
    expect(out.packages!.find((p) => p.package === "Essential")?.includes).toEqual([{ label: "Firm's new row", included: "✓" }]);
  });
});

describe("a live version (status sent) cannot be edited, and its includes table does not look editable", () => {
  it("every includes input is in a disabled fieldset, with no Add row or Remove, and a browser posts none of them", async () => {
    const c = content();
    const html = await renderEditor({ ...row(c), status: "sent", sent_at: UPDATED });
    const at = html.indexOf('class="pe-pkg-incs"');
    expect(at).toBeGreaterThan(-1);
    const fieldsetStart = html.lastIndexOf("<fieldset", at);
    expect(html.slice(fieldsetStart, at)).toMatch(/^<fieldset[^>]*\bdisabled=""/);
    const tables = html.slice(at, html.indexOf("</fieldset>", at));
    expect(tables).not.toContain("+ Add row");
    expect(tables).not.toContain("Remove");
    // no Save buttons either
    expect(html).not.toMatch(/<button[^>]*>Save<\/button>/);
  });
});
