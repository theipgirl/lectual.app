import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/settings/integrations/" }));

describe("Settings tabs (Sprint 31: Modules is Features)", () => {
  beforeEach(() => vi.resetModules());

  it("the tab list says Features and Assistants, never Modules or Agents; the routes are unchanged", async () => {
    vi.doMock("@/lib/org/modules", () => ({ activeOrgModules: vi.fn(async () => ["agents", "proposals"]) }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "viewer" })) }));
    vi.doMock("@/lib/setup/load", () => ({ loadSetupState: vi.fn(async () => ({})) }));
    const { default: Layout } = await import("@/app/dashboard/settings/layout");
    const html = renderToStaticMarkup(await Layout({ children: null }));
    expect(html).toContain(">Features<");
    expect(html).toContain(">Assistants<");
    expect(html).not.toContain(">Modules<");
    expect(html).not.toContain(">Agents<");
    expect(html).toMatch(/href="\/dashboard\/settings\/modules\/?"/);
    expect(html).toMatch(/href="\/dashboard\/agents\/?"/);
  });
});
