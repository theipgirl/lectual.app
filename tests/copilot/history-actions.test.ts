import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fakeScoped, healthyDb, type StmtHandler } from "./fake-scoped";

/** C7: the delete action refuses signed-out and a bad id with fixed sentences, uses the scoped client, never throws. */

const ID = "33333333-3333-4333-8333-333333333333";
const refresh = vi.fn();

async function load(opts: { session?: unknown; handler?: StmtHandler; scopedThrows?: boolean } = {}) {
  vi.resetModules();
  vi.doMock("next/cache", () => ({ refresh }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => opts.session ?? { kind: "ok", user: { id: "u" }, org: { id: "o" } }) }));
  const db = fakeScoped(opts.handler ?? healthyDb());
  const getScopedClient = vi.fn(async () => {
    if (opts.scopedThrows) throw new Error("secret detail");
    return db.client;
  });
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient }));
  const mod = await import("@/app/dashboard/copilot/actions");
  return { ...mod, db, getScopedClient };
}

beforeEach(() => refresh.mockReset());

describe("deleteChatAction", () => {
  it("deletes by id through the scoped client and refreshes the page", async () => {
    const { deleteChatAction, db, getScopedClient } = await load();
    expect(await deleteChatAction(ID)).toEqual({ ok: true });
    expect(getScopedClient).toHaveBeenCalledTimes(1);
    expect(db.log).toHaveLength(1);
    expect(db.log[0]).toMatchObject({ table: "copilot_conversation", action: "delete", filters: [{ column: "id", value: ID }] });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses signed-out and a non-uuid id with fixed sentences and touches nothing", async () => {
    const out = await load({ session: { kind: "signed-out", redirectTo: "/sign-in/" } });
    expect(await out.deleteChatAction(ID)).toEqual({ ok: false, error: "Sign in to delete a saved chat." });
    expect(out.getScopedClient).not.toHaveBeenCalled();
    const bad = await load();
    for (const id of ["", "abc", "1; drop table", ID + "x"]) {
      expect(await bad.deleteChatAction(id)).toEqual({ ok: false, error: "That chat couldn't be found." });
    }
    expect(bad.db.log).toHaveLength(0);
  });

  it("a chat that is not the caller's (no row deleted) is 'couldn't be found'", async () => {
    const { deleteChatAction } = await load({ handler: () => ({ data: [], error: null }) });
    expect(await deleteChatAction(ID)).toEqual({ ok: false, error: "That chat couldn't be found." });
  });

  it("never throws and never returns raw error text", async () => {
    const thrown = await load({ scopedThrows: true });
    expect(await thrown.deleteChatAction(ID)).toEqual({ ok: false, error: "The chat couldn't be deleted. Try again." });
    const failed = await load({ handler: () => ({ data: null, error: { code: "XX000", message: "secret db text" } }) });
    expect(JSON.stringify(await failed.deleteChatAction(ID))).not.toMatch(/secret/);
    const missing = await load({ handler: () => ({ data: null, error: { code: "42P01" } }) });
    expect(await missing.deleteChatAction(ID)).toEqual({ ok: false, error: "Saved chats aren't switched on for your firm yet. Lectual will turn them on." });
  });

  it("uses the scoped client only", () => {
    expect(readFileSync("src/app/dashboard/copilot/actions.ts", "utf8")).not.toMatch(/db\/admin|getAdminClient/);
  });
});
