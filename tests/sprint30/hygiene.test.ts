import { describe, expect, it } from "vitest";
import fs from "node:fs";

/** Sprint 30: nothing stubbed, no raw colours, no new dependency, no migration, AGENTS.md covers it. */

const CHANGED = [
  "src/lib/org/logo.ts",
  "src/lib/account/name.ts",
  "src/lib/account/actions.ts",
  "src/lib/calendar/consult-sources.ts",
  "src/lib/calendar/consult-sources-live.ts",
  "src/lib/mailbox/read-message.ts",
  "src/lib/mailbox/read-message-live.ts",
  "src/components/account/YourNameDialog.tsx",
  "src/components/account/AddNameLink.tsx",
  "src/components/today/NeedsYouSection.tsx",
  "src/components/calendar/TodayConsults.tsx",
  "src/components/mailbox/MailReadingPane.tsx",
  "src/components/mailbox/LiveInboxList.tsx",
  "src/components/mailbox/mail-pane.css",
  "src/components/shell/wordmark.css",
];

describe("Sprint 30 hygiene", () => {
  it("no TODO or stub markers in the new source", () => {
    for (const f of CHANGED) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/\bTODO\b|\bFIXME\b|not implemented|placeholder/i);
  });

  it("new components use design tokens: no raw hex colours", () => {
    for (const f of CHANGED.filter((x) => /\.(tsx|css)$/.test(x))) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("no new dependency and no new migration in this repo", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("dompurify");
    expect(fs.existsSync("supabase")).toBe(false);
  });

  it("AGENTS.md has a Sprint 30 section", () => {
    const doc = fs.readFileSync("AGENTS.md", "utf8");
    expect(doc).toMatch(/\(Sprint 30[^)]*\)/);
    for (const needle of ["firmLogo", "saveFullNameAction", "NEEDS_YOU_SHOWN", "listUpcomingZoomMeetings", "LIVE_MESSAGE_ID", "meeting:read:list_meetings"]) expect(doc).toContain(needle);
  });

  it("Today copy implies no legal advice", () => {
    const src = ["src/components/calendar/TodayConsults.tsx", "src/lib/calendar/consult-sources.ts", "src/components/today/NeedsYouSection.tsx"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/legal advice|we advise|you should file/i);
  });
});
