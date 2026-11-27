import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/intake-forms/frame-lookup", () => ({ readFrameDomains: async () => [] }));

import { proxy } from "@/proxy";
import { proxyRefuses, VIEW_AS_COOKIE } from "@/lib/views/view-as-rules";
import { VIEW_AS_READ_ONLY } from "@/lib/ui/words";

const req = (method: string, p: string, cookie = true) =>
  new NextRequest(`https://app.example.test${p}`, { method, headers: cookie ? { cookie: `${VIEW_AS_COOKIE}=1` } : {} });

describe("the proxy's quick refusal (Layer c)", () => {
  it("with the hint cookie, a non-GET on a signed-in path gets 409 and the sentence", async () => {
    for (const p of ["/dashboard/leads/abc/", "/api/matters-chat/"]) {
      const r = await proxy(req("POST", p));
      expect(r.status, p).toBe(409);
      expect(await r.text()).toBe(VIEW_AS_READ_ONLY);
    }
  });

  it("the OAuth connect / callback GETs are refused too", () => {
    expect(proxyRefuses("GET", "/api/mailbox/connect/microsoft/")).toBe(true);
    expect(proxyRefuses("GET", "/api/mailbox/callback/google/")).toBe(true);
    expect(proxyRefuses("GET", "/api/meetings/zoom/connect/")).toBe(true);
    expect(proxyRefuses("GET", "/api/lawpay/callback/")).toBe(true);
  });

  it("the three fixed paths, cron, webhooks, the worksheet and the public token pages pass", async () => {
    for (const p of ["/dashboard/view-as/enter/", "/dashboard/view-as/exit/", "/auth/sign-out/", "/api/cron/agents/", "/api/webhooks/x/", "/api/worksheet/", "/p/abc/", "/i/slug/", "/q/t/", "/r/t/"]) {
      expect(proxyRefuses("POST", p), p).toBe(false);
    }
    const r = await proxy(req("POST", "/dashboard/view-as/exit/"));
    expect(r.status).not.toBe(409);
  });

  it("GET pages pass, and nothing is refused without the cookie", async () => {
    expect((await proxy(req("GET", "/dashboard/"))).status).not.toBe(409);
    expect((await proxy(req("POST", "/dashboard/leads/x/", false))).status).not.toBe(409);
  });

  it("the proxy reads no preview state (it is not the authority)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/proxy.ts"), "utf8");
    expect(src).not.toMatch(/owner_view_as_state|view-as-flag|previewFlag|readPreviewState/);
  });
});
