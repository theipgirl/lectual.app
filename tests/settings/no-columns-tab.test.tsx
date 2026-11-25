import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/settings/integrations/" }));

/** Changed on purpose (editable views): Settings -> Columns is gone; columns are changed from the List's own header menu by an owner. */
async function tabs(role: string) {
  vi.doMock("@/lib/org/modules", () => ({ activeOrgModules: vi.fn(async () => []) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role })) }));
  vi.doMock("@/lib/setup/load", () => ({ loadSetupState: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/setup/checklist", () => ({ setupChecklist: () => ({ doneCount: 1, total: 2 }) }));
  const { default: Layout } = await import("@/app/dashboard/settings/layout");
  return renderToStaticMarkup(await Layout({ children: null }));
}

describe("Settings has no Columns tab", () => {
  beforeEach(() => vi.resetModules());
  for (const role of ["owner", "admin", "senior_admin", "attorney", "viewer"])
    it(`${role}: absent`, async () => {
      const html = await tabs(role);
      expect(html).not.toContain("/dashboard/settings/columns");
      expect(html).not.toMatch(/>Columns</);
    });
  it("the page is gone: no file under settings/columns", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync("src/app/dashboard/settings/columns")).toBe(false);
    expect(existsSync("src/components/settings/ColumnsSettings.tsx")).toBe(false);
  });
});
