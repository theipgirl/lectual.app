import { describe, it, expect } from "vitest";
import {
  MAX_TRAIL_BYTES,
  emptyTrail,
  formatTrail,
  loadTrail,
  parseTrailJson,
  recordError,
  recordRoute,
  redactForTrail,
  sanitizeTrail,
  saveTrail,
  serializeTrail,
  TRAIL_STORAGE_KEY,
  type Trail,
} from "@/lib/feedback/trail";

const at = (n: number) => new Date(Date.UTC(2026, 9, 22, 12, 0, n)).toISOString();
const UUID = "11111111-1111-4111-8111-111111111111";

describe("recordRoute", () => {
  it("keeps the last 30 with ISO times, drops ?query and #hash, keeps uuid segments", () => {
    let t = emptyTrail();
    for (let i = 0; i < 40; i++) t = recordRoute(t, `/dashboard/leads/${UUID}/${i}?token=secret#frag`, at(i));
    expect(t.routes).toHaveLength(30);
    expect(t.routes[0].path).toBe(`/dashboard/leads/${UUID}/10`);
    expect(t.routes[29].at).toBe(at(39));
    expect(JSON.stringify(t)).not.toMatch(/token|secret|frag/);
  });
  it("ignores a non-path and a bad time", () => {
    expect(recordRoute(emptyTrail(), "https://x.example/a", at(1)).routes).toEqual([]);
    expect(recordRoute(emptyTrail(), "/a", "yesterday").routes).toEqual([]);
  });
});

describe("recordError", () => {
  it("keeps the last 20, cuts at 300, replaces emails, and has no stack field", () => {
    let t = emptyTrail();
    for (let i = 0; i < 25; i++) t = recordError(t, { message: `boom ${i} for ana@client.example ${"x".repeat(500)}`, source: "https://a.example/app.js:" + "9".repeat(400), at: at(i) });
    expect(t.errors).toHaveLength(20);
    expect(t.errors[0].message).toContain("boom 5");
    for (const e of t.errors) {
      expect(e.message.length).toBeLessThanOrEqual(300);
      expect(e.source.length).toBeLessThanOrEqual(300);
      expect(e.message).not.toContain("ana@client.example");
      expect(Object.keys(e).sort()).toEqual(["at", "message", "source"]);
    }
    expect(redactForTrail("mail me at a@b.co now")).toBe("mail me at [email] now");
  });
});

describe("serializeTrail", () => {
  it("never exceeds 20,480 bytes, dropping the oldest first", () => {
    let t: Trail = emptyTrail();
    for (let i = 0; i < 30; i++) t = recordRoute(t, "/dashboard/" + "p".repeat(280) + i, at(i));
    for (let i = 0; i < 20; i++) t = recordError(t, { message: "m".repeat(300) + i, source: "s".repeat(300), at: at(i) });
    const json = serializeTrail(t);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(MAX_TRAIL_BYTES);
    const back = JSON.parse(json) as Trail;
    expect(back.routes.length).toBeGreaterThan(0);
    expect(back.routes[back.routes.length - 1].path.endsWith("29")).toBe(true);
  });
});

describe("sanitizeTrail", () => {
  it("returns only the allowed shape within the caps for a hostile payload", () => {
    const hostile = {
      routes: Array.from({ length: 500 }, (_, i) => ({ path: `/x/${i}?token=x`, at: at(i % 50), html: "<b>page text</b>" })),
      errors: Array.from({ length: 500 }, () => ({ message: "y".repeat(10_000), source: "z".repeat(10_000), at: at(1), stack: "at secret()" })),
      viewport: { width: 1200, height: 800, dom: "<p>hi</p>" },
      userAgent: "u".repeat(10_000),
      build: ["not", "a", "string"],
      domText: "Client Jane Doe, jane@example.com",
      formValues: { a: 1 },
    };
    const t = sanitizeTrail(hostile);
    expect(Object.keys(t).sort()).toEqual(["build", "errors", "routes", "userAgent", "viewport"]);
    expect(t.routes.length).toBeLessThanOrEqual(30);
    expect(t.errors.length).toBeLessThanOrEqual(20);
    expect(t.userAgent?.length).toBe(300);
    expect(t.build).toBeNull();
    expect(Object.keys(t.viewport!).sort()).toEqual(["height", "width"]);
    const json = JSON.stringify(t);
    expect(json).not.toMatch(/token|secret|page text|Jane|jane@|formValues|stack/);
  });
  it("garbage becomes an empty trail and never throws", () => {
    for (const g of [null, undefined, 5, "x", [], { routes: "no", errors: 3 }]) expect(sanitizeTrail(g)).toEqual(emptyTrail());
    expect(parseTrailJson("{not json")).toEqual(emptyTrail());
    expect(parseTrailJson("x".repeat(100_000))).toEqual(emptyTrail());
  });
});

describe("storage", () => {
  it("uses the one key and survives a blocked storage", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    saveTrail(storage, recordRoute(emptyTrail(), "/dashboard/", at(1)));
    expect([...data.keys()]).toEqual([TRAIL_STORAGE_KEY]);
    expect(loadTrail(storage).routes).toHaveLength(1);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadTrail(broken)).toEqual(emptyTrail());
    expect(() => saveTrail(broken, emptyTrail())).not.toThrow();
  });
  it("formats a readable list", () => {
    const text = formatTrail(recordRoute(emptyTrail(), "/dashboard/queue/", at(3)));
    expect(text).toContain("/dashboard/queue/");
    expect(text).toContain("App build: none");
  });
});
