import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * /dashboard/copilot/ — the AI copilot page. Guards the two properties that
 * matter most on the highest-liability surface in the product: the page
 * tells the truth about whether the copilot is configured (never shows a
 * chat box that can only fail on the first question), and nothing on it is
 * fabricated — every answer the chat panel can show comes from a real
 * POST /api/matters-chat call, never from data baked into the page.
 */

async function render() {
  const { default: CopilotPage } = await import("@/app/dashboard/copilot/page");
  return renderToStaticMarkup(CopilotPage());
}

describe("CopilotPage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("says plainly when no AI provider is configured, and renders no chat box", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => false }));
    const html = await render();

    expect(html).toContain("isn&#x27;t configured for this deployment yet");
    expect(html).not.toContain("cpl-composer");
  });

  it("renders the chat panel with suggested prompts when configured", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
    const html = await render();

    expect(html).toContain("Ask the copilot");
    expect(html).toContain("What&#x27;s due in the next two weeks?");
  });

  it("renders no fabricated matter, statistic, or sample conversation", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
    const html = await render();

    // Invented matter references or model statistics baked into the page.
    expect(html).not.toMatch(/TM-\d{4}-\d{4}/);
    expect(html).not.toMatch(/\b\d{1,3}%\s*(confidence|success)/i);
    // Mock conversation furniture — this page has no canned thread.
    expect(html).not.toMatch(/Design preview|Illustrative|sample thread/i);
  });

  it("states the UPL boundary plainly", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
    const html = await render();

    expect(html).toMatch(/never gives legal analysis/i);
    expect(html).toMatch(/attorney of record/i);
  });
});
