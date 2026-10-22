import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { clientLinkHosts, parseClientLinkOrigins } from "@/lib/proposals/client-link-config";

vi.mock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.lectual.app") }));

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const APP = "https://app.lectual.app";

describe("clientLinkOrigin", () => {
  it("returns the configured origin for that org, the app origin for any other or when unset", async () => {
    const { resolveClientLinkOrigin, clientLinkOrigin } = await import("@/lib/proposals/client-link-origin");
    const raw = JSON.stringify({ [ORG]: "https://proposals.rpblawfirm.com" });
    expect(resolveClientLinkOrigin(ORG, APP, raw)).toBe("https://proposals.rpblawfirm.com");
    expect(resolveClientLinkOrigin(OTHER, APP, raw)).toBe(APP);
    expect(resolveClientLinkOrigin(ORG, APP + "/", undefined)).toBe(APP);
    vi.stubEnv("FIRM_CLIENT_LINK_ORIGINS", raw);
    expect(await clientLinkOrigin(ORG)).toBe("https://proposals.rpblawfirm.com");
    expect(await clientLinkOrigin(OTHER)).toBe(APP);
    vi.stubEnv("FIRM_CLIENT_LINK_ORIGINS", "");
    expect(await clientLinkOrigin(ORG)).toBe(APP);
    vi.unstubAllEnvs();
  });

  it("builds /p/<token>/ in one place", async () => {
    const { clientLinkUrl } = await import("@/lib/proposals/client-link-origin");
    expect(clientLinkUrl("https://x.example/", "tok")).toBe("https://x.example/p/tok/");
  });

  it("ignores invalid entries and tolerates a trailing slash", () => {
    const parse = (v: unknown) => [...parseClientLinkOrigins(JSON.stringify(v)).entries()];
    expect(parse({ a: "https://proposals.example.com/" })).toEqual([["a", "https://proposals.example.com"]]);
    expect(parse({ a: "http://proposals.example.com" })).toEqual([]);
    expect(parse({ a: "https://proposals.example.com/path" })).toEqual([]);
    expect(parse({ a: "https://proposals.example.com/?q=1" })).toEqual([]);
    expect(parse({ a: "https://proposals.example.com/#x" })).toEqual([]);
    expect(parse({ a: "https://user:pw@proposals.example.com" })).toEqual([]);
    expect(parse({ a: 5, b: null, c: ["https://x.example"], d: "not a url" })).toEqual([]);
    expect(parse({ a: "https://ok.example", b: "http://bad.example" })).toEqual([["a", "https://ok.example"]]);
    expect([...parseClientLinkOrigins("{not json")]).toEqual([]);
    expect([...parseClientLinkOrigins("[]")]).toEqual([]);
    expect([...parseClientLinkOrigins("null")]).toEqual([]);
    expect([...parseClientLinkOrigins(undefined)]).toEqual([]);
  });
});

describe("server action allowed origins", () => {
  it("are the hosts only, and empty when the env is unset or invalid", () => {
    expect(clientLinkHosts(JSON.stringify({ a: "https://proposals.rpblawfirm.com", b: "https://proposals.rpblawfirm.com", c: "http://nope.example" }))).toEqual(["proposals.rpblawfirm.com"]);
    expect(clientLinkHosts(undefined)).toEqual([]);
    expect(clientLinkHosts("garbage")).toEqual([]);
  });
  it("next.config reads them from the same helper", () => {
    const cfg = readFileSync("next.config.ts", "utf8");
    expect(cfg).toContain("clientLinkHosts(process.env.FIRM_CLIENT_LINK_ORIGINS)");
    expect(cfg).toContain("allowedOrigins");
  });
});

describe("the consult email and the proposal page build the same URL", () => {
  it("for a firm with a configured origin; the app-origin link for old proposals still has the same shape", async () => {
    const { resolveClientLinkOrigin, clientLinkUrl } = await import("@/lib/proposals/client-link-origin");
    const raw = JSON.stringify({ [ORG]: "https://proposals.rpblawfirm.com" });
    const page = clientLinkUrl(resolveClientLinkOrigin(ORG, APP, raw), "tok");
    const email = clientLinkUrl(resolveClientLinkOrigin(ORG, "https://other.example", raw), "tok");
    expect(page).toBe("https://proposals.rpblawfirm.com/p/tok/");
    expect(email).toBe(page);
    expect(clientLinkUrl(resolveClientLinkOrigin(OTHER, APP, raw), "tok")).toBe(`${APP}/p/tok/`);
  });
  it("run.ts and the page use the helper", () => {
    expect(readFileSync("src/lib/consult-proposal/run.ts", "utf8")).toContain("resolveClientLinkOrigin(orgId, origin)");
    expect(readFileSync("src/app/dashboard/proposals/[id]/page.tsx", "utf8")).toContain("clientLinkOrigin(proposal.org_id)");
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("/p/ client URLs are built only by the helper", () => {
  it("no other template literal in src builds one (the route directory is excluded)", () => {
    const offenders = sources("src")
      .filter((f) => !f.startsWith("src/app/p/") && !f.endsWith("client-link-origin.ts"))
      .filter((f) => /`[^`]*\/p\/\$\{/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
