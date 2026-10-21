import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupState } from "@/lib/setup/types";
import { ADMIN_TIER, ALL_DONE, NOTHING_DONE, OTHER_ROLES, bad, ok } from "./helpers";

afterEach(() => vi.resetModules());

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("<!-- -->", "");

type Session = { kind: "ok"; role: string | null } | { kind: "signed-out"; redirectTo: string } | { kind: "no-access" };

async function renderPage(session: Session, state: SetupState = ALL_DONE) {
  vi.resetModules();
  const loadSetupState = vi.fn(async () => state);
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => session) }));
  vi.doMock("@/lib/setup/load", () => ({ loadSetupState }));
  const { default: Page } = await import("../../src/app/dashboard/setup/page");
  const html = renderToStaticMarkup(await Page());
  return { html: text(html), loadSetupState };
}

const MIXED: SetupState = {
  ...NOTHING_DONE,
  profile: ok({ displayName: "Hartwell IP", emailSignature: "Best" }),
  members: ok({ count: 4 }),
  lawmatics: bad,
  lawpay: ok({ status: "reauth" }),
  aiConfigured: true,
};

/** Each <li> as { status, text }, in order. */
function items(html: string) {
  return [...html.matchAll(/<li class="su-item" data-item="([a-z]+)" data-status="([a-z-]+)">(.*?)<\/li>/g)].map((m) => ({ id: m[1], status: m[2], html: m[3] }));
}

describe("the role gate", () => {
  it.each([...ADMIN_TIER])("%s sees the header and the ten items", async (role) => {
    const { html } = await renderPage({ kind: "ok", role });
    expect(html).toContain("Get your firm set up");
    expect(html).toContain(">Setup<");
    expect(items(html)).toHaveLength(10);
  });

  it.each([...OTHER_ROLES, null, "not-a-role", ""])("%j gets the not-found page and none of the wording, without reading anything", async (role) => {
    vi.resetModules();
    const loadSetupState = vi.fn(async () => ALL_DONE);
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role })) }));
    vi.doMock("@/lib/setup/load", () => ({ loadSetupState }));
    const { default: Page } = await import("../../src/app/dashboard/setup/page");
    await expect(Page()).rejects.toThrow(NOT_FOUND);
    expect(loadSetupState).not.toHaveBeenCalled();
  });

  it("signed out and no access get the not-found page", async () => {
    await expect(renderPage({ kind: "signed-out", redirectTo: "/sign-in/" })).rejects.toThrow(NOT_FOUND);
    await expect(renderPage({ kind: "no-access" })).rejects.toThrow(NOT_FOUND);
  });

  it("is dynamic", async () => {
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn() }));
    vi.doMock("@/lib/setup/load", () => ({ loadSetupState: vi.fn() }));
    expect((await import("../../src/app/dashboard/setup/page")).dynamic).toBe("force-dynamic");
  });
});

describe("rendering a mix of states", () => {
  it("shows ten items in order, the right N of 10, a labelled pill and a why-line for each", async () => {
    const { html } = await renderPage({ kind: "ok", role: "owner" }, MIXED);
    const rows = items(html);
    expect(rows.map((r) => r.id)).toEqual(["profile", "team", "outlook", "lawmatics", "meetings", "lawpay", "agents", "intake", "packages", "ai"]);
    expect(html).toContain("3 of 10 done");
    expect(rows.map((r) => r.status)).toEqual(["done", "done", "to-do", "couldnt-check", "to-do", "to-do", "to-do", "to-do", "to-do", "done"]);
    const pillOf = (r: { html: string }) => /<span class="lx-pill [a-z-]+">([^<]+)<\/span>/.exec(r.html)![1];
    expect(rows.map(pillOf)).toEqual(["Done", "Done", "To do", "Couldn't check", "To do", "To do", "To do", "To do", "To do", "Done"]);
    for (const r of rows) expect(r.html).toMatch(/<p class="lx-note su-why">[^<]{10,}<\/p>/);
  });

  it("links each non-done item to its target and gives a done item no Set up link", async () => {
    const { html } = await renderPage({ kind: "ok", role: "admin" }, MIXED);
    const rows = items(html);
    const hrefs = Object.fromEntries(
      rows.filter((r) => r.html.includes(">Set up<")).map((r) => [r.id, /href="([^"]+?)\/?"/.exec(r.html)![1] + "/"]),
    );
    expect(hrefs).toEqual({
      outlook: "/dashboard/settings/integrations/",
      lawmatics: "/dashboard/settings/integrations/lawmatics/",
      meetings: "/dashboard/settings/integrations/meetings/",
      lawpay: "/dashboard/settings/integrations/lawpay/",
      agents: "/dashboard/agents/",
      intake: "/dashboard/forms/",
      packages: "/dashboard/settings/services/",
    });
    for (const done of rows.filter((r) => r.status === "done")) expect(done.html).not.toContain("Set up");
  });

  it("a couldn't-check item never reads as To do or Done, and says the check failed and not to treat it as to do", async () => {
    const { html } = await renderPage({ kind: "ok", role: "owner" }, MIXED);
    const row = items(html).find((r) => r.id === "lawmatics")!;
    expect(row.html).toContain("Couldn't check");
    expect(row.html).not.toContain(">To do<");
    expect(row.html).not.toContain(">Done<");
    expect(text(row.html)).toContain("We couldn't check your Lawmatics connection just now. Try again shortly.");
    expect(text(row.html)).toContain('not the same as "to do"');
  });

  it("a module that is off links to Modules and says it is not switched on", async () => {
    const { html } = await renderPage({ kind: "ok", role: "owner" }, { ...ALL_DONE, modules: ok([]) });
    const outlook = items(html).find((r) => r.id === "outlook")!;
    expect(outlook.html).toMatch(/href="\/dashboard\/settings\/modules\/?"/);
    expect(text(outlook.html)).toContain("aren't switched on for your firm");
    expect(html).toContain("8 of 10 done");
  });
});

describe("the complete and the all-unreadable pages", () => {
  it("complete: 10 of 10, 'Everything is set up', the items stay listed, and no Set up links", async () => {
    const { html } = await renderPage({ kind: "ok", role: "senior_admin" }, ALL_DONE);
    expect(html).toContain("10 of 10 done");
    expect(html).toContain("Everything is set up");
    expect(items(html)).toHaveLength(10);
    expect(html).not.toContain(">Set up<");
    expect(items(html).every((r) => r.status === "done")).toBe(true);
  });

  it("not complete: no 'Everything is set up'", async () => {
    const { html } = await renderPage({ kind: "ok", role: "owner" }, { ...ALL_DONE, aiConfigured: false });
    expect(html).not.toContain("Everything is set up");
    expect(html).toContain("9 of 10 done");
  });

  it("every read failed: still ten items, none done except AI, never 'Everything is set up'", async () => {
    const allBad: SetupState = { profile: bad, members: bad, modules: bad, mailboxes: bad, lawmatics: bad, meetings: bad, lawpay: bad, agents: bad, intakeForms: bad, services: bad, aiConfigured: true };
    const { html } = await renderPage({ kind: "ok", role: "owner" }, allBad);
    const rows = items(html);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.status === "done").map((r) => r.id)).toEqual(["ai"]);
    expect(rows.filter((r) => r.status === "couldnt-check")).toHaveLength(9);
    expect(html).toContain("1 of 10 done");
    expect(html).not.toContain("Everything is set up");
    expect(html).not.toContain(">To do<");
  });

  it("with the AI key unset and everything unreadable, nothing is done", async () => {
    const allBad: SetupState = { profile: bad, members: bad, modules: bad, mailboxes: bad, lawmatics: bad, meetings: bad, lawpay: bad, agents: bad, intakeForms: bad, services: bad, aiConfigured: false };
    const { html } = await renderPage({ kind: "ok", role: "owner" }, allBad);
    expect(html).toContain("0 of 10 done");
  });
});

describe("the way out and the wording", () => {
  it("always has a Go to Integrations link to the Integrations page", async () => {
    for (const state of [ALL_DONE, NOTHING_DONE]) {
      const { html } = await renderPage({ kind: "ok", role: "owner" }, state);
      expect(html).toMatch(/href="\/dashboard\/settings\/integrations\/?"[^>]*>Go to Integrations</);
    }
  });

  it("has no placeholder wording and implies no legal advice and no client send", async () => {
    for (const state of [ALL_DONE, NOTHING_DONE, MIXED]) {
      const { html } = await renderPage({ kind: "ok", role: "owner" }, state);
      expect(html).not.toMatch(/TODO|coming soon|lorem|legal advice|\bsent to\b/i);
    }
  });

  it("uses tokens, not inline colour values", async () => {
    const { html } = await renderPage({ kind: "ok", role: "owner" }, MIXED);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|rgba\(/i);
  });
});
