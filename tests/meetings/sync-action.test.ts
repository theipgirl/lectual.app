import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  session: { kind: "ok", role: "owner", user: { id: "u1" }, org: { id: "o1" } } as Record<string, unknown>,
  conns: { ok: true, connections: [{ provider: "zoom", status: "active" }] } as { ok: boolean; connections?: unknown[] },
  secrets: { status: "active" } as Record<string, unknown> | null,
  importOut: { ok: true, counts: { inserted: 2, updated: 0, linked: 0, suggested: 0 }, truncated: false } as Record<string, unknown>,
  ownSecrets: vi.fn(),
  importConnection: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => h.session }));
vi.mock("@/lib/mailbox/config", () => ({ rootKeyOrNull: () => "root" }));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/meetings/config", () => ({ zoomClientCredentials: () => null }));
vi.mock("@/lib/meetings/fathom", () => ({ checkFathomKeyShape: vi.fn(), verifyFathomKey: vi.fn() }));
vi.mock("@/lib/meetings/connection", () => ({
  listMeetingConnections: async () => h.conns,
  ownConnectionSecrets: (...a: unknown[]) => h.ownSecrets(...a),
  disconnectMeetingSource: vi.fn(),
  saveFathomKey: vi.fn(),
}));
vi.mock("@/lib/meetings/import", () => ({ importConnection: (...a: unknown[]) => h.importConnection(...a) }));

import { importNowAction } from "@/app/dashboard/settings/integrations/meetings/actions";
import { syncNewMeetingsAction } from "@/app/dashboard/meetings/sync-action";
import { SyncMeetingsControl, SyncResult } from "@/components/meetings/SyncMeetingsButton";
import { syncControl } from "@/lib/meetings/sync-access";

beforeEach(() => {
  h.session = { kind: "ok", role: "owner", user: { id: "u1" }, org: { id: "o1" } };
  h.conns = { ok: true, connections: [{ provider: "zoom", status: "active" }] };
  h.secrets = { status: "active" };
  h.importOut = { ok: true, counts: { inserted: 2, updated: 0, linked: 0, suggested: 0 }, truncated: false };
  h.ownSecrets.mockReset().mockImplementation(async () => h.secrets);
  h.importConnection.mockReset().mockImplementation(async () => h.importOut);
});

const run = () => syncNewMeetingsAction();

describe("syncNewMeetingsAction", () => {
  it("imports once per connected source through importNowAction and reports the count", async () => {
    const out = await run();
    expect(h.importConnection).toHaveBeenCalledTimes(1);
    expect(out.summary).toMatchObject({ tone: "ok", inserted: 2, text: "2 new meetings imported. Fathom isn't connected." });
  });

  it("calls both sources when both are connected and adds the counts", async () => {
    h.conns = { ok: true, connections: [{ provider: "fathom", status: "active" }, { provider: "zoom", status: "active" }] };
    const out = await run();
    expect(h.importConnection).toHaveBeenCalledTimes(2);
    expect(out.summary?.text).toBe("4 new meetings imported.");
  });

  it("a viewer or clerk gets the refusal sentence and nothing is imported", async () => {
    for (const role of ["viewer", "clerk", "attorney"]) {
      h.session = { kind: "ok", role };
      const out = await run();
      expect(out.summary).toMatchObject({ tone: "error", text: "Senior admin or above can sync meetings." });
    }
    expect(h.ownSecrets).not.toHaveBeenCalled();
    expect(h.importConnection).not.toHaveBeenCalled();
  });

  it("importNowAction itself refuses a non-admin session (the wrapper is not the only gate)", async () => {
    h.session = { kind: "ok", role: "viewer" };
    const fd = new FormData();
    fd.set("provider", "zoom");
    expect(await importNowAction({}, fd)).toMatchObject({ error: "Senior admin or above can run an import.", sync: { kind: "refused" } });
    expect(h.importConnection).not.toHaveBeenCalled();
  });

  it("a signed-out session is refused", async () => {
    h.session = { kind: "signed-out" };
    expect((await run()).summary?.tone).toBe("error");
    expect(h.importConnection).not.toHaveBeenCalled();
  });

  it("a source needing reconnect is reported, not imported", async () => {
    h.secrets = { status: "reauth" };
    const out = await run();
    expect(h.importConnection).not.toHaveBeenCalled();
    expect(out.summary).toMatchObject({ tone: "error", reconnect: true });
    expect(out.summary?.text).toContain("Couldn't reach Zoom.");
  });

  it("a provider that rejects the credential is reauth; any other failure is a named failure", async () => {
    h.importOut = { ok: false, status: "reauth", error: "x" };
    expect((await run()).summary).toMatchObject({ reconnect: true });
    h.importOut = { ok: false, status: "error", error: "boom" };
    const out = await run();
    expect(out.summary?.text).toContain("Couldn't import from Zoom.");
    expect(out.summary?.text).not.toContain("No new meetings");
  });

  it("an unreadable connection list fails every source", async () => {
    h.conns = { ok: false };
    const out = await run();
    expect(out.summary?.tone).toBe("error");
    expect(h.importConnection).not.toHaveBeenCalled();
  });

  it("is a thin wrapper: no import logic of its own", () => {
    const src = readFileSync("src/app/dashboard/meetings/sync-action.ts", "utf8");
    expect(src).toContain("importNowAction");
    expect(src).not.toContain("importConnection");
    expect(src).not.toContain("getAdminClient");
  });
});

describe("rendering", () => {
  it("draws the button, the connect link, or nothing", () => {
    expect(renderToStaticMarkup(createElement(SyncMeetingsControl, { control: "sync" }))).toContain("Sync new meetings");
    const connect = renderToStaticMarkup(createElement(SyncMeetingsControl, { control: "connect" }));
    expect(connect).toContain("Connect a meeting source");
    expect(connect).toContain("/dashboard/settings/integrations/meetings");
    expect(renderToStaticMarkup(createElement(SyncMeetingsControl, { control: "none" }))).toBe("");
    // an unreadable connections list is not "none connected"
    const unreadable = renderToStaticMarkup(createElement(SyncMeetingsControl, { control: syncControl("owner", null) }));
    expect(unreadable).not.toContain("Connect a meeting source");
    expect(unreadable).toContain("Sync new meetings");
  });

  it("an error is an alert with a Reconnect link; a clean run is a status", () => {
    const err = renderToStaticMarkup(createElement(SyncResult, { summary: { tone: "error", text: "Couldn't reach Zoom.", reconnect: true, inserted: 0 } }));
    expect(err).toContain('role="alert"');
    expect(err).toContain("Reconnect");
    const ok = renderToStaticMarkup(createElement(SyncResult, { summary: { tone: "ok", text: "No new meetings.", reconnect: false, inserted: 0 } }));
    expect(ok).toContain('role="status"');
    expect(ok).not.toContain("Reconnect");
  });

  it("is drawn on the Meetings page and in the Proposals consults strip, using the shared control decision", () => {
    expect(readFileSync("src/app/dashboard/meetings/page.tsx", "utf8")).toContain("<SyncMeetingsControl");
    expect(readFileSync("src/app/dashboard/proposals/page.tsx", "utf8")).toContain("<SyncMeetingsControl");
    expect(readFileSync("src/components/proposal-list/ConsultsStrip.tsx", "utf8")).toContain("pq-sync");
  });
});
