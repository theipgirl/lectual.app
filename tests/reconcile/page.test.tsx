import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import IntakeWorkspace from "@/app/dashboard/intake/_components/IntakeWorkspace";
import { DEFAULT_VIEW_STATE, EMPTY_INTAKE_FILTERS } from "@/lib/intake/rows";

vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/intake/actions", () => ({ assignLeadAction: vi.fn(), moveStageAction: vi.fn(), setLaneAction: vi.fn(), setSourceAction: vi.fn() }));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({ startTimerAction: vi.fn(), stopTimerAction: vi.fn(), logTimeAction: vi.fn() }));

afterEach(() => vi.resetModules());

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

type Session = { kind: "ok"; role: string } | { kind: "signed-out"; redirectTo: string } | { kind: "no-access" };

async function renderPage(session: Session, opts: { lawmatics?: unknown; mailboxes?: unknown } = {}) {
  vi.resetModules();
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => session) }));
  vi.doMock("@/lib/lawmatics/connection", () => ({
    getLawmaticsConnection: vi.fn(async () => opts.lawmatics ?? { ok: true, connection: { status: "active" } }),
  }));
  vi.doMock("@/lib/mailbox/connections", () => ({
    listConnections: vi.fn(async () => opts.mailboxes ?? { ok: true, connections: [{ status: "active" }] }),
  }));
  vi.doMock("@/app/dashboard/intake/reconcile/actions", () => ({ previewReconcileAction: vi.fn(), applyReconcileAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/intake/reconcile/page");
  return renderToStaticMarkup(await Page());
}

describe("the page's gate", () => {
  it.each(["owner", "admin", "senior_admin"])("%s sees the explanation and the upload control", async (role) => {
    const html = text(await renderPage({ kind: "ok", role }));
    expect(html).toContain("Reconcile stages");
    expect(html).toContain("Compare the sheet with the app");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,text/csv"');
    expect(html).toContain('name="sheet"');
    expect(html).toContain("CSV, up to 5 MB");
  });

  it.each(["intake", "paralegal", "law_clerk", "attorney", "clerk", "viewer", "social_media"])("%s gets the not-found page and none of the wording", async (role) => {
    await expect(renderPage({ kind: "ok", role })).rejects.toThrow(NOT_FOUND);
  });

  it("signed out, no access, and an unresolvable session also get the not-found page", async () => {
    await expect(renderPage({ kind: "signed-out", redirectTo: "/sign-in/" })).rejects.toThrow(NOT_FOUND);
    await expect(renderPage({ kind: "no-access" })).rejects.toThrow(NOT_FOUND);
  });

  it("is dynamic", async () => {
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn() }));
    vi.doMock("@/lib/lawmatics/connection", () => ({ getLawmaticsConnection: vi.fn() }));
    vi.doMock("@/lib/mailbox/connections", () => ({ listConnections: vi.fn() }));
    vi.doMock("@/app/dashboard/intake/reconcile/actions", () => ({ previewReconcileAction: vi.fn(), applyReconcileAction: vi.fn() }));
    const page = await import("../../src/app/dashboard/intake/reconcile/page");
    expect(page.dynamic).toBe("force-dynamic");
  });
});

describe("the explanation", () => {
  it("says the sheet wins, Lawmatics is only read, and moves are logged, in plain words", async () => {
    const html = text(await renderPage({ kind: "ok", role: "admin" }));
    expect(html).toContain("the sheet wins");
    expect(html).toContain("Lawmatics is only read");
    expect(html).toContain("Nothing on this page writes to it");
    expect(html).toContain("Every move is logged on the lead's timeline");
    expect(html).toMatch(/Open a matter for them instead/);
    expect(html).not.toMatch(/legal advice|TODO|coming soon|lorem/i);
  });

  it("shows each source's availability before an upload", async () => {
    const html = text(await renderPage({ kind: "ok", role: "owner" }));
    expect(html).toContain("Waiting for your CSV file.");
    expect(html).toContain("Connected. Its stages will be read, not changed.");
    expect(html).toContain("Mailbox sync is connected.");
  });

  it("says plainly when Lawmatics or mail is not connected, and when it could not check", async () => {
    const none = text(await renderPage({ kind: "ok", role: "owner" }, { lawmatics: { ok: true, connection: null }, mailboxes: { ok: true, connections: [{ status: "reauth" }] } }));
    expect(none).toContain("Not connected. The Lawmatics column will show as unavailable.");
    expect(none).toContain("No mailbox is connected");
    const unknown = text(await renderPage({ kind: "ok", role: "owner" }, { lawmatics: { ok: false }, mailboxes: { ok: false } }));
    expect(unknown).toContain("We couldn't check the connection.");
    expect(unknown).toContain("We couldn't check the mailbox connections.");
    expect(unknown).not.toContain("Not connected.");
  });
});

describe("the link on the Intake page", () => {
  const render = (showReconcile?: boolean) =>
    renderToStaticMarkup(
      <IntakeWorkspace
        rows={[]}
        stages={[]}
        intakeStages={[]}
        members={[]}
        initialFilters={EMPTY_INTAKE_FILTERS}
        initialViewState={DEFAULT_VIEW_STATE}
        time={null}
        now="2026-10-21T12:00:00.000Z"
        {...(showReconcile === undefined ? {} : { showReconcile })}
      />,
    );

  it("is there for the admin tier, pointing at the screen", () => {
    expect(render(true)).toMatch(/href="\/dashboard\/intake\/reconcile\/?"[^>]*>Reconcile stages</);
  });

  it("is absent otherwise, and by default", () => {
    expect(render(false)).not.toContain("/dashboard/intake/reconcile");
    expect(render()).not.toContain("Reconcile stages");
  });
});

describe("the Email / calendar source label (Sprint 16, F19)", () => {
  it("the availability line before an upload is named Email / calendar and says the Stage Keeper's moves are used", async () => {
    const html = text(await renderPage({ kind: "ok", role: "owner" }));
    expect(html).toContain("Email / calendar");
    expect(html).toContain("what the Stage Keeper did from mail and calendar consults, will be used");
  });

  it("with no mailbox it says there may be no mail or calendar consults, and that is not an error", async () => {
    const none = text(await renderPage({ kind: "ok", role: "owner" }, { lawmatics: { ok: true, connection: null }, mailboxes: { ok: true, connections: [{ status: "reauth" }] } }));
    expect(none).toContain("no synced mail or calendar consults to use. That is not an error.");
  });
});
