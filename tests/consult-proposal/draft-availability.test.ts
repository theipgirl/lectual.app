import { describe, it, expect } from "vitest";
import { DRAFT_BLOCK_NOTE, draftBlock, settingsReadiness } from "@/lib/consult-proposal/draft-availability";

const ok = { aiConfigured: true, queue: "connected", settings: "ready" } as const;

describe("draftBlock", () => {
  it("is null when everything is in place", () => {
    expect(draftBlock(ok)).toBeNull();
  });
  it("names the missing AI key first", () => {
    expect(draftBlock({ ...ok, aiConfigured: false, queue: "no-org-key", settings: "missing" })).toBe("no-ai");
  });
  it("treats both no-queue causes as no-queue", () => {
    expect(draftBlock({ ...ok, queue: "no-org-key" })).toBe("no-queue");
    expect(draftBlock({ ...ok, queue: "no-env" })).toBe("no-queue");
  });
  it("names missing settings last", () => {
    expect(draftBlock({ ...ok, settings: "missing" })).toBe("no-settings");
  });
  it("does not block on a fact it could not read", () => {
    expect(draftBlock({ ...ok, queue: "unknown", settings: "unknown" })).toBeNull();
  });
});

describe("settingsReadiness", () => {
  it("is missing with no row or no approvers, ready with one, unknown on a failed read", () => {
    expect(settingsReadiness({ status: "ok", row: null })).toBe("missing");
    expect(settingsReadiness({ status: "ok", row: { approver_user_ids: [] } })).toBe("missing");
    expect(settingsReadiness({ status: "ok", row: { approver_user_ids: ["u1"] } })).toBe("ready");
    expect(settingsReadiness({ status: "unavailable" })).toBe("unknown");
  });
});

describe("notes", () => {
  it("never mention a secret value", () => {
    for (const note of Object.values(DRAFT_BLOCK_NOTE)) expect(note).not.toMatch(/sk-|Bearer/);
  });
});
