import { describe, expect, it, vi } from "vitest";
import { fetchTsdrStatus } from "@/lib/uspto/fetch-status";
import { registered } from "./fixtures";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const KEY = "super-secret-key-123";
const run = (f: typeof fetch, serial = "88123456") => fetchTsdrStatus(serial, { fetchImpl: f, apiKey: KEY });
const unavailable = (reason: string) => ({ status: "unavailable", reason });

describe("fetchTsdrStatus", () => {
  it("200 -> ok, sends the key in USPTO-API-KEY to the serial's URL", async () => {
    const f = vi.fn(async () => json(200, registered));
    const r = await run(f as unknown as typeof fetch);
    expect(r).toMatchObject({ status: "ok", result: { serial: "88123456", statusCode: 700 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn88123456/info.json");
    expect((init.headers as Record<string, string>)["USPTO-API-KEY"]).toBe(KEY);
    expect(init.signal).toBeDefined();
  });
  it.each([401, 403])("%i -> http_%i", async (code) => {
    expect(await run((async () => json(code, {})) as typeof fetch)).toEqual(unavailable(`http_${code}`));
  });
  it("404 -> not_found (unavailable, not ok)", async () => {
    expect(await run((async () => json(404, {})) as typeof fetch)).toEqual(unavailable("not_found"));
  });
  it("429 -> rate_limited", async () => {
    expect(await run((async () => json(429, {})) as typeof fetch)).toEqual(unavailable("rate_limited"));
  });
  it("429 carries a numeric Retry-After, capped at 3600; a date or junk is ignored", async () => {
    const r = (h?: string) => run((async () => new Response("{}", { status: 429, headers: h ? { "retry-after": h } : {} })) as typeof fetch);
    expect(await r("30")).toEqual({ status: "unavailable", reason: "rate_limited", retryAfterSeconds: 30 });
    expect(await r("999999")).toEqual({ status: "unavailable", reason: "rate_limited", retryAfterSeconds: 3600 });
    expect(await r("Wed, 21 Oct 2026 07:28:00 GMT")).toEqual(unavailable("rate_limited"));
    expect(await r()).toEqual(unavailable("rate_limited"));
  });
  it("every non-200 response has its body cancelled", async () => {
    for (const code of [204, 401, 404, 429, 500]) {
      const cancel = vi.fn(async () => undefined);
      const res = { status: code, headers: new Headers(), body: { cancel } } as unknown as Response;
      await run((async () => res) as typeof fetch);
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });
  it("never follows a redirect: the key stays on this host (a refused redirect is network)", async () => {
    const f = vi.fn(async (_u: unknown, init: RequestInit) => {
      if (init.redirect === "error") throw new TypeError("redirect mode is set to error");
      return json(200, registered);
    });
    expect(await run(f as unknown as typeof fetch)).toEqual(unavailable("network"));
    expect((f.mock.calls[0][1] as RequestInit).redirect).toBe("error");
  });
  it("500 -> http_500, and 204 is not ok", async () => {
    expect(await run((async () => json(500, {})) as typeof fetch)).toEqual(unavailable("http_500"));
    expect(await run((async () => new Response(null, { status: 204 })) as typeof fetch)).toEqual(unavailable("http_204"));
  });
  it("timeout -> timeout; other network error -> network", async () => {
    const t = Object.assign(new Error("x"), { name: "TimeoutError" });
    expect(await run((async () => { throw t; }) as typeof fetch)).toEqual(unavailable("timeout"));
    expect(await run((async () => { throw new TypeError("boom"); }) as typeof fetch)).toEqual(unavailable("network"));
  });
  it("a real deadline aborts a hung fetch", async () => {
    const hung = ((_u: unknown, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as unknown as typeof fetch;
    expect(await fetchTsdrStatus("88123456", { fetchImpl: hung, apiKey: KEY, timeoutMs: 20 })).toEqual(unavailable("timeout"));
  });
  it("malformed JSON and wrong shape -> shape", async () => {
    expect(await run((async () => new Response("<html>", { status: 200 })) as typeof fetch)).toEqual(unavailable("shape"));
    expect(await run((async () => json(200, { trademarks: [] })) as typeof fetch)).toEqual(unavailable("shape"));
  });
  it("no key -> not-set-up and no request is made", async () => {
    const f = vi.fn();
    expect(await fetchTsdrStatus("88123456", { fetchImpl: f as unknown as typeof fetch, apiKey: null })).toEqual({ status: "not-set-up" });
    expect(await fetchTsdrStatus("88123456", { fetchImpl: f as unknown as typeof fetch, apiKey: "  " })).toEqual({ status: "not-set-up" });
    expect(f).not.toHaveBeenCalled();
  });
  it.each(["1234567", "123456789", "1234567a", "", " 12345678", "12345678\n"])("serial %j is refused with no request", async (s) => {
    const f = vi.fn();
    expect(await fetchTsdrStatus(s, { fetchImpl: f as unknown as typeof fetch, apiKey: KEY })).toEqual(unavailable("bad_serial"));
    expect(f).not.toHaveBeenCalled();
  });
  it("never puts the key or the body in a result", async () => {
    for (const f of [
      async () => json(500, { echo: KEY }),
      async () => json(200, { echo: KEY }),
    ]) {
      expect(JSON.stringify(await run(f as unknown as typeof fetch))).not.toContain(KEY);
    }
  });
});

describe("config", () => {
  it("reads USPTO_TSDR_API_KEY; unset or blank is null", async () => {
    const prev = process.env.USPTO_TSDR_API_KEY;
    try {
      vi.resetModules();
      delete process.env.USPTO_TSDR_API_KEY;
      expect((await import("@/lib/uspto/config")).tsdrApiKey()).toBeNull();
      vi.resetModules();
      process.env.USPTO_TSDR_API_KEY = "  abc  ";
      expect((await import("@/lib/uspto/config")).tsdrApiKey()).toBe("abc");
      vi.resetModules();
      process.env.USPTO_TSDR_API_KEY = "   ";
      expect((await import("@/lib/uspto/config")).tsdrApiKey()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.USPTO_TSDR_API_KEY;
      else process.env.USPTO_TSDR_API_KEY = prev;
    }
  });
});
