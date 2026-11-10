import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const resolveFirmSession = vi.fn();
const getUser = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: (...a: unknown[]) => resolveFirmSession(...a) }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ auth: { getUser, updateUser } }) }));

import { saveViewAction } from "@/lib/account/view-actions";
import { VIEW_NOT_SAVED, VIEW_NOT_SIGNED_IN, VIEW_PREVIEW_NOT_ALLOWED } from "@/lib/ui/words";

const FIRM_A = "11111111-1111-4111-8111-111111111111";
const FIRM_B = "22222222-2222-4222-8222-222222222222";
const ok = (role: string, actingAsStaff = false, orgId = FIRM_A, modules = ["role-views"]) => ({ kind: "ok", role, actingAsStaff, user: { id: "u1" }, org: { id: orgId, modules } });

beforeEach(() => {
  resolveFirmSession.mockReset();
  getUser.mockReset();
  updateUser.mockReset();
  getUser.mockResolvedValue({
    data: { user: { id: "u1", user_metadata: { full_name: "Ada L", lectual_tour: { version: 1 }, lectual_view_preview: { [FIRM_B]: "as:owner" } } } },
    error: null,
  });
  updateUser.mockResolvedValue({ error: null });
});

describe("saveViewAction", () => {
  it("staff acting in a firm save a preview keyed by THAT firm (from the session), merging every other key and firm", async () => {
    resolveFirmSession.mockResolvedValue(ok("owner", true));
    expect(await saveViewAction("as:owner")).toEqual({ ok: true, pref: "as:owner" });
    expect(updateUser).toHaveBeenCalledWith({
      data: { full_name: "Ada L", lectual_tour: { version: 1 }, lectual_view_preview: { [FIRM_B]: "as:owner", [FIRM_A]: "as:owner" } },
    });
  });

  it("technician removes only this firm's preview", async () => {
    resolveFirmSession.mockResolvedValue(ok("owner", true, FIRM_B));
    expect(await saveViewAction("technician")).toEqual({ ok: true, pref: "technician" });
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: "Ada L", lectual_tour: { version: 1 }, lectual_view_preview: {} } });
  });

  it("refuses every firm member, owner, admin and senior admin included, and writes nothing", async () => {
    for (const role of ["owner", "admin", "senior_admin", "attorney", "paralegal", "viewer", "intake"]) {
      for (const value of ["as:owner", "technician", "auto"]) {
        resolveFirmSession.mockResolvedValue(ok(role, false));
        expect(await saveViewAction(value)).toEqual({ ok: false, error: VIEW_PREVIEW_NOT_ALLOWED });
      }
    }
    expect(getUser).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses staff in a firm without role views", async () => {
    resolveFirmSession.mockResolvedValue(ok("owner", true, FIRM_A, []));
    expect(await saveViewAction("as:owner")).toEqual({ ok: false, error: VIEW_PREVIEW_NOT_ALLOWED });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("the firm is the session's: a save made in firm B never writes firm A's entry", async () => {
    resolveFirmSession.mockResolvedValue(ok("owner", true, FIRM_B));
    await saveViewAction("as:owner");
    const written = updateUser.mock.calls[0][0].data.lectual_view_preview;
    expect(Object.keys(written)).toEqual([FIRM_B]);
  });

  it("refuses a view that is not live and anything malformed", async () => {
    resolveFirmSession.mockResolvedValue(ok("owner", true));
    for (const bad of ["as:attorney", undefined, null, "", "auto", "owner", 3, { kind: "auto" }]) expect(await saveViewAction(bad)).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("a getUser for a different person than the session writes nothing", async () => {
    resolveFirmSession.mockResolvedValue(ok("owner", true));
    getUser.mockResolvedValueOnce({ data: { user: { id: "someone-else", user_metadata: {} } }, error: null });
    expect(await saveViewAction("as:owner")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("signed out, no firm, a failed read or a failed write are fixed sentences", async () => {
    resolveFirmSession.mockResolvedValue({ kind: "signed-out", redirectTo: "/sign-in" });
    expect(await saveViewAction("auto")).toEqual({ ok: false, error: VIEW_NOT_SIGNED_IN });
    resolveFirmSession.mockResolvedValue({ kind: "no-access", user: {} });
    expect(await saveViewAction("auto")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    resolveFirmSession.mockResolvedValue(ok("owner", true));
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await saveViewAction("technician")).toEqual({ ok: false, error: VIEW_NOT_SIGNED_IN });
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "raw provider text" } });
    expect(await saveViewAction("technician")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    updateUser.mockResolvedValueOnce({ error: { message: "raw provider text" } });
    expect(await saveViewAction("technician")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
    resolveFirmSession.mockRejectedValueOnce(new Error("boom"));
    expect(await saveViewAction("technician")).toEqual({ ok: false, error: VIEW_NOT_SAVED });
  });

  it("takes no user or org argument and uses only the scoped client", () => {
    const src = readFileSync("src/lib/account/view-actions.ts", "utf8");
    expect(src.startsWith('"use server";')).toBe(true);
    expect(src).toMatch(/export async function saveViewAction\(input: unknown\)/);
    expect(src).not.toMatch(/admin|service/i);
  });
});
