import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { STATUS_WORDS, BUTTON_WORDS, askToCreateLink, SETTINGS_APPROVERS_HEADING, EVENT_WORDS, LINK_NOT_TURNED_ON } from "@/lib/proposal-editor/vocabulary";
import { statusLabel } from "@/lib/proposal-editor/labels";
import { PROPOSAL_DISPLAY_LABEL } from "@/lib/proposals/display-status";
import { describeProposalEvent } from "@/lib/proposal-editor/events";
import { lastActivityLine } from "@/lib/proposals/list-labels";

describe("Sprint 27 vocabulary", () => {
  it("status chips", () => {
    expect(STATUS_WORDS).toEqual({
      draft: "Draft",
      approved: "Saved",
      sent: "Link live",
      accepted: "Accepted by client",
      superseded: "Replaced",
      withdrawn: "Withdrawn",
    });
    for (const [k, v] of Object.entries(STATUS_WORDS)) expect(statusLabel(k)).toBe(v);
    expect(PROPOSAL_DISPLAY_LABEL.sent).toBe("Link live");
    expect(PROPOSAL_DISPLAY_LABEL.accepted).toBe("Accepted by client");
  });

  it("button words and sentences", () => {
    expect(BUTTON_WORDS.createLink).toBe("Save and create link");
    expect(BUTTON_WORDS.creatingLink).toBe("Creating link…");
    expect(BUTTON_WORDS.turnOnLink).toBe("Turn on the link");
    expect(BUTTON_WORDS.editAgain).toBe("Edit again");
    expect(askToCreateLink("A or B")).toBe("Ask A or B to create the link");
    expect(SETTINGS_APPROVERS_HEADING).toBe("Who may create client links");
    expect(LINK_NOT_TURNED_ON).toBe("Saved, but the link couldn't be turned on. Try again.");
  });

  it("timeline lines use the same words", () => {
    const ev = (type: string, payload: unknown = {}) => ({ id: "e", proposal_id: "p", type, actor: "staff", actor_user_id: null, payload, created_at: "2026-10-20T00:00:00Z" });
    const what = (type: string, payload?: unknown) => describeProposalEvent(ev(type, payload) as never, { names: new Map() }).what;
    expect(what("approved")).toBe(EVENT_WORDS.approved);
    expect(what("sent")).toBe(EVENT_WORDS.sent);
    expect(what("unapproved")).toBe(EVENT_WORDS.unapproved);
    expect(what("superseded")).toBe(EVENT_WORDS.superseded);
    const line = (type: string) =>
      lastActivityLine({ key: "draft", source: "manual", updatedAt: "2026-10-20T00:00:00Z", acceptedAt: null, offeredCount: 1, blockingIssue: null, event: ev(type) as never, names: new Map(), now: Date.parse("2026-10-20T03:00:00Z") });
    expect(line("approved")).toMatch(/^Saved /);
    expect(line("sent")).toMatch(/^Link turned on /);
    expect(line("superseded")).toMatch(/^Replaced /);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("the old words are gone from what people read", () => {
  const files = [
    ...sources("src/components/proposal-editor"),
    ...sources("src/components/proposal-list"),
    "src/lib/proposal-editor/vocabulary.ts",
    "src/lib/proposal-editor/events.ts",
    "src/lib/proposals/list-labels.ts",
    "src/lib/proposals/display-status.ts",
    "src/lib/proposals/errors.ts",
    "src/app/dashboard/proposals/[id]/actions.ts",
    "src/components/queue/LinkedProposalPanel.tsx",
    "src/lib/proposals/store.ts",
    "src/lib/proposals/validate.ts",
    "src/lib/consult-proposal/draft.ts",
  ];
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it.each(files)("%s", (f) => {
    const text = strip(readFileSync(f, "utf8"));
    expect(text).not.toMatch(/Back to draft|>\s*Approve\b|"Approve"|Approving…|Ask for approval|Revise \(/);
    expect(text).not.toMatch(/mark(?:ed)? as sent|click Approve\b/i);
    expect(text).not.toMatch(/before approving|mark the proposal as sent|Create a revision/i);
    expect(text).not.toMatch(/sent to the client|emailed to|we(?:'|’)ll email/i);
  });
});
