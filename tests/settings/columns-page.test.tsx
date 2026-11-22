import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COLUMNS_SETTINGS_NAME, COLUMNS_SETTINGS_SUB } from "@/lib/ui/words";

/** F1: Settings -> Columns is the admin tier's; everyone else, an unreadable role and a signed-out caller get notFound. */
const state = vi.hoisted(() => ({ role: null as string | null, loads: 0 }));
vi.mock("@/lib/auth/current-role", () => ({ currentRole: async () => state.role }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({}) }));
vi.mock("@/lib/custom-columns/settings-load", () => ({
  loadColumnsSettings: async () => {
    state.loads += 1;
    return { status: "not-set-up" };
  },
}));
vi.mock("@/lib/custom-columns/actions", () => ({ createFieldAction: vi.fn(), updateFieldAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

async function render() {
  const { default: Page } = await import("@/app/dashboard/settings/columns/page");
  return renderToStaticMarkup(await Page());
}

describe("F1: the page gate", () => {
  beforeEach(() => {
    state.loads = 0;
  });
  for (const role of ["paralegal", "attorney", "intake", "law_clerk", "clerk", "viewer", "social_media", null]) {
    it(`${role ?? "an unreadable role or a signed-out caller"}: notFound, nothing read`, async () => {
      state.role = role;
      await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(state.loads).toBe(0);
    });
  }
  for (const role of ["owner", "admin", "senior_admin"]) {
    it(`${role}: the page, one h1 "Columns"`, async () => {
      state.role = role;
      const html = (await render()).replace(/&#x27;/g, "'");
      expect(html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(COLUMNS_SETTINGS_NAME);
      expect((html.match(/<h1/g) ?? []).length).toBe(1);
      expect(html).toContain(COLUMNS_SETTINGS_SUB);
      expect(state.loads).toBe(1);
    });
  }
  it("its metadata title is the page's own name", async () => {
    const { metadata } = await import("@/app/dashboard/settings/columns/page");
    expect(String(metadata.title)).toContain(COLUMNS_SETTINGS_NAME);
  });
});
