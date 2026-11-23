import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntegrationRow, ROW_ICON, RowIcon } from "@/components/integrations/IntegrationRow";
import { LAWMATICS_TOKEN_HELP, SWITCH_ON_WORDS } from "@/lib/ui/words";

afterEach(() => vi.resetModules());
const page = readFileSync("src/app/dashboard/settings/integrations/page.tsx", "utf8");

describe("F14: one row design", () => {
  it("a row without a body is a header with its action; with a body it opens", () => {
    const flat = renderToStaticMarkup(<IntegrationRow id="x-title" title="X" state="connected" icon={<RowIcon path={ROW_ICON.lawpay} />} actions={<a href="/x">Open</a>} />);
    expect(flat).toContain('class="lx-int-row"');
    expect(flat).toContain('<h3 id="x-title"');
    expect(flat).toContain(">Connected<");
    expect(flat).toContain(">Open</a>");
    const open = renderToStaticMarkup(
      <IntegrationRow title="Y" state="not-connected" icon={<RowIcon path={ROW_ICON.meetings} />} defaultOpen>
        <p>body</p>
      </IntegrationRow>,
    );
    expect(open).toContain("<details");
    expect(open).toContain("<summary>");
    expect(open).toContain("<p>body</p>");
  });

  it("every card on the page is an IntegrationRow", () => {
    expect(page.match(/<IntegrationRow\b/g)?.length).toBe(4); // Lawmatics, LawPay, Meetings, and the provider row
    expect(page).not.toContain("<IntegrationHeader");
    expect(page).not.toContain('className="lx-int-import"');
  });

  it("has no Coming soon rows: no SOON list, no IMAP, no MCP placeholder", () => {
    expect(page).not.toMatch(/SOON|Coming soon|Email \(IMAP\)|AI assistants/);
  });
});

describe("F14: disabled buttons say Lectual needs to switch this on", () => {
  it("the words are one constant", () => {
    expect(SWITCH_ON_WORDS).toBe("Lectual needs to switch this on");
  });

  it("a provider that isn't set up shows the sentence, tied to the button with aria-describedby", async () => {
    vi.resetModules();
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner" })) }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => true) }));
    vi.doMock("@/lib/mailbox/connections", () => ({ listConnections: vi.fn(async () => ({ ok: true, connections: [] })) }));
    vi.doMock("@/lib/mailbox/config", () => ({ connectableProviders: () => ({ google: false, microsoft: false }) }));
    vi.doMock("@/lib/lawmatics/connection", () => ({ getLawmaticsConnection: vi.fn(async () => ({ ok: true, connection: null })) }));
    vi.doMock("@/lib/payments/lawpay-connection", () => ({ getLawPayConnection: vi.fn(async () => ({ ok: true, connection: null })) }));
    vi.doMock("@/lib/payments/lawpay-config", () => ({ lawPaySetup: () => ({ ready: true }) }));
    vi.doMock("@/lib/meetings/connection", () => ({ listMeetingConnections: vi.fn(async () => ({ ok: true, connections: [] })) }));
    vi.doMock("@/components/mailbox/DisconnectButton", () => ({ DisconnectButton: () => null }));
    const { default: Page } = await import("../../src/app/dashboard/settings/integrations/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(SWITCH_ON_WORDS);
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-describedby="switch-on-google-personal"/);
    expect(html).toContain('id="switch-on-google-personal"');
    expect(html).toContain('id="switch-on-hero-google"');
  });
});

describe("F14: Lawmatics token help", () => {
  it("shows where the token comes from, next to the token field", () => {
    expect(LAWMATICS_TOKEN_HELP).toBe("In Lawmatics: Settings → API → create a token, then paste it here");
    const src = readFileSync("src/components/lawmatics/LawmaticsImport.tsx", "utf8");
    expect(src).toContain("{LAWMATICS_TOKEN_HELP}");
    expect(src).toContain('aria-describedby="lawmatics-token-help"');
  });
});
