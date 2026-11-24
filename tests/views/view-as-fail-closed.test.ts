import { beforeEach, describe, expect, it, vi } from "vitest";
vi.unmock("@/lib/views/view-as-flag");

/**
 * View as must fail CLOSED during an open preview: every errored read behind the session reads as "unknown" (writes
 * refused), through the REAL session core (src/lib/firm/session.ts) and the real flag. The one exception: an auth-server
 * failure with NO hint cookie reads as "off", so an auth outage doesn't lock every person out of every write.
 */
let hint: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("outside a request");
  },
  cookies: async () => ({ get: (n: string) => (n === "lx_view_as" && hint ? { value: hint } : undefined), getAll: () => [] }),
}));

type Res = { data: unknown; error: unknown };
const ORG = "00000000-0000-4000-8000-0000000000a1";
const ME = "11111111-1111-4111-8111-111111111111";
let user: Res;
let member: Res;
let org: Res;
let isAdmin: Res;
const stateRpc = vi.fn(async () => ({ data: [], error: null }) as Res);

function fakeClient() {
  const table = (r: () => Res) => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq"]) chain[k] = () => chain;
    chain.maybeSingle = async () => r();
    return chain;
  };
  return {
    auth: { getUser: async () => user },
    from: (t: string) => (t === "crm_org_member" ? table(() => member) : table(() => org)),
    rpc: async (fn: string) => {
      if (fn === "is_platform_admin") return isAdmin;
      if (fn === "owner_view_as_state") return stateRpc();
      return { data: null, error: null };
    },
  };
}
let throwOnClient = false;
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => {
    if (throwOnClient) throw new Error("no client");
    return fakeClient();
  },
}));

import { AuthSessionMissingError } from "@supabase/supabase-js";
import { previewFlag, readPreviewState } from "@/lib/views/view-as-flag";

const ownerRow = { data: { role: "owner", org_id: ORG }, error: null };
const orgRow = { data: { id: ORG, name: "Example Firm", slug: "ex", modules: [] }, error: null };
const authError = (status: number | undefined, name = "AuthRetryableFetchError") => ({ data: { user: null }, error: Object.assign(new Error("x"), { name, status }) });

beforeEach(() => {
  hint = undefined;
  throwOnClient = false;
  user = { data: { user: { id: ME, user_metadata: {} } }, error: null };
  member = ownerRow;
  org = orgRow;
  isAdmin = { data: false, error: null };
  stateRpc.mockReset();
  stateRpc.mockResolvedValue({ data: [], error: null });
});

describe("(a) the auth server fails (a 5xx or a timeout), not a signed-out person", () => {
  it("with the hint cookie: unknown, writes refused", async () => {
    hint = "1";
    for (const e of [authError(503), authError(undefined)]) {
      user = e;
      expect(await readPreviewState()).toEqual({ kind: "unknown" });
    }
  });
  it("without the cookie: off (an auth outage doesn't lock everyone out)", async () => {
    user = authError(503);
    expect(await previewFlag()).toBe("off");
  });
  it("no session at all: off, cookie or not", async () => {
    hint = "1";
    user = { data: { user: null }, error: new AuthSessionMissingError() };
    expect(await previewFlag()).toBe("off");
  });
  it("any other auth error (a 4xx included) with the cookie: unknown; signing out still works (a fixed path)", async () => {
    hint = "1";
    user = authError(401, "AuthApiError");
    expect(await previewFlag()).toBe("unknown");
  });
});

describe("(b) a firm or platform-admin read that errored", () => {
  it("an owner with a failed org read: unknown", async () => {
    org = { data: orgRow.data, error: { code: "08006", message: "" } };
    expect(await readPreviewState()).toEqual({ kind: "unknown" });
    expect(stateRpc).not.toHaveBeenCalled();
  });
  it("an owner with an is_platform_admin error: unknown", async () => {
    isAdmin = { data: null, error: { code: "08006", message: "" } };
    expect(await readPreviewState()).toEqual({ kind: "unknown" });
  });
  it("a non-owner row read fine is never locked out by another read's hiccup", async () => {
    member = { data: { role: "paralegal", org_id: ORG }, error: null };
    isAdmin = { data: null, error: { code: "08006", message: "" } };
    expect(await previewFlag()).toBe("off");
    isAdmin = { data: false, error: null };
    org = { data: null, error: { code: "08006", message: "" } };
    expect(await previewFlag()).toBe("off");
    expect(stateRpc).not.toHaveBeenCalled();
  });
  it("a failed membership read (the row is unknown, so it could be an owner's): unknown", async () => {
    member = { data: null, error: { code: "08006", message: "" } };
    expect(await readPreviewState()).toEqual({ kind: "unknown" });
  });
});

describe("(c) a platform admin who is a real owner, whose membership read fails", () => {
  it("reads as staff with no row in the session, but the flag is unknown, never off", async () => {
    isAdmin = { data: true, error: null };
    member = { data: null, error: { code: "08006", message: "" } };
    expect(await previewFlag()).toBe("unknown");
  });
});

describe("the session can't be resolved at all", () => {
  it("with the hint cookie: unknown; without: off", async () => {
    throwOnClient = true;
    hint = "1";
    expect(await previewFlag()).toBe("unknown");
    hint = undefined;
    expect(await previewFlag()).toBe("off");
  });
});

describe("the happy paths are unchanged", () => {
  it("a real owner with an open row is on; no row is off", async () => {
    stateRpc.mockResolvedValue({ data: [{ target_user_id: "22222222-2222-4222-8222-222222222222", started_at: "2026-11-23T10:00:00Z" }], error: null });
    expect(await previewFlag()).toBe("on");
    stateRpc.mockResolvedValue({ data: [], error: null });
    expect(await previewFlag()).toBe("off");
  });
});
