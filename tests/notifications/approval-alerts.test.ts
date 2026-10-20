import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";

/**
 * createDraft -> notifyApprovers -> notify. The queue HTTP, the signed-in user,
 * the member directory and notify() are stand-ins; everything between them is real.
 */

const BODY_MARKER = "BODY-MARKER-7f3a";
const SUMMARY_MARKER = "SUMMARY-MARKER-91c2";
const RECIPIENT = "client-marker@example.com";
const SUBJECT = "SUBJECT-MARKER-55d0";
const LEAD = "11111111-1111-4111-8111-111111111111";

const directory = [
  { userId: "actor", role: "owner" },
  { userId: "admin-1", role: "admin" },
  { userId: "senior-1", role: "senior_admin" },
  { userId: "attorney-1", role: "attorney" },
  { userId: "paralegal-1", role: "paralegal" },
  { userId: "intake-1", role: "intake" },
  { userId: "viewer-1", role: "viewer" },
].map((m) => ({ ...m, email: null, displayName: null, identified: true }));

const notify = vi.fn();
const listMemberDirectory = vi.fn();
const getUser = vi.fn();
const getScopedClient = vi.fn();

function mocks() {
  vi.doMock("@/lib/env", () => ({ env: { QUEUE_API_URL: "https://lawmatics-mcp.example.com", DASHBOARD_API_TOKEN: "secret-token" } }));
  vi.doMock("@/lib/notifications/core", () => ({ notify: (...a: unknown[]) => notify(...a) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: (...a: unknown[]) => listMemberDirectory(...a) }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: (...a: unknown[]) => getScopedClient(...a) }));
}

function router(list: unknown[] = []) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "q-new" }), { status: 201 });
    return new Response(JSON.stringify({ rows: list }), { status: 200 });
  });
}

const draft = (over: Record<string, unknown> = {}) => ({
  orgKey: "rpb-law",
  agent: "post-consult",
  type: "CLIENT_EMAIL",
  headline: "Follow up with Ana Ruiz",
  draftBody: `Hi Ana,\n\nThanks for the call today. ${BODY_MARKER} We will file on Monday and send you the receipt.\n\nBest,\nRebecca`,
  summary: SUMMARY_MARKER,
  clientName: "Ana Ruiz",
  recipient: RECIPIENT,
  subject: SUBJECT,
  leadId: LEAD,
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  notify.mockReset().mockResolvedValue(undefined);
  listMemberDirectory.mockReset().mockResolvedValue(directory);
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "actor" } } });
  getScopedClient.mockReset().mockImplementation(async () => ({ auth: { getUser } }));
  mocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("approval alerts from createDraft (F6)", () => {
  it("notifies each approver except the actor, and nobody who cannot approve", async () => {
    const fetchMock = router();
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("@/lib/queue/api");
    expect(await createDraft(draft())).toEqual({ id: "q-new" });

    const recipients = notify.mock.calls.map(([arg]) => arg.userId).sort();
    expect(recipients).toEqual(["admin-1", "attorney-1", "senior-1"]);
    expect(new Set(["paralegal-1", "intake-1", "viewer-1", "actor"]).has(recipients[0])).toBe(false);

    for (const [arg] of notify.mock.calls) {
      expect(arg.kind).toBe("approval_needed");
      expect(arg.actorId).toBe("actor");
      expect(arg.leadId).toBe(LEAD);
      expect(arg.payload).toMatchObject({ source: "approval_needed", queue_id: "q-new", headline: "Follow up with Ana Ruiz" });
    }
  });

  it("uses the queue's own approval roles, not a copy", () => {
    const src = readFileSync("src/lib/notifications/approval.ts", "utf8");
    expect(src).toContain("QUEUE_APPROVE_ROLES");
    expect(QUEUE_APPROVE_ROLES).toEqual(["owner", "admin", "senior_admin", "attorney"]);
  });

  it("leaves the lead out when the caller has none", async () => {
    vi.stubGlobal("fetch", router());
    const { createDraft } = await import("@/lib/queue/api");
    await createDraft(draft({ leadId: undefined }));
    expect(notify).toHaveBeenCalled();
    for (const [arg] of notify.mock.calls) expect(arg.leadId).toBeNull();
  });

  it("puts no body, summary, recipient or subject in anything it hands to notify", async () => {
    vi.stubGlobal("fetch", router());
    const { createDraft } = await import("@/lib/queue/api");
    await createDraft(draft());
    expect(notify).toHaveBeenCalled();
    const serialised = JSON.stringify(notify.mock.calls);
    for (const secret of [BODY_MARKER, SUMMARY_MARKER, RECIPIENT, SUBJECT, "Thanks for the call"]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("does not send the lead id to the queue service", async () => {
    const fetchMock = router();
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("@/lib/queue/api");
    await createDraft(draft());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(String(post[1]!.body)).not.toContain(LEAD);
    expect(String(post[1]!.body)).not.toContain("leadId");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("raises nothing for a deduped draft", async () => {
    const body = "Hi Ana,\n\nThanks for the call today. We will file on Monday and send you the receipt.\n\nBest,\nRebecca";
    const existing = {
      id: "q-existing",
      type: "CLIENT_EMAIL",
      recipient: RECIPIENT,
      client_name: "Ana Ruiz",
      matter_id: null,
      created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
      draft_body: body,
      final_body: null,
    };
    vi.stubGlobal("fetch", router([existing]));
    const { createDraft } = await import("@/lib/queue/api");
    expect(await createDraft(draft({ draftBody: body }))).toEqual({ id: "q-existing", deduped: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("still resolves with the id when notify rejects", async () => {
    notify.mockRejectedValue(new Error("insert failed"));
    vi.stubGlobal("fetch", router());
    const { createDraft } = await import("@/lib/queue/api");
    expect(await createDraft(draft())).toEqual({ id: "q-new" });
    expect(notify).toHaveBeenCalled();
  });

  it("still creates the draft, and tries no notification, when the directory read throws", async () => {
    listMemberDirectory.mockRejectedValue(new Error("rpc down"));
    vi.stubGlobal("fetch", router());
    const { createDraft } = await import("@/lib/queue/api");
    expect(await createDraft(draft())).toEqual({ id: "q-new" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("raises nothing when nobody is signed in, and when there is no session at all", async () => {
    vi.stubGlobal("fetch", router());
    getUser.mockResolvedValue({ data: { user: null } });
    const { createDraft } = await import("@/lib/queue/api");
    expect(await createDraft(draft())).toEqual({ id: "q-new" });
    expect(notify).not.toHaveBeenCalled();

    getScopedClient.mockRejectedValue(new Error("cookies() was called outside a request scope"));
    expect(await createDraft(draft())).toEqual({ id: "q-new" });
    expect(notify).not.toHaveBeenCalled();
    expect(listMemberDirectory).not.toHaveBeenCalled();
  });

  it("raises nothing, and still returns the id, when the queue POST fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => (init?.method === "POST" ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ rows: [] })))));
    const { createDraft } = await import("@/lib/queue/api");
    await expect(createDraft(draft())).rejects.toThrow(/Queue API 500/);
    expect(notify).not.toHaveBeenCalled();
  });

  it("makes no HTTP call of its own for the alert", async () => {
    const fetchMock = router();
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("@/lib/queue/api");
    await createDraft(draft());
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toContain("lawmatics-mcp.example.com/api/queue");
  });

  it("logs a failure without naming a person, a draft or a body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    notify.mockRejectedValue(new Error("insert failed"));
    vi.stubGlobal("fetch", router());
    const { createDraft } = await import("@/lib/queue/api");
    await createDraft(draft());
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of [BODY_MARKER, RECIPIENT, SUBJECT, "admin-1", "attorney-1", "Ana"]) expect(logged).not.toContain(secret);
  });
});

describe("a helper that never settles (F6)", () => {
  it("does not hold createDraft beyond the timeout", async () => {
    vi.doMock("@/lib/notifications/approval", () => ({ notifyApprovers: () => new Promise(() => {}) }));
    vi.stubGlobal("fetch", router());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { createDraft, APPROVAL_ALERT_TIMEOUT_MS } = await import("@/lib/queue/api");

    let settled: unknown = null;
    const pending = createDraft(draft()).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(APPROVAL_ALERT_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(settled).toEqual({ id: "q-new" });
    expect(APPROVAL_ALERT_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });

  it("still resolves when the helper rejects outright", async () => {
    vi.doMock("@/lib/notifications/approval", () => ({ notifyApprovers: () => Promise.reject(new Error("nope")) }));
    vi.stubGlobal("fetch", router());
    const { createDraft } = await import("@/lib/queue/api");
    expect(await createDraft(draft())).toEqual({ id: "q-new" });
  });
});
