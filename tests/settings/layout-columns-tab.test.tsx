import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/settings/integrations/" }));

/** F1: the "Columns" settings tab is the admin tier's (a courtesy: the page gates itself). */
async function tabs(role: string) {
  vi.doMock("@/lib/org/modules", () => ({ activeOrgModules: vi.fn(async () => []) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role })) }));
  vi.doMock("@/lib/setup/load", () => ({ loadSetupState: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/setup/checklist", () => ({ setupChecklist: () => ({ doneCount: 1, total: 2 }) }));
  const { default: Layout } = await import("@/app/dashboard/settings/layout");
  return renderToStaticMarkup(await Layout({ children: null }));
}

describe("Settings -> Columns tab", () => {
  beforeEach(() => vi.resetModules());
  for (const role of ["owner", "admin", "senior_admin"])
    it(`${role}: shown`, async () => {
      const html = await tabs(role);
      expect(html).toMatch(/href="\/dashboard\/settings\/columns\/?"[^>]*>Columns</);
    });
  for (const role of ["attorney", "viewer"])
    it(`${role}: absent`, async () => {
      const html = await tabs(role);
      expect(html).not.toContain("/dashboard/settings/columns");
    });
});
