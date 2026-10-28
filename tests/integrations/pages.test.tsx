import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => vi.resetModules());

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("<!-- -->", "");

type World = {
  role?: string;
  mailboxModule?: boolean;
  mailboxes?: { ok: boolean; connections?: unknown[] };
  lawmatics?: { ok: boolean; connection?: unknown };
  lawpay?: { ok: boolean; connection?: unknown };
  meetings?: { ok: boolean; connections?: unknown[] };
  lawpayReady?: boolean;
  connectable?: { google: boolean; microsoft: boolean };
  zoom?: { ready: true } | { ready: false; missing: "oauth-app" | "encryption-key" };
  fathomReady?: boolean;
};

const conn = (provider: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: `${provider}-${status}`,
  provider,
  status,
  scope: "personal",
  email: `${provider}@firm.test`,
  matched_count: 2,
  last_synced_at: null,
  last_error: null,
  created_at: "2026-10-01T00:00:00Z",
  account_hint: "acct",
  last_import_at: null,
  ...extra,
});

function mockWorld(w: World) {
  vi.resetModules();
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: w.role ?? "owner" })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => (m === "mailbox" ? (w.mailboxModule ?? true) : false)) }));
  vi.doMock("@/lib/mailbox/connections", () => ({ listConnections: vi.fn(async () => w.mailboxes ?? { ok: true, connections: [] }) }));
  vi.doMock("@/lib/mailbox/config", () => ({ connectableProviders: () => w.connectable ?? { google: true, microsoft: true } }));
  vi.doMock("@/lib/lawmatics/connection", () => ({ getLawmaticsConnection: vi.fn(async () => w.lawmatics ?? { ok: true, connection: null }) }));
  vi.doMock("@/lib/payments/lawpay-connection", () => ({ getLawPayConnection: vi.fn(async () => w.lawpay ?? { ok: true, connection: null }) }));
  vi.doMock("@/lib/payments/lawpay-config", () => ({ lawPaySetup: () => ({ ready: w.lawpayReady ?? true }) }));
  vi.doMock("@/lib/meetings/connection", () => ({ listMeetingConnections: vi.fn(async () => w.meetings ?? { ok: true, connections: [] }) }));
  vi.doMock("@/lib/meetings/config", () => ({
    zoomSetup: () => w.zoom ?? { ready: true },
    fathomReady: () => w.fathomReady ?? true,
  }));
  vi.doMock("@/components/mailbox/DisconnectButton", () => ({ DisconnectButton: () => <button type="button">Disconnect</button> }));
  vi.doMock("@/components/meetings/MeetingForms", () => ({
    ConnectFathomForm: () => <form data-stub="connect-fathom" />,
    DisconnectSourceButton: ({ label }: { label: string }) => <button type="button">{`Disconnect ${label}`}</button>,
    ImportNowButton: ({ provider }: { provider: string }) => <button type="button">{`Import now ${provider}`}</button>,
  }));
}

async function index(w: World = {}, search: Record<string, string> = {}) {
  mockWorld(w);
  const { default: Page } = await import("../../src/app/dashboard/settings/integrations/page");
  return text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) })));
}

async function meetings(w: World = {}, search: Record<string, string> = {}) {
  mockWorld(w);
  const { default: Page } = await import("../../src/app/dashboard/settings/integrations/meetings/page");
  return text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) })));
}

/** The pill label inside the card whose heading has this id. */
function pillIn(html: string, headingId: string): string | null {
  const m = new RegExp(`id="${headingId}"[^>]*>[^<]*</h[23]><span class="lx-pill [a-z-]+" data-state="([a-z-]+)">([^<]+)</span>`).exec(html);
  return m ? m[2] : null;
}

/** The pill following a title in a row (details summary or soon row). */
function rowPill(html: string, title: string): string | null {
  const m = new RegExp(`>${title}</h3><span class="lx-pill [a-z-]+" data-state="[a-z-]+">([^<]+)</span>`).exec(html);
  return m ? m[1] : null;
}

const SEEDED: World = {
  lawmatics: { ok: true, connection: { status: "active", last_import_at: null } },
  lawpay: { ok: true, connection: { status: "reauth", mode: "test", display_hint: null } },
  meetings: { ok: true, connections: [] },
  mailboxes: { ok: true, connections: [conn("google", "active")] },
};

describe("Integrations index: a pill on every card", () => {
  it("shows the expected label on each of the seven", async () => {
    const html = await index(SEEDED);
    expect(pillIn(html, "lawmatics-title")).toBe("Connected");
    expect(pillIn(html, "lawpay-title")).toBe("Reconnect");
    expect(pillIn(html, "meetings-title")).toBe("Not connected");
    expect(rowPill(html, "Google Workspace")).toBe("Connected");
    expect(rowPill(html, "Microsoft 365")).toBe("Not connected");
    expect(rowPill(html, "Email \\(IMAP\\)")).toBe("Coming soon");
    expect(rowPill(html, "AI assistants")).toBe("Coming soon");
  });

  it("a failed Lawmatics, LawPay and meetings read shows Couldn't check, never Not connected, on those three", async () => {
    const html = await index({ ...SEEDED, lawmatics: { ok: false }, lawpay: { ok: false }, meetings: { ok: false } });
    for (const id of ["lawmatics-title", "lawpay-title", "meetings-title"]) expect(pillIn(html, id), id).toBe("Couldn't check");
    const cards = html.slice(html.indexOf('id="lawmatics-title"'), html.indexOf('aria-label="Services"'));
    expect(cards).not.toContain("Not connected");
  });

  it("a failed mailbox read shows Couldn't check on both providers and keeps the banner", async () => {
    const html = await index({ ...SEEDED, mailboxes: { ok: false } });
    expect(rowPill(html, "Google Workspace")).toBe("Couldn't check");
    expect(rowPill(html, "Microsoft 365")).toBe("Couldn't check");
    expect(html).toContain("We couldn't load your mailbox connections");
  });

  it("states: reconnect, needs attention, LawPay not available, meetings needing attention, mailbox statuses", async () => {
    const html = await index({
      lawmatics: { ok: true, connection: { status: "invalid" } },
      lawpay: { ok: true, connection: null },
      lawpayReady: false,
      meetings: { ok: true, connections: [conn("fathom", "active"), conn("zoom", "reauth")] },
      mailboxes: { ok: true, connections: [conn("microsoft", "error"), conn("google", "reauth")] },
    });
    expect(pillIn(html, "lawmatics-title")).toBe("Reconnect");
    expect(pillIn(html, "lawpay-title")).toBe("Not available yet");
    expect(pillIn(html, "meetings-title")).toBe("Reconnect");
    expect(rowPill(html, "Microsoft 365")).toBe("Needs attention");
    expect(rowPill(html, "Google Workspace")).toBe("Reconnect");
  });

  it("a live LawPay connection keeps its Live badge beside the Connected pill", async () => {
    const html = await index({ lawpay: { ok: true, connection: { status: "active", mode: "live", display_hint: "Hartwell" } } });
    expect(pillIn(html, "lawpay-title")).toBe("Connected");
    expect(html).toContain(">Live</span>");
  });
});

describe("Integrations index: nothing existing is lost", () => {
  it("keeps the three card links and their button text", async () => {
    const none = await index({});
    expect(none).toMatch(/href="\/dashboard\/settings\/integrations\/lawmatics\/?"[^>]*>Connect Lawmatics</);
    expect(none).toMatch(/href="\/dashboard\/settings\/integrations\/lawpay\/?"[^>]*>Connect LawPay</);
    expect(none).toMatch(/href="\/dashboard\/settings\/integrations\/meetings\/?"[^>]*>Connect Fathom or Zoom</);
    const connected = await index({
      lawmatics: { ok: true, connection: { status: "active" } },
      lawpay: { ok: true, connection: { status: "active", mode: "test" } },
      meetings: { ok: true, connections: [conn("fathom", "active")] },
    });
    expect(connected).toContain(">Open Lawmatics import<");
    expect(connected).toContain(">Manage LawPay<");
    expect(connected).toContain(">Manage meetings<");
    expect(connected).toContain("Connected: Fathom.");
    expect((await index({ lawpayReady: false }))).toContain(">About LawPay<");
  });

  it("shows the hero, provider rows and What we read only with the mailbox module", async () => {
    const withModule = await index({ mailboxModule: true });
    expect(withModule).toContain("Bring your client mail");
    expect(withModule).toContain("Google Workspace");
    expect(withModule).toContain("Microsoft 365");
    expect(withModule).toContain("What we read");
    const without = await index({ mailboxModule: false });
    expect(without).not.toContain("Bring your client mail");
    expect(without).not.toContain("Google Workspace");
    expect(without).not.toContain("Microsoft 365");
    expect(without).not.toContain("What we read");
    // The cards that do not depend on the module are still there.
    expect(pillIn(without, "lawmatics-title")).toBe("Not connected");
    expect(rowPill(without, "AI assistants")).toBe("Coming soon");
  });

  it("keeps the connected and error banners and the mailbox row controls", async () => {
    const html = await index(
      { mailboxes: { ok: true, connections: [conn("microsoft", "reauth", { last_error: "Token expired" })] } },
      { connected: "google", error: "denied" },
    );
    expect(html).toContain("Gmail connected.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Token expired");
    expect(html).toContain("microsoft@firm.test");
    expect(html).toContain("Disconnect");
    expect(html).toMatch(/href="\/api\/mailbox\/connect\/microsoft\/?\?scope=personal"[^>]*>Reconnect</);
  });

  it("a provider that is not set up on the deployment keeps its disabled button and banner", async () => {
    const html = await index({ connectable: { google: false, microsoft: false } });
    expect(html).toContain("Connecting a mailbox isn't switched on yet");
    expect(html).toContain("Gmail · not set up yet");
  });

  it("a signed-out visitor still gets the not-found page", async () => {
    vi.resetModules();
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "signed-out", redirectTo: "/sign-in/" })) }));
    const { default: Page } = await import("../../src/app/dashboard/settings/integrations/page");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});

const ZOOM_COPY = "Zoom isn't switched on for this workspace yet. Lectual turns it on; Fathom works now.";

describe("Meetings page: the Zoom card", () => {
  it.each(["oauth-app", "encryption-key"] as const)("says Zoom isn't switched on when setup is not ready (%s), and the old sentence is gone", async (missing) => {
    const html = await meetings({ zoom: { ready: false, missing } });
    expect(html).toContain(ZOOM_COPY);
    expect(html).not.toContain("Not available yet — Lectual's Zoom sign-in");
    expect(html).not.toContain("Fathom works today");
    expect(pillIn(html, "zoom-title")).toBe("Not available yet");
    expect(html).not.toContain("Connect Zoom");
  });

  it("with Zoom ready, the sentence is absent and Connect Zoom is there for an owner and an admin", async () => {
    for (const role of ["owner", "admin", "senior_admin"]) {
      const html = await meetings({ role, zoom: { ready: true } });
      expect(html).not.toContain(ZOOM_COPY);
      expect(html).toMatch(/href="\/api\/meetings\/zoom\/connect\/?"[^>]*>Connect Zoom</);
      expect(pillIn(html, "zoom-title")).toBe("Not connected");
    }
  });

  it("with Zoom ready, a member below the admin tier is told who connects it", async () => {
    const html = await meetings({ role: "attorney", zoom: { ready: true } });
    expect(html).toContain("Owners and admins connect Zoom and run imports.");
    expect(html).not.toContain("Connect Zoom");
  });

  it("a connected Zoom shows Connected and the import control; a reauth one shows Reconnect", async () => {
    const on = await meetings({ meetings: { ok: true, connections: [conn("zoom", "active")] } });
    expect(pillIn(on, "zoom-title")).toBe("Connected");
    expect(on).toContain("Import now zoom");
    const off = await meetings({ meetings: { ok: true, connections: [conn("zoom", "reauth", { last_error: "Zoom rejected the token" })] } });
    expect(pillIn(off, "zoom-title")).toBe("Reconnect");
    expect(off).toMatch(/href="\/api\/meetings\/zoom\/connect\/?"[^>]*>Reconnect Zoom</);
    expect(off).toContain("Zoom rejected the token");
  });
});

describe("Meetings page: Fathom and failed reads", () => {
  it("Fathom: not connected, connected, reconnect", async () => {
    expect(pillIn(await meetings({}), "fathom-title")).toBe("Not connected");
    expect(pillIn(await meetings({ meetings: { ok: true, connections: [conn("fathom", "active")] } }), "fathom-title")).toBe("Connected");
    const re = await meetings({ meetings: { ok: true, connections: [conn("fathom", "reauth")] } });
    expect(pillIn(re, "fathom-title")).toBe("Reconnect");
    expect(re).toContain("Fathom stopped accepting this key.");
  });

  it("a failed read shows Couldn't check on both cards, never Not connected, plus the banner", async () => {
    const html = await meetings({ meetings: { ok: false } });
    expect(pillIn(html, "fathom-title")).toBe("Couldn't check");
    expect(pillIn(html, "zoom-title")).toBe("Couldn't check");
    expect(html).not.toContain("Not connected");
    expect(html).toContain("We couldn't check your firm's meeting connections.");
  });

  it("keeps the back link, the encryption-key note and the Fathom key form", async () => {
    const html = await meetings({ fathomReady: false });
    expect(html).toMatch(/href="\/dashboard\/settings\/integrations\/?"[^>]*>← Integrations</);
    expect(html).toContain("Not available yet. Lectual will turn it on.");
    expect(await meetings({})).toContain('data-stub="connect-fathom"');
  });
});

describe("the pages draw their integration cards through the shared components", () => {
  const index = fs.readFileSync("src/app/dashboard/settings/integrations/page.tsx", "utf8");
  const meet = fs.readFileSync("src/app/dashboard/settings/integrations/meetings/page.tsx", "utf8");

  it("import the shared header in both, and no hand-written pill or card heading remains", () => {
    for (const src of [index, meet]) {
      expect(src).toContain("@/components/integrations/IntegrationHeader");
      expect(src).not.toMatch(/lx-pill/);
      expect(src).not.toMatch(/<h2[^>]*lx-h2/);
    }
    expect(index).toContain("@/components/integrations/StatusPill");
    expect(meet).toContain("@/components/integrations/HelpText");
  });
});
