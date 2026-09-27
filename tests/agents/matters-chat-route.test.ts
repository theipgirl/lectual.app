import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/matters-chat — the AI copilot's answer endpoint. Mock-based: both
 * getScopedClient() (auth check) and answerMattersChatQuestion() (the model
 * call) are mocked, so this never touches a DB or a real model — it only
 * verifies the route's own contract (validation, auth gate, error shape).
 */

function mockAuthedUser(user: { id: string } | null) {
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    })),
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
    vi.doMock("@/lib/agents/matters-chat", () => ({ answerMattersChatQuestion: vi.fn() }));
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
    vi.doMock("@/lib/agents/matters-chat", () => ({ answerMattersChatQuestion: vi.fn() }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "" }));
    expect(res.status).toBe(422);
  });

  it("401s when there is no signed-in user, and never calls the model", async () => {
    mockAuthedUser(null);
    const answerMattersChatQuestion = vi.fn();
    vi.doMock("@/lib/agents/matters-chat", () => ({ answerMattersChatQuestion }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    expect(res.status).toBe(401);
    expect(answerMattersChatQuestion).not.toHaveBeenCalled();
  });

  it("200s with the answer + citations for a signed-in user", async () => {
    mockAuthedUser({ id: "u-1" });
    const answerMattersChatQuestion = vi.fn(async (question: string) => ({
      answer: `Answering: ${question}`,
      citations: [{ type: "matter", id: "m-1", label: "TM-2026-0031 — AURELIA", href: "/dashboard/matters/m-1" }],
      declined: false,
    }));
    vi.doMock("@/lib/agents/matters-chat", () => ({ answerMattersChatQuestion }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { answer: string; citations: unknown[]; declined: boolean };
    expect(json.answer).toBe("Answering: what's the status of AURELIA");
    expect(json.citations).toHaveLength(1);
    expect(json.declined).toBe(false);
    expect(answerMattersChatQuestion).toHaveBeenCalledWith("what's the status of AURELIA");
  });

  it("503s when the copilot has no AI provider configured", async () => {
    mockAuthedUser({ id: "u-1" });
    const { AiNotConfiguredError } = await import("@/lib/ai/claude");
    vi.doMock("@/lib/agents/matters-chat", () => ({
      answerMattersChatQuestion: vi.fn(async () => {
        throw new AiNotConfiguredError();
      }),
    }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    expect(res.status).toBe(503);
  });

  it("500s and never leaks the raw error when the model call throws", async () => {
    mockAuthedUser({ id: "u-1" });
    vi.doMock("@/lib/agents/matters-chat", () => ({
      answerMattersChatQuestion: vi.fn(async () => {
        throw new Error("gateway timeout, secret upstream detail");
      }),
    }));
    const { POST } = await import("@/app/api/matters-chat/route");

    const res = await POST(postRequest({ question: "what's the status of AURELIA" }));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).not.toContain("gateway timeout");
  });
});
