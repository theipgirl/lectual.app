import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/matters-chat — the AI copilot's answer endpoint. Mock-based: both
 * resolveFirmSession() (access check) and streamMattersChatQuestion() (the model
 * call) are mocked, so this never touches a DB or a real model — it only
 * verifies the route's own contract (validation, auth gate, error shape, and
 * that an answer goes out as a server-sent-event stream). The streaming itself
 * is covered against a mocked SDK in tests/copilot/stream-route.test.ts.
 */

/** Configured AI, so the route gets as far as opening a stream. */
function mockAi(configured = true) {
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => configured }));
}

function mockAuthedUser(user: { id: string } | null, kind: "ok" | "no-access" = "ok") {
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () =>
      !user ? { kind: "signed-out", redirectTo: "/sign-in/" } : { kind, user, org: { id: "org-1" } },
    ),
  }));
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/matters-chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/matters-chat", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("400s on invalid JSON", async () => {
    mockAuthedUser({ id: "u-1" });
    vi.doMock("@/lib/agents/matters-chat", () => ({ streamMattersChatQuestion: vi.fn() }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const req = new NextRequest("http://localhost/api/matters-chat", {
      method: "POST",
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("422s when the question is missing or empty", async () => {
    mockAuthedUser({ id: "u-1" });
    vi.doMock("@/lib/agents/matters-chat", () => ({ streamMattersChatQuestion: vi.fn() }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "" }));
    expect(res.status).toBe(422);
  });

  it("401s when there is no signed-in user, and never calls the model", async () => {
    mockAuthedUser(null);
    const streamMattersChatQuestion = vi.fn();
    vi.doMock("@/lib/agents/matters-chat", () => ({ streamMattersChatQuestion }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    expect(res.status).toBe(401);
    expect(streamMattersChatQuestion).not.toHaveBeenCalled();
  });

  it("403s for a signed-in account with no firm workspace, and never calls the model", async () => {
    mockAuthedUser({ id: "u-1" }, "no-access");
    const streamMattersChatQuestion = vi.fn();
    vi.doMock("@/lib/agents/matters-chat", () => ({ streamMattersChatQuestion }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    expect(res.status).toBe(403);
    expect(streamMattersChatQuestion).not.toHaveBeenCalled();
  });

  it("streams the answer + citations as server-sent events for a signed-in user", async () => {
    mockAuthedUser({ id: "u-1" });
    mockAi();
    const result = {
      answer: "Answering: what's the status of AURELIA",
      citations: [{ type: "matter", id: "m-1", label: "TM-2026-0031 — AURELIA", href: "/dashboard/matters/m-1" }],
      declined: false,
      readFailed: false,
    };
    const streamMattersChatQuestion = vi.fn(async (opts: { onEvent: (ev: { type: "delta"; text: string }) => void }) => {
      opts.onEvent({ type: "delta", text: "Answering" });
      return result;
    });
    vi.doMock("@/lib/agents/matters-chat", () => ({ streamMattersChatQuestion }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('event: delta\ndata: {"text":"Answering"}');
    expect(text).toContain("event: final");
    const final = JSON.parse(text.split("event: final\ndata: ")[1].split("\n")[0]) as typeof result;
    expect(final).toEqual(result);
    expect(streamMattersChatQuestion).toHaveBeenCalledWith(expect.objectContaining({ question: "what's the status of AURELIA", orgId: expect.any(String) }));
  });

  it("503s as JSON when the copilot has no AI provider configured, before any stream opens", async () => {
    mockAuthedUser({ id: "u-1" });
    mockAi(false);
    const streamMattersChatQuestion = vi.fn();
    vi.doMock("@/lib/agents/matters-chat", () => ({ streamMattersChatQuestion }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(streamMattersChatQuestion).not.toHaveBeenCalled();
  });

  it("ends the stream with an `error` event and never leaks the raw error when the model call throws", async () => {
    mockAuthedUser({ id: "u-1" });
    mockAi();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/lib/agents/matters-chat", () => ({
      streamMattersChatQuestion: vi.fn(async () => {
        throw new Error("gateway timeout, secret upstream detail");
      }),
    }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).not.toContain("gateway timeout");
    expect(text).not.toContain("secret upstream detail");
    expect(text).not.toContain("event: final");
  });
});
