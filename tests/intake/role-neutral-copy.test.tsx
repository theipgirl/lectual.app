import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import NeedsRebeccaBadge from "@/app/dashboard/intake/_components/NeedsRebeccaBadge";

/** Source with comments removed, so only strings and JSX text remain to check. */
function visibleSource(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const dir = "src/app/dashboard/intake/_components";
const files = [
  ...readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => `${dir}/${f}`),
  "src/app/dashboard/intake/page.tsx",
  "src/app/dashboard/leads/[id]/page.tsx",
  "src/components/leads/WaitingOnRebecca.tsx",
  "src/lib/intake/needs-rebecca.ts",
  "src/lib/consult-proposal/link.ts",
];

describe("copy shown to every firm names no person", () => {
  it.each(files)("%s has no first name in user-visible text", (f) => {
    expect(visibleSource(f)).not.toMatch(/\bRebecca\b/);
  });
});

describe("Needs attorney badge and chip", () => {
  const item = { queueId: "q1", headline: "Reply to Ada", kind: "client_draft", createdAt: null } as never;
  it("renders the role-neutral label with the count", () => {
    const html = renderToStaticMarkup(NeedsRebeccaBadge({ pending: [item, item] }) as never);
    expect(html).toContain("Needs attorney · 2");
  });
  it("renders nothing at zero", () => {
    expect(NeedsRebeccaBadge({ pending: [] })).toBeNull();
  });
  it("the filter chip hides its count at zero", () => {
    const src = readFileSync(`${dir}/IntakeControls.tsx`, "utf8");
    expect(src).toContain("Needs attorney");
    expect(src).toContain("needsRebeccaCount > 0 &&");
  });
});
