import { describe, expect, it } from "vitest";
import { mergeSyncResults, type SourceSync } from "@/lib/meetings/sync-result";
import { canSyncMeetings, syncControl } from "@/lib/meetings/sync-access";

const imported = (provider: SourceSync["provider"], inserted: number): SourceSync => ({ provider, outcome: { kind: "imported", inserted } });
const miss = (provider: SourceSync["provider"]): SourceSync => ({ provider, outcome: { kind: "not-connected" } });

describe("mergeSyncResults (Sprint 34 E)", () => {
  it.each([
    ["one source, three new", [imported("zoom", 3), miss("fathom")], "ok", "3 new meetings imported. Fathom isn't connected.", false],
    ["singular", [imported("fathom", 1), imported("zoom", 0)], "ok", "1 new meeting imported.", false],
    ["both sources add up", [imported("fathom", 2), imported("zoom", 2)], "ok", "4 new meetings imported.", false],
    ["none new", [imported("fathom", 0), miss("zoom")], "ok", "No new meetings. Zoom isn't connected.", false],
    ["partial failure is an error, and keeps the count", [imported("fathom", 2), { provider: "zoom", outcome: { kind: "failed" } }], "error", "2 new meetings imported. Couldn't import from Zoom.", false],
    ["reauth names the source and offers Reconnect", [imported("fathom", 0), { provider: "zoom", outcome: { kind: "reauth" } }], "error", "No new meetings. Couldn't reach Zoom.", true],
    ["every source failed", [{ provider: "fathom", outcome: { kind: "failed" } }, { provider: "zoom", outcome: { kind: "reauth" } }], "error", "Couldn't reach Zoom. Couldn't import from Fathom.", true],
    ["nothing connected is never an empty success", [miss("fathom"), miss("zoom")], "error", "Fathom isn't connected. Zoom isn't connected.", false],
  ] as const)("%s", (_name, results, tone, text, reconnect) => {
    const out = mergeSyncResults(results as unknown as SourceSync[]);
    expect(out.tone).toBe(tone);
    expect(out.text).toBe(text);
    expect(out.reconnect).toBe(reconnect);
  });

  it("a failed import never reads as No new meetings", () => {
    expect(mergeSyncResults([{ provider: "zoom", outcome: { kind: "failed" } }]).text).not.toContain("No new meetings");
    expect(mergeSyncResults([{ provider: "zoom", outcome: { kind: "reauth" } }]).text).not.toContain("No new meetings");
  });

  it("a refusal or a switched-off integration is an error with a fixed sentence", () => {
    const refused = mergeSyncResults([{ provider: "zoom", outcome: { kind: "refused" } }]);
    expect(refused).toMatchObject({ tone: "error", text: "Senior admin or above can sync meetings." });
    expect(mergeSyncResults([{ provider: "zoom", outcome: { kind: "not-switched-on" } }]).tone).toBe("error");
  });
});

describe("who sees the button", () => {
  it("only the admin tier; the same function the action uses", () => {
    for (const role of ["owner", "admin", "senior_admin"]) expect(canSyncMeetings(role)).toBe(true);
    for (const role of ["attorney", "clerk", "viewer", "social_media", "intake", "nonsense", null, undefined]) expect(canSyncMeetings(role)).toBe(false);
  });

  it("nothing for other roles; a connect link with no source (or an unreadable list); the button otherwise", () => {
    expect(syncControl("viewer", [{ provider: "zoom", status: "active" }])).toBe("none");
    expect(syncControl("owner", [])).toBe("connect");
    expect(syncControl("owner", null)).toBe("connect");
    expect(syncControl("admin", [{ provider: "zoom", status: "active" }])).toBe("sync");
  });
});
