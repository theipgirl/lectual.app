// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_PLAN_OPTIONS, planImport, type PlanOptions, type PlanStage } from "@/lib/lawmatics/import-plan";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";

/**
 * What the importer's preview SHOWS. The view model is built by the real server action (with the pull mocked),
 * then rendered, so the groups, the summary line and the search box a person sees are the ones tested.
 */

const state = vi.hoisted(() => ({ preview: null as unknown }));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({ rpc: async (fn: string) => ({ data: fn === "current_org_role" ? "owner" : null, error: null }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/lawmatics/connection", () => ({
  LawmaticsNotConnectedError: class extends Error {},
  recordLawmaticsOutcome: async () => {},
  checkTokenShape: () => ({ ok: true, token: "t" }),
  verifyLawmaticsToken: async () => ({ ok: true }),
  saveLawmaticsToken: async () => ({ ok: true }),
  disconnectLawmatics: async () => ({ ok: true }),
}));
vi.mock("@/lib/lawmatics/import", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lawmatics/import")>("@/lib/lawmatics/import");
  return { ...actual, previewImport: async () => state.preview };
});

const { importAction } = await import("@/app/dashboard/settings/integrations/lawmatics/actions");
const { ClientsImport, PreviewBody } = await import("@/components/lawmatics/LawmaticsImport");

const STAGES: PlanStage[] = [
  { id: "s-pnc", name: "Potential New Client", category: "open", orderIndex: 1 },
  { id: "s-consult", name: "Consultation Scheduled", category: "open", orderIndex: 3 },
  { id: "s-won", name: "Signed LOE / Deposit Received", category: "won", orderIndex: 7 },
];

const rec = (over: Partial<LawmaticsSourceRecord>): LawmaticsSourceRecord => ({
  lawmaticsId: "p1", matterName: "M", firstName: "Odalys", lastName: "Brightwater", email: "o@x.example", phone: null, businessName: null,
  website: null, stageName: "Consultation Scheduled", practiceArea: "Trademark", createdAt: null, updatedAt: null, contactId: null, referralSource: null, ...over,
});

async function previewOf(options: PlanOptions, extra: { truncated?: boolean } = {}) {
  const plan = planImport(
    [
      rec({}),
      rec({ lawmaticsId: "p2", email: "s@prospera.example", firstName: "Sévetri", lastName: "Wren", stageName: "Proposal Sent" }),
      rec({ lawmaticsId: "p3", email: "c@x.example", firstName: "Cato", lastName: "Mbeki", stageName: "Hired Client" }),
      rec({ lawmaticsId: "p4", email: "n@x.example", firstName: "Nora", lastName: "Patent", practiceArea: "Patent" }),
      rec({ lawmaticsId: "p5", email: "z@x.example", firstName: "Zed", lastName: "Blank", practiceArea: null }),
    ],
    STAGES,
    [],
    options,
    [{ lawmaticsId: "c1", firstName: "Lone", lastName: "Contact", email: "lone@x.example", phone: null, businessName: null, website: null }],
  );
  state.preview = {
    fetchedAt: "2026-10-22T00:00:00.000Z",
    plan,
    counts: { prospects: 5, contacts: 1 },
    truncated: extra.truncated ?? false,
    truncatedReason: extra.truncated ? "Stopped at the 3000-record safety cap." : undefined,
    includeDropped: false,
    stageNames: STAGES.map((s) => s.name),
  };
  const result = await importAction({ phase: "idle" }, new FormData());
  if (result.phase !== "preview" || !result.preview) throw new Error(result.error ?? "no preview");
  return result.preview;
}

const html = (p: Awaited<ReturnType<typeof previewOf>>) => renderToStaticMarkup(<PreviewBody p={p} action={() => {}} pending={false} />);
const plain = (s: string) => s.replace(/<!-- -->/g, "").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the import preview shows every person it would place by hand or leave out", () => {
  it("lists the stage-decision people by name with the wording, open (not only a count)", async () => {
    const out = html(await previewOf(DEFAULT_PLAN_OPTIONS));
    const s = plain(out);
    expect(s).toContain("Imported, stage needs a decision");
    expect(s).toContain("Imported, stage needs a decision: Proposal Sent");
    expect(s).toContain("Sévetri Wren");
    expect(s).toContain("Hired in Lawmatics — open a matter");
    expect(s).toContain("Cato Mbeki");
    expect(out).toMatch(/<details class="lx-lm-section" open="">\s*<summary>Imported, stage needs a decision/);
  });

  it("states the summary line as skipped and need-a-decision counts", async () => {
    const out = html(await previewOf(DEFAULT_PLAN_OPTIONS));
    expect(plain(out)).toContain("0 skipped, 5 need a stage decision.");
  });

  it("with the filter on, every excluded person is listed by name with the reason, visible", async () => {
    const view = await previewOf({ ...DEFAULT_PLAN_OPTIONS, practiceAreaFilter: "Trademark" });
    const out = html(view);
    const s = plain(out);
    expect(s).toContain("Nora Patent");
    expect(s).toContain('practice area "Patent" excluded by filter "Trademark"');
    expect(s).toContain("Zed Blank");
    expect(s).toContain("no practice area on record");
    expect(s).toContain("Lone Contact");
    expect(s).toMatch(/3 skipped, 3 need a stage decision\./);
    expect(out).toMatch(/<details class="lx-lm-section" open="">\s*<summary>Skipped/);
  });

  it("lists the contact-only people as their own group", async () => {
    const s = plain(html(await previewOf(DEFAULT_PLAN_OPTIONS)));
    expect(s).toContain("New leads from Lawmatics contacts (no matter in Lawmatics)");
    expect(s).toContain("Lone Contact");
    expect(s).toContain("source: Lawmatics contact");
  });

  it("a truncated pull still shows the warning, never a complete-looking preview", async () => {
    const s = plain(html(await previewOf(DEFAULT_PLAN_OPTIONS, { truncated: true })));
    expect(s).toContain("Not everything was read from Lawmatics.");
    expect(s).toContain("Stopped at the 3000-record safety cap.");
  });

  it("has a labelled search box", async () => {
    const out = html(await previewOf(DEFAULT_PLAN_OPTIONS));
    expect(plain(out)).toContain("Find a person in this pull");
    expect(out).toMatch(/<label class="lx-field"><span class="lx-label">Find a person in this pull<\/span><input[^>]*type="search"/);
  });

  it("the view model carries every person for the search, once each", async () => {
    const view = await previewOf(DEFAULT_PLAN_OPTIONS);
    expect(view.people).toHaveLength(6);
    expect(view.peopleTruncated).toBe(false);
  });
});

describe("the options before a preview", () => {
  it("the Trademark-only filter starts UNCHECKED (the default stays off)", () => {
    const out = renderToStaticMarkup(<ClientsImport />);
    expect(out).toMatch(/name="trademarkOnly"/);
    expect(out).not.toMatch(/name="trademarkOnly"[^>]*checked/);
    expect(out).not.toMatch(/checked=""[^>]*name="trademarkOnly"/);
  });
});
