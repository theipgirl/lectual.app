import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CAMPAIGN_LOAD_ERRORS, campaignLoadError } from "@/lib/campaigns/load-errors";

const SENTINEL = new Error("SENTINEL database text: relation crm_drip_sequence");

describe("Campaigns load errors", () => {
  it("each failed read says its own fixed sentence and never the thrown text", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(campaignLoadError("list", SENTINEL)).toBe("Couldn't load campaigns. Refresh to try again.");
    expect(campaignLoadError("steps", SENTINEL)).toBe("Couldn't load this campaign's steps. Refresh to try again.");
    expect(campaignLoadError("enrollments", SENTINEL)).toBe("Couldn't load who's enrolled. Refresh to try again.");
    expect(campaignLoadError("templates", SENTINEL)).toBe("Couldn't load templates. Refresh to try again.");
    for (const text of Object.values(CAMPAIGN_LOAD_ERRORS)) expect(text).not.toContain("SENTINEL");
  });

  it("logs only the kind of error, not its message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    campaignLoadError("list", SENTINEL);
    expect(JSON.stringify(spy.mock.calls.at(-1))).not.toContain("SENTINEL");
  });

  it("the four pages use the helper, and none renders err.message", () => {
    for (const file of [
      "src/app/dashboard/campaigns/page.tsx",
      "src/app/dashboard/campaigns/[id]/page.tsx",
      "src/app/dashboard/campaigns/templates/page.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("campaignLoadError(");
      expect(source, file).not.toMatch(/err(or)?\.message/);
    }
  });

  it("the condition step is a note only, and no copy says 'schema'", () => {
    const page = readFileSync("src/app/dashboard/campaigns/[id]/page.tsx", "utf8");
    expect(page).toContain("This step is a note only. It doesn&apos;t change what happens next.");
    expect(page).not.toMatch(/schema/i);
  });
});
