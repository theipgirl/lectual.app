import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const flag = vi.fn(async () => "on" as "on" | "off" | "unknown");
vi.mock("@/lib/views/view-as-flag", () => ({ previewFlag: () => flag() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

import { previewNetFetch } from "@/lib/db/scoped-client";
import { netMustAsk } from "@/lib/views/view-as-rules";
import { VIEW_AS_READ_ONLY } from "@/lib/ui/words";

/**
 * View as, Layer b: a scoped client's own fetch refuses writes while previewing. Exercised through a real supabase-js
 * client whose fetch is the net, with the network replaced by a spy: a refused call never reaches the spy.
 */
const URL_ = "http://supabase.test";
const sent: { method: string; url: string }[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    sent.push({ method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), url });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const client = () =>
  createClient(URL_, "anon-key", { global: { fetch: previewNetFetch }, auth: { persistSession: false, autoRefreshToken: false } });

describe("with the preview flag on", () => {
  beforeEach(() => flag.mockResolvedValue("on"));

  it("insert, update, upsert, delete, a POST rpc, a storage upload and updateUser never reach the network", async () => {
    const db = client();
    const results = [
      await db.from("crm_lead").insert({ a: 1 }),
      await db.from("crm_lead").update({ a: 1 }).eq("id", "x"),
      await db.from("crm_lead").upsert({ a: 1 }),
      await db.from("crm_lead").delete().eq("id", "x"),
      await db.rpc("crm_merge_leads", { p_keeper: "a" }),
    ];
    for (const r of results) {
      expect(r.error).not.toBeNull();
      expect(JSON.stringify(r.error)).toContain(VIEW_AS_READ_ONLY);
    }
    const up = await db.storage.from("client-files").upload("o/lead/p/f.pdf", new Blob(["x"]));
    expect(up.error).not.toBeNull();
    // updateUser needs a session; the net is checked directly for its path.
    expect(netMustAsk("PUT", "/auth/v1/user")).toBe(true);
    const put = await previewNetFetch(`${URL_}/auth/v1/user`, { method: "PUT", body: "{}" });
    expect(put.status).toBe(409);
    expect(sent).toEqual([]);
  });

  it("GET reads, GET rpcs, signed download links and the view-as log functions pass", async () => {
    const db = client();
    await db.from("crm_lead").select("id");
    await db.rpc("current_org_role", undefined, { get: true });
    await db.storage.from("client-files").createSignedUrl("o/lead/p/f.pdf", 60);
    await db.rpc("owner_view_as_state" as never);
    await db.rpc("owner_view_as_end" as never, { p_reason: "exit" } as never);
    const paths = sent.map((s) => `${s.method} ${new URL(s.url).pathname}`);
    expect(paths).toEqual([
      "GET /rest/v1/crm_lead",
      "GET /rest/v1/rpc/current_org_role",
      "POST /storage/v1/object/sign/client-files/o/lead/p/f.pdf",
      "POST /rest/v1/rpc/owner_view_as_state",
      "POST /rest/v1/rpc/owner_view_as_end",
    ]);
  });

  it("an UPLOAD sign (a write precursor) is refused; auth refresh and logout pass", () => {
    expect(netMustAsk("POST", "/storage/v1/object/upload/sign/client-files/x")).toBe(true);
    expect(netMustAsk("POST", "/auth/v1/token")).toBe(false);
    expect(netMustAsk("POST", "/auth/v1/logout")).toBe(false);
  });

  it("'unknown' refuses the same way", async () => {
    flag.mockResolvedValue("unknown");
    const r = await client().from("crm_lead").insert({ a: 1 });
    expect(r.error).not.toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("with the flag off", () => {
  beforeEach(() => flag.mockResolvedValue("off"));
  it("everything passes", async () => {
    const db = client();
    await db.from("crm_lead").insert({ a: 1 });
    await db.from("crm_lead").delete().eq("id", "x");
    await db.rpc("crm_merge_leads", { p_keeper: "a" });
    expect(sent.map((s) => s.method)).toEqual(["POST", "DELETE", "POST"]);
  });

  it("reads never ask the flag at all", async () => {
    flag.mockClear();
    await client().from("crm_lead").select("id");
    expect(flag).not.toHaveBeenCalled();
  });
});
