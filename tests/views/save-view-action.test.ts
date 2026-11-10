import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const resolveFirmSession = vi.fn();
const getUser = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: (...a: unknown[]) => resolveFirmSession(...a) }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ auth: { getUser, updateUser } }) }));

import { saveViewAction } from "@/lib/account/view-actions";
import { VIEW_NOT_SAVED, VIEW_NOT_SIGNED_IN, VIEW_PREVIEW_NOT_ALLOWED } from "@/lib/ui/words";

const ok = (role: string, actingAsStaff = false) => ({ kind: "ok", role, actingAsStaff, user: { id: "u1" }, org: { id: "o1", modules: ["role-views"] } });

beforeEach(() => {
  resolveFirmSession.mockReset();
  getUser.mockReset();
  updateUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1", user_metadata: { full_name: "Ada L", lectual_tour: { version: 1 } } } }, error: null });
  updateUser.mockResolvedValue({ error: null });
});

describe("saveViewAction", () => {
  it.each(["technician", "auto"])("saves %s for any role, merging every other metadata key", async (value) => {
    resolveFirmSession.mockResolvedValue(ok("paralegal"));
    expect(await saveViewAction(value)).toEqual({ ok: true, pref: value });
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: "Ada L", lectual_tour: { version: 1 }, lectual_view: value } });
  });

  it("saves a preview for an owner, admin and senior admin, never for Lectual staff acting in a firm", async () => {
    for (const [role, staff] of [["owner", false], ["admin", false], ["senior_admin", false]] as const) {
      resolveFirmSession.mockResolvedValue(ok(role, staff));
      expect(await saveViewAction("as:owner")).toEqual({ ok: true, pref: "as:owner" });
    }
  });

  it("refuses a preview for a role that may not preview, and writes nothing", async () => {
    for (const role of ["attorney", "paralegal", "viewer", "intake"]) {
      resolveFirmSession.mockResolvedValue(ok(role));
      expect(await saveViewAction("as:owner")).toEqual({ ok: false, error: VIEW_PREVIEW_NOT_ALLOWED });
    }
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses a view that is not live and anything malformed", async () => {
    resolveFirmSession.mockResolvedValue(ok("owner"));
    expect(await saveViewAction("as:attorney")).toEqual({ ok: false, error: VIEW_PREVIEW_NOT_ALLOWED });
    for (const bad of [undefined, null, "", "owner", 3, { kind: "auto" }]) expect(await saveViewAction(bad)).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("signed out, no firm, a failed read or a failed write are fixed sentences", async () => {
    resolveFirmSession.mockResolvedValue({ kind: "signed-out", redirectTo: "/sign-in" });
    expect(await saveViewAction("auto")).toEqual({ ok: false, error: VIEW_NOT_SIGNED_IN });
    resolveFirmSession.mockResolvedValue({ kind: "no-access", user: {} });
    expect(await saveViewAction("auto")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    resolveFirmSession.mockResolvedValue(ok("owner"));
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await saveViewAction("auto")).toEqual({ ok: false, error: VIEW_NOT_SIGNED_IN });
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "raw provider text" } });
    expect(await saveViewAction("auto")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    updateUser.mockResolvedValueOnce({ error: { message: "raw provider text" } });
    expect(await saveViewAction("auto")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    resolveFirmSession.mockRejectedValueOnce(new Error("boom"));
    expect(await saveViewAction("auto")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
  });

  it("takes no user or org argument and uses only the scoped client", () => {
    const src = readFileSync("src/lib/account/view-actions.ts", "utf8");
    expect(src.startsWith('"use server";')).toBe(true);
    expect(src).toMatch(/export async function saveViewAction\(input: unknown\)/);
    expect(src).not.toMatch(/admin|service/i);
  });
});
