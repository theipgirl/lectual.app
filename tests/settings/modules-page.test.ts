import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/link adds the trailing slash the app's config asks for only when this is set.
process.env.__NEXT_TRAILING_SLASH = "true";

type Conn = { status: "active" | "reauth" | "error" | "revoked" };

async function render(modules: string[], list: () => Promise<{ ok: true; connections: Conn[] } | { ok: false; error: string }>) {
  const listConnections = vi.fn(list);
  vi.doMock("@/lib/org/modules", () => ({ activeOrgModules: vi.fn(async () => modules) }));
  vi.doMock("@/lib/mailbox/connections", () => ({ listConnections }));
  const { default: Page } = await import("../../src/app/dashboard/settings/modules/page");
  return { html: renderToStaticMarkup(await Page()), listConnections };
}

/** The Mailboxes row only, so other rows' "On"/"Off" can't satisfy an assertion. */
function mailboxRow(html: string): string {
  const start = html.indexOf("Mailboxes");
  const end = html.indexOf("Agents", start);
  return html.slice(start, end);
}

describe("Settings → Modules: Mailboxes row (S2)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("on with nothing connected says so, as a warning, with a link to fix it", async () => {
    const { html } = await render(["mailbox"], async () => ({ ok: true, connections: [] }));
    const row = mailboxRow(html);
    expect(row).toContain("On · none connected");
    expect(row).toContain("lx-pill-warn");
    expect(row).toContain('href="/dashboard/settings/mailboxes/"');
    expect(row).not.toMatch(/>On</);
  });

  it("a failed read says it couldn't check, as a risk, never 'none connected'", async () => {
    const { html } = await render(["mailbox"], async () => ({ ok: false, error: "boom" }));
    const row = mailboxRow(html);
    expect(row).toContain("couldn&#x27;t check connections");
    expect(row).toContain("lx-pill-risk");
    expect(row).not.toContain("none connected");
  });

  it("a rejected read is the same as a failed one", async () => {
    const { html } = await render(["mailbox"], async () => {
      throw new Error("down");
    });
    expect(mailboxRow(html)).toContain("couldn&#x27;t check connections");
  });

  it("two active connections show '2 connected'", async () => {
    const { html } = await render(["mailbox"], async () => ({ ok: true, connections: [{ status: "active" }, { status: "active" }] }));
    const row = mailboxRow(html);
    expect(row).toContain("On · 2 connected");
    expect(row).toContain("lx-pill-ok");
  });

  it("counts only active connections: one active and one needing reconnection is '1 connected'", async () => {
    const { html } = await render(["mailbox"], async () => ({ ok: true, connections: [{ status: "active" }, { status: "reauth" }] }));
    expect(mailboxRow(html)).toContain("On · 1 connected");
  });

  it("says colleagues' personal mailboxes are private, so the count is the firm's plus your own", async () => {
    const { html } = await render(["mailbox"], async () => ({ ok: true, connections: [{ status: "active" }] }));
    expect(html).toContain("personal mailboxes are private to them");
    expect(html).toContain("plus your own");
  });

  it("with the module off the row says Off, never reads connections, and the other rows still render", async () => {
    const { html, listConnections } = await render(["agents"], async () => ({ ok: true, connections: [] }));
    expect(listConnections).not.toHaveBeenCalled();
    expect(mailboxRow(html)).toContain(">Off<");
    expect(mailboxRow(html)).not.toContain("private to them");
    expect(html).toContain("Document Center");
    expect(html).toContain("Litigation");
    const agentsRow = html.slice(html.indexOf("Agents</span>"), html.indexOf("Document Center"));
    expect(agentsRow).toContain(">On<");
  });
});
