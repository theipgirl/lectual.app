import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SetupState } from "@/lib/setup/types";
import { ADMIN_TIER, ALL_DONE, NOTHING_DONE, OTHER_ROLES, bad } from "./helpers";

afterEach(() => vi.resetModules());

type Session = { kind: "ok"; role: string | null } | { kind: "signed-out"; redirectTo: string } | { kind: "no-access" };

/** Runs the real Settings index page and returns where it redirected, with the loader's call count. */
async function run(session: Session, state: SetupState = ALL_DONE) {
  vi.resetModules();
  const loadSetupState = vi.fn(async () => state);
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => session) }));
  vi.doMock("@/lib/setup/load", () => ({ loadSetupState }));
  const { default: SettingsIndex } = await import("../../src/app/dashboard/settings/page");
  let target: string | null = null;
  try {
    await SettingsIndex();
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    // NEXT_REDIRECT;<type>;<url>;<status>;
    const m = /^NEXT_REDIRECT;[^;]+;([^;]+);/.exec(digest);
    if (!m) throw e;
    target = m[1];
  }
  return { target, loadSetupState };
}

const INTEGRATIONS = "/dashboard/settings/integrations/";

// Sprint 32: Settings always opens Settings. Setup is a tab inside it, never a takeover.
describe("Settings index", () => {
  it.each([...ADMIN_TIER])("%s goes to Integrations with an incomplete checklist, and reads nothing", async (role) => {
    for (const state of [NOTHING_DONE, { ...ALL_DONE, aiConfigured: false }, { ...ALL_DONE, lawpay: bad }]) {
      const { target, loadSetupState } = await run({ kind: "ok", role }, state);
      expect(target).toBe(INTEGRATIONS);
      expect(loadSetupState).toHaveBeenCalledTimes(0);
    }
  });

  it.each([...ADMIN_TIER])("%s goes to Integrations with a complete checklist too", async (role) => {
    expect((await run({ kind: "ok", role }, ALL_DONE)).target).toBe(INTEGRATIONS);
  });

  it("every read failing makes no difference", async () => {
    const allBad: SetupState = { profile: bad, members: bad, modules: bad, mailboxes: bad, lawmatics: bad, meetings: bad, lawpay: bad, agents: bad, intakeForms: bad, services: bad, aiConfigured: true };
    expect((await run({ kind: "ok", role: "owner" }, allBad)).target).toBe(INTEGRATIONS);
  });

  it.each([...OTHER_ROLES, null, "not-a-role", ""])("%j goes to Integrations and the setup loader is never called", async (role) => {
    const { target, loadSetupState } = await run({ kind: "ok", role }, NOTHING_DONE);
    expect(target).toBe(INTEGRATIONS);
    expect(loadSetupState).toHaveBeenCalledTimes(0);
  });

  it("signed out and no access go to Integrations without reading setup", async () => {
    for (const session of [{ kind: "signed-out", redirectTo: "/sign-in/" }, { kind: "no-access" }] as Session[]) {
      const { target, loadSetupState } = await run(session, NOTHING_DONE);
      expect(target).toBe(INTEGRATIONS);
      expect(loadSetupState).toHaveBeenCalledTimes(0);
    }
  });

  it("does not even resolve the session", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/app/dashboard/settings/page.tsx"), "utf8");
    expect(src).not.toMatch(/resolveFirmSession|loadSetupState/);
  });
});
