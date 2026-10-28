import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SCOPES_MAIL_ONLY, SCOPES_WITH_CALENDAR } from "../calendar/world";

afterEach(() => vi.resetModules());

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("<!-- -->", "");
const PHRASE = "Allow calendar";

const row = (provider: string, status: string, over: Record<string, unknown> = {}) => ({
  id: `${provider}-${status}`,
  provider,
  status,
  scope: "personal",
  email: `${provider}@firm.test`,
  matched_count: 2,
  last_synced_at: null,
  last_error: null,
  created_at: "2026-10-01T00:00:00Z",
  scopes: SCOPES_WITH_CALENDAR,
  ...over,
});

async function render(connections: unknown[], role = "owner") {
  vi.resetModules();
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => m === "mailbox") }));
  vi.doMock("@/lib/mailbox/connections", () => ({ listConnections: vi.fn(async () => ({ ok: true, connections })) }));
  vi.doMock("@/lib/mailbox/config", () => ({ connectableProviders: () => ({ google: true, microsoft: true }) }));
  vi.doMock("@/lib/lawmatics/connection", () => ({ getLawmaticsConnection: vi.fn(async () => ({ ok: true, connection: null })) }));
  vi.doMock("@/lib/payments/lawpay-connection", () => ({ getLawPayConnection: vi.fn(async () => ({ ok: true, connection: null })) }));
  vi.doMock("@/lib/payments/lawpay-config", () => ({ lawPaySetup: () => ({ ready: true }) }));
  vi.doMock("@/lib/meetings/connection", () => ({ listMeetingConnections: vi.fn(async () => ({ ok: true, connections: [] })) }));
  vi.doMock("@/components/mailbox/DisconnectButton", () => ({ DisconnectButton: () => <button type="button">Disconnect</button> }));
  const { default: Page } = await import("../../src/app/dashboard/settings/integrations/page");
  return text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) })));
}

describe("F11: Settings → Integrations, Allow calendar", () => {
  it("an active Microsoft mailbox without Calendars.Read shows a link for a manager, to the same connect URL Reconnect uses", async () => {
    const html = await render([row("microsoft", "active", { scopes: SCOPES_MAIL_ONLY })]);
    expect(html).toContain(PHRASE);
    expect(html).toMatch(/<a href="\/api\/mailbox\/connect\/microsoft\/\?scope=personal"[^>]*>Allow calendar<\/a>/);
    expect(html).toContain("Mail keeps working");
    // The existing Reconnect (for a dead token) is not shown for an active row.
    expect(html).not.toMatch(/>Reconnect<\/a>/);
  });

  it("a row with no scopes list at all is treated as lacking it", async () => {
    expect(await render([row("microsoft", "active", { scopes: undefined })])).toContain(PHRASE);
    expect(await render([row("microsoft", "active", { scopes: null })])).toContain(PHRASE);
  });

  it("a non-manager sees the sentence but no link (a shared mailbox viewed by a viewer)", async () => {
    const html = await render([row("microsoft", "active", { scope: "firm", scopes: SCOPES_MAIL_ONLY })], "viewer");
    expect(html).toContain(PHRASE);
    expect(html).not.toMatch(/<a [^>]*>Allow calendar<\/a>/);
    expect(html).toContain("Mail keeps working meanwhile");
  });

  it("a mailbox that holds the scope does not show it", async () => {
    expect(await render([row("microsoft", "active")])).not.toContain(PHRASE);
  });

  it("a Google mailbox never shows it, with or without the scope", async () => {
    expect(await render([row("google", "active", { scopes: [] })])).not.toContain(PHRASE);
  });

  it("a reauth row shows only the existing Reconnect", async () => {
    const html = await render([row("microsoft", "reauth", { scopes: SCOPES_MAIL_ONLY, last_error: "Microsoft revoked access. Reconnect to resume syncing." })]);
    expect(html).not.toContain(PHRASE);
    expect(html).toMatch(/<a href="\/api\/mailbox\/connect\/microsoft\/\?scope=personal"[^>]*>Reconnect<\/a>/);
  });
});
