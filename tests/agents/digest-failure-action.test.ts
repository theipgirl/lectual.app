import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { failureAction, LECTUAL_TOLD_LABEL } from "@/lib/agents/digest";
import { RunDigestList } from "@/components/agents/RunDigestList";

/** B1: failures the firm cannot fix say Lectual has been told, with no link and no "Open the run log". */

describe("failureAction", () => {
  it("a queue 500 with an enum error and unknown causes are Lectual's: the sentence and no href", () => {
    for (const e of ["Queue API 500: invalid input value for enum queue_type", "lead read failed: x", null, ""]) {
      expect(failureAction(e)).toEqual({ label: "Lectual has been told and is looking into it.", href: null });
    }
    expect(LECTUAL_TOLD_LABEL).toBe("Lectual has been told and is looking into it.");
  });

  it("the fixable causes keep their actions and links", () => {
    expect(failureAction("Mailbox token refresh failed (invalid_grant)")).toEqual({ label: "Reconnect the mailbox", href: "/dashboard/settings/mailboxes/" });
    expect(failureAction("Zoom returned 401")).toMatchObject({ label: "Reconnect the mailbox" }); // 401 reads as a mailbox problem, as before
    expect(failureAction("Fathom said no")).toEqual({ label: "Reconnect the meeting source", href: "/dashboard/settings/integrations/meetings/" });
    expect(failureAction("model overloaded (529)")).toEqual({ label: "Try Run now later", href: "/dashboard/agents/" });
  });

  it("no code path returns 'Open the run log'", () => {
    for (const f of ["src/lib/agents/digest.ts", "src/components/agents/RunDigestList.tsx", "src/lib/today/needs-you.ts"]) {
      expect(readFileSync(f, "utf8")).not.toContain("Open the run log");
    }
  });
});

describe("the failure card", () => {
  const digest = (action: { label: string; href: string | null }) => ({
    windowHours: 24,
    lines: [],
    failures: [{ agent: "morning-brief", name: "Morning brief", text: "Morning brief couldn't finish its last run", reason: "Queue API 500.", action }],
  });
  it("draws the sentence as plain text when there is no href, and a link when there is one", () => {
    const plain = renderToStaticMarkup(createElement(RunDigestList, { digest: digest({ label: LECTUAL_TOLD_LABEL, href: null }) as never, paused: false } as never));
    expect(plain).toContain("Lectual has been told and is looking into it.");
    expect(plain).not.toContain("<a");
    const linked = renderToStaticMarkup(createElement(RunDigestList, { digest: digest({ label: "Try Run now later", href: "/dashboard/agents/" }) as never, paused: false } as never));
    expect(linked).toMatch(/<a[^>]*href="\/dashboard\/agents/);
  });
});
