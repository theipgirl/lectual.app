import { describe, expect, it } from "vitest";
import { resolveSiteOrigin } from "@/lib/site-origin-resolve";
import { checkProposalUrl } from "@/lib/consult-proposal/email";

describe("resolveSiteOrigin", () => {
  it("prefers the browser's Origin header", () => {
    expect(resolveSiteOrigin({ origin: "https://lectual.app/", host: "other.vercel.app" })).toBe("https://lectual.app");
  });

  it("ignores an Origin of 'null' or a non-http scheme and falls back to the host", () => {
    expect(resolveSiteOrigin({ origin: "null", host: "lectual.app", forwardedProto: "https" })).toBe("https://lectual.app");
    expect(resolveSiteOrigin({ origin: "chrome-extension://abc", host: "lectual.app" })).toBe("https://lectual.app");
  });

  it("builds https from x-forwarded-host/proto, taking the first of a list", () => {
    expect(resolveSiteOrigin({ forwardedHost: "lectual.app, internal.vercel.app", host: "x", forwardedProto: "https,http" })).toBe("https://lectual.app");
  });

  it("defaults a deployed host with no proto to https, and upgrades http", () => {
    expect(resolveSiteOrigin({ host: "lectual.app" })).toBe("https://lectual.app");
    expect(resolveSiteOrigin({ host: "lectual.app", forwardedProto: "http" })).toBe("https://lectual.app");
    expect(resolveSiteOrigin({ origin: "http://lectual.app" })).toBe("https://lectual.app");
  });

  it("keeps plain http for a local dev server", () => {
    expect(resolveSiteOrigin({ host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(resolveSiteOrigin({ origin: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(resolveSiteOrigin({ host: "127.0.0.1:3000", forwardedProto: "http" })).toBe("http://127.0.0.1:3000");
  });

  it("uses SITE_URL (scheme added, http upgraded), then Vercel's hosts, with no request", () => {
    expect(resolveSiteOrigin({ siteUrl: "lectual.app/" })).toBe("https://lectual.app");
    expect(resolveSiteOrigin({ siteUrl: "http://lectual.app" })).toBe("https://lectual.app");
    expect(resolveSiteOrigin({ vercelProductionHost: "lectual.app", vercelHost: "x-123.vercel.app" })).toBe("https://lectual.app");
    expect(resolveSiteOrigin({ vercelHost: "x-123.vercel.app" })).toBe("https://x-123.vercel.app");
    expect(resolveSiteOrigin({})).toBe("http://localhost:3000");
  });

  it("refuses a malformed host rather than building a broken link", () => {
    expect(resolveSiteOrigin({ host: "evil.com/path@x", siteUrl: "https://lectual.app" })).toBe("https://lectual.app");
  });

  it("every deployed result passes the proposal-link rule", () => {
    for (const input of [
      { origin: "null", host: "lectual.app" },
      { host: "lectual.app", forwardedProto: "http" },
      { origin: "http://lectual.app" },
      { siteUrl: "lectual.app" },
    ]) {
      expect(() => checkProposalUrl(`${resolveSiteOrigin(input)}/p/token/`)).not.toThrow();
    }
  });
});
