import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PIPELINE_VIEW_ONLY } from "@/lib/ui/words";

vi.mock("server-only", () => ({}));

async function render(load: Record<string, unknown>, params: { q?: string; owner?: string } = {}) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", user: { id: "u-1" }, role: "owner" })) }));
  vi.doMock("@/lib/lifecycle/load", () => ({
    loadPipeline: vi.fn(async () => ({ leads: "ok", matters: "ok", cards: [], owners: [{ id: "u-2", name: "Dana" }], notes: [], ...load })),
  }));
  const { default: Page } = await import("@/app/dashboard/pipeline/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

describe("Pipeline (sprint 31)", () => {
  beforeEach(() => vi.resetModules());

  it("says in one line that it is a view-only overview and where to move a lead", async () => {
    const html = await render({});
    expect(html).toContain("This is a view-only overview. To move a lead, open it in Leads.");
    expect(PIPELINE_VIEW_ONLY).toBe("This is a view-only overview. To move a lead, open it in Leads.");
    expect(html).not.toContain("lx-label");
  });

  it("column headers link to the Leads board (lead columns) and the Matters board (the rest)", async () => {
    const html = await render({});
    const href = (column: string) => html.match(new RegExp(`data-column-link="${column}" href="([^"]+)"`))?.[1];
    expect(href("intake")).toMatch(/^\/dashboard\/intake\/?\?view=board$/);
    expect(href("consult")).toMatch(/^\/dashboard\/intake\/?\?view=board$/);
    expect(href("engaged")).toMatch(/^\/dashboard\/matters\/?\?view=board$/);
    expect(href("registered")).toMatch(/^\/dashboard\/matters\/?\?view=board$/);
  });

  it("uses the shared chips for the owner row and the shared search with Clear when a term is set", async () => {
    const html = await render({}, { q: "acme" });
    expect(html).toContain('class="lp-chip');
    expect(html).toContain(">Mine<");
    expect(html).toMatch(/<a class="lp-clear" href="[^"]*">Clear<\/a>/);
    expect(await render({})).not.toContain(">Clear<");
  });

  it("a half that could not load says so in plain words, never as empty", async () => {
    const html = await render({ leads: "unavailable" });
    expect(html).toContain("Leads couldn&#x27;t be loaded, so the first two columns can&#x27;t be shown. Refresh to try again.");
    expect(html).toContain("Can&#x27;t show this column right now.");
    expect(html).not.toContain("unknown (not empty)");
  });
});
