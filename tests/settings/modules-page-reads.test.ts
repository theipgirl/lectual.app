import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Settings -> Modules reads", () => {
  const src = readFileSync("src/app/dashboard/settings/modules/page.tsx", "utf8");
  const body = src.slice(src.indexOf("export default async function ModulesPage"));

  it("reads the module list once per request, shared with the settings layout", () => {
    const mod = readFileSync("src/lib/org/modules.ts", "utf8");
    expect(mod).toContain("cache(readOrgModules)");
    expect((src.match(/activeOrgModules\(\)/g) ?? []).length).toBe(1);
  });
  it("the connections read waits for the module list on purpose", () => {
    // Mailboxes off must never read connections (tests/settings/modules-page.test.ts), so the two reads are dependent,
    // not independent: this is the one sequential await that stays.
    expect(body.indexOf("await activeOrgModules()")).toBeGreaterThan(-1);
    expect(body.indexOf("await mailboxStatus")).toBeGreaterThan(body.indexOf("await activeOrgModules()"));
  });
  it("no independent reads are awaited one after another", () => {
    const awaits = body.match(/await \w+/g) ?? [];
    expect(awaits).toEqual(["await activeOrgModules", "await mailboxStatus"]);
  });
});
