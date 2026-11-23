import { beforeEach, describe, expect, it, vi } from "vitest";
vi.unmock("@/lib/views/view-as-flag");

let requestHeaders: object | null = new Headers();
const cookieGet = vi.fn(() => undefined);
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!requestHeaders) throw new Error("outside a request");
    return requestHeaders;
  },
  cookies: async () => ({ get: cookieGet, getAll: () => [] }),
}));
const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const core = vi.fn();
vi.mock("@/lib/firm/session", () => ({ loadFirmSessionCore: () => core() }));
const rpc = vi.fn();
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { previewFlag, readPreviewState } from "@/lib/views/view-as-flag";
import { previewSafe, previewSafeRoute } from "@/lib/views/preview-safe";
import { VIEW_AS_READ_ONLY } from "@/lib/ui/words";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const TEAMMATE = "22222222-2222-4222-8222-222222222222";
const session = (memberRole: string | null) => ({
  kind: "ok",
  user: { id: "11111111-1111-4111-8111-111111111111" },
  member: memberRole ? { role: memberRole, org_id: ORG } : null,
  org: { id: ORG },
  role: memberRole ?? "owner",
});

beforeEach(() => {
  requestHeaders = new Headers();
  core.mockReset();
  rpc.mockReset();
  redirect.mockClear();
});

describe("the preview state read", () => {
  it("a real owner: exactly one owner_view_as_state call per request, however many ask", async () => {
    core.mockResolvedValue(session("owner"));
    rpc.mockResolvedValue({ data: [{ target_user_id: TEAMMATE, started_at: "2026-11-23T10:00:00Z" }], error: null });
    await Promise.all([readPreviewState(), previewFlag(), previewFlag()]);
    await previewFlag();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("owner_view_as_state");
    // A new request reads again.
    requestHeaders = new Headers();
    await previewFlag();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("a non-owner makes no read at all; nor does a platform admin with no row", async () => {
    for (const role of ["admin", "senior_admin", "attorney", "paralegal", "viewer", null]) {
      requestHeaders = new Headers();
      core.mockResolvedValue(session(role));
      expect(await previewFlag()).toBe("off");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the cookie never decides: with no cookie and an open row the preview is on and writes are refused", async () => {
    core.mockResolvedValue(session("owner"));
    rpc.mockResolvedValue({ data: [{ target_user_id: TEAMMATE, started_at: "2026-11-23T10:00:00Z" }], error: null });
    const body = vi.fn(async () => ({ ok: true as const }));
    const action = previewSafe(body as () => Promise<{ ok: true } | { ok: false; error: string }>, "state");
    expect(await action()).toEqual({ ok: false, error: VIEW_AS_READ_ONLY });
    expect(body).not.toHaveBeenCalled();
    expect(cookieGet).not.toHaveBeenCalled();
  });

  it("a failed read for an owner is 'unknown' and refuses writes", async () => {
    core.mockResolvedValue(session("owner"));
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "" } });
    expect(await readPreviewState()).toEqual({ kind: "unknown" });
    requestHeaders = new Headers();
    rpc.mockRejectedValue(new Error("network"));
    expect(await previewFlag()).toBe("unknown");
  });

  it("0117 missing: not set up, nothing refused", async () => {
    core.mockResolvedValue(session("owner"));
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "" } });
    expect(await readPreviewState()).toEqual({ kind: "not-set-up" });
    const body = vi.fn(async () => ({ ok: true as const }));
    expect(await previewSafe(body as () => Promise<{ ok: true } | { ok: false; error: string }>, "state")()).toEqual({ ok: true });
  });

  it("a membership read that errored (not 'no row') is unknown", async () => {
    core.mockResolvedValue({ kind: "no-access", user: { id: "x" }, memberReadFailed: true });
    expect(await previewFlag()).toBe("unknown");
  });
});

describe("previewSafe's refusal shapes", () => {
  beforeEach(() => {
    core.mockResolvedValue(session("owner"));
    rpc.mockResolvedValue({ data: [{ target_user_id: TEAMMATE, started_at: "2026-11-23T10:00:00Z" }], error: null });
  });

  it("redirect-style actions go back with ?notice=preview", async () => {
    requestHeaders = new Headers({ referer: "https://app.example.test/dashboard/matters/m1/", host: "app.example.test" });
    const body = vi.fn(async () => undefined);
    await expect(previewSafe(body as () => Promise<void>, "redirect")()).rejects.toThrow("redirect:/dashboard/matters/m1/?notice=preview");
    expect(body).not.toHaveBeenCalled();
  });

  it("a custom refusal gets the sentence", async () => {
    const out = await previewSafe(async () => ({ wrote: true }), () => ({ wrote: false }))();
    expect(out).toEqual({ wrote: false });
  });

  it("a mutating route handler answers 409 with the sentence", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const r = await previewSafeRoute(handler)();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: VIEW_AS_READ_ONLY });
    expect(handler).not.toHaveBeenCalled();
  });

  it("outside a preview the body runs unchanged", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const body = vi.fn(async (a: number) => ({ ok: true as const, a }));
    expect(await previewSafe(body as (a: number) => Promise<{ ok: true; a: number } | { ok: false; error: string }>, "state")(7)).toEqual({ ok: true, a: 7 });
  });
});
