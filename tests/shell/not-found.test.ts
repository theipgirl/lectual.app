import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(__dirname, "../..");

// next.config.ts sets trailingSlash: true, which Next hands to <Link> through this variable at build time.
process.env.__NEXT_TRAILING_SLASH = "true";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });
}

describe("placeholder copy is gone (F13)", () => {
  it("deletes NotBuilt.tsx and the [section] route", () => {
    expect(existsSync(path.join(root, "src/components/shell/NotBuilt.tsx"))).toBe(false);
    expect(existsSync(path.join(root, "src/app/dashboard/[section]"))).toBe(false);
  });

  it("has no 'designed but not built' text, and nothing imports NotBuilt", () => {
    for (const file of sourceFiles(path.join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toContain("designed but not built");
      expect(text, file).not.toMatch(/\bNotBuilt\b/);
    }
  });
});

describe("dashboard catch-all (F14)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls notFound() for every unknown path, nested ones included", async () => {
    const notFound = vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    vi.doMock("next/navigation", () => ({ notFound }));
    const { default: Catchall } = await import("../../src/app/dashboard/[...rest]/page");
    const call = Catchall as unknown as (props: { params: Promise<{ rest: string[] }> }) => unknown;
    for (const rest of [["sms"], ["settings", "agents", "x"], ["anything"], ["portals"], ["skills"]]) {
      expect(() => call({ params: Promise.resolve({ rest }) }), rest.join("/")).toThrow("NEXT_NOT_FOUND");
    }
    expect(notFound).toHaveBeenCalledTimes(5);
  });

  it("never asks about modules and never names one", () => {
    const src = readFileSync(path.join(root, "src/app/dashboard/[...rest]/page.tsx"), "utf8");
    expect(src).not.toContain("orgHasModule");
    expect(src).not.toContain("@/lib/org/modules");
    expect(src).not.toMatch(/module|firm.*(lacks|has not|doesn)/i);
  });
});

describe("404 pages (F14)", () => {
  it("the dashboard 404 has a heading, a way back to Today and a Go back control", async () => {
    const { default: DashboardNotFound } = await import("../../src/app/dashboard/not-found");
    const html = renderToStaticMarkup(createElement(DashboardNotFound));
    expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    expect(html).toMatch(/<a [^>]*href="\/dashboard\/"[^>]*class="lx-btn lx-btn-pri"|<a [^>]*class="lx-btn lx-btn-pri"[^>]*href="\/dashboard\/"/);
    expect(html).toContain(">Go back</button>");
  });

  it("the public 404 links to /", async () => {
    const { default: NotFound } = await import("../../src/app/not-found");
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    expect(html).toMatch(/href="\/"/);
    expect(html).toContain(">Go back</button>");
  });

  it("carries no development copy", async () => {
    const { default: DashboardNotFound } = await import("../../src/app/dashboard/not-found");
    const { default: NotFound } = await import("../../src/app/not-found");
    for (const html of [renderToStaticMarkup(createElement(DashboardNotFound)), renderToStaticMarkup(createElement(NotFound))]) {
      expect(html).not.toMatch(/design\/|MVP|build step|not built/i);
    }
  });

  it("uses the existing button and heading classes", () => {
    const src = readFileSync(path.join(root, "src/app/dashboard/not-found.tsx"), "utf8");
    expect(src).toContain("lx-h2");
    expect(src).toContain("lx-btn lx-btn-pri");
    expect(readFileSync(path.join(root, "src/components/shell/GoBackButton.tsx"), "utf8")).toContain("lx-btn lx-btn-sec");
  });
});
