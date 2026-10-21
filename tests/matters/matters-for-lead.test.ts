import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb, type FakeDb } from "./helpers/fake-db";
import { standardSeed } from "./helpers/seed";

/**
 * Sprint 8, item 6: the lead page's "Matters" line. The loader has three states
 * (found, none, couldn't load) and reads through the scoped client; the line
 * renders a link per matter, "No matters yet." for none, and a warning (never the
 * empty line) for a failed read.
 */

const h = vi.hoisted(() => ({ db: null as unknown as { client(): unknown } }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));

const { loadMattersForLead } = await import("@/lib/matters/for-lead");
const { LeadMattersLine } = await import("@/components/leads/LeadMatters");

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'");

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb({
    tables: {
      ...standardSeed(),
      crm_matter_stage: [{ id: "stage-3", org_id: "org-1", code: "3", label: "Awaiting filing" }],
    },
  });
  h.db = db;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadMattersForLead", () => {
  it("returns every matter whose lead_id is the lead, with number, label and stage", async () => {
    Object.assign(db.rows("crm_matter").find((m) => m.id === "matter-1")!, { lead_id: "lead-1", mark_text: "SANKOFA", stage_id: "stage-3" });
    db.rows("crm_matter").push({ id: "matter-2", org_id: "org-1", type: "CR", matter_number: "CR-2026-0002", title: "Second", lead_id: "lead-1", mark_text: null, stage_id: null, created_at: "2026-10-01T00:00:00Z" });
    db.rows("crm_matter").push({ id: "matter-other-lead", org_id: "org-1", type: "TM", matter_number: "TM-2026-0003", title: "Not theirs", lead_id: "lead-2", stage_id: null });
    const read = await loadMattersForLead("lead-1");
    expect(read.status).toBe("ok");
    if (read.status === "ok") {
      expect(read.matters).toHaveLength(2);
      expect(read.matters.find((m) => m.id === "matter-1")).toEqual({ id: "matter-1", matterNumber: "TM-2026-0001", label: "SANKOFA", stageLabel: "3. Awaiting filing" });
      expect(read.matters.find((m) => m.id === "matter-2")).toEqual({ id: "matter-2", matterNumber: "CR-2026-0002", label: "Second", stageLabel: "No stage" });
    }
  });

  it("returns none when the read worked and the lead has no matter", async () => {
    expect(await loadMattersForLead("lead-1")).toEqual({ status: "none" });
  });

  it("never shows another firm's matters (scoped read)", async () => {
    db.rows("crm_matter").find((m) => m.id === "matter-x")!.lead_id = "lead-1";
    expect(await loadMattersForLead("lead-1")).toEqual({ status: "none" });
  });

  it("returns unavailable, not none, when the read fails, and does not throw", async () => {
    db.fail("crm_matter", "select");
    await expect(loadMattersForLead("lead-1")).resolves.toEqual({ status: "unavailable" });
  });
});

describe("LeadMattersLine", () => {
  it("links each matter to /dashboard/matters/<id>/", () => {
    const html = renderToStaticMarkup(
      LeadMattersLine({
        read: {
          status: "ok",
          matters: [
            { id: "m-1", matterNumber: "TM-2026-0001", label: "SANKOFA", stageLabel: "3. Awaiting filing" },
            { id: "m-2", matterNumber: "CR-2026-0002", label: "Second", stageLabel: "No stage" },
          ],
        },
      }),
    );
    expect(html).toContain(">Matters<");
    // next/link adds the trailing slash from next.config at build time; the test renderer does not.
    expect(html).toMatch(/href="\/dashboard\/matters\/m-1\/?"/);
    expect(html).toMatch(/href="\/dashboard\/matters\/m-2\/?"/);
    expect(html).toContain(">SANKOFA</a>");
    expect(text(html)).toContain("TM-2026-0001 · 3. Awaiting filing");
    expect(html).not.toContain("No matters yet.");
  });

  it("says 'No matters yet.' for none", () => {
    const html = renderToStaticMarkup(LeadMattersLine({ read: { status: "none" } }));
    expect(html).toContain("No matters yet.");
    expect(html).not.toContain("<a ");
  });

  it("warns that matters couldn't be loaded, and does not show the empty line", () => {
    const html = renderToStaticMarkup(LeadMattersLine({ read: { status: "unavailable" } }));
    expect(text(html)).toContain("Matters couldn't be loaded.");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No matters yet.");
  });
});
