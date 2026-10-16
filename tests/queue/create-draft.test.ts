import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * createDraft() is the Document Center's write path onto the approval
 * queue (POST /api/queue, added to lawmatics-mcp alongside this call) — the
 * dashboard-side twin of the Cowork skills' queue_draft MCP tool. Verifies
 * the request shape and that DASHBOARD_API_TOKEN never gets typo'd out of
 * the Authorization header, mirroring how listQueue/resolveQueueItem are
 * implicitly covered by dashboard-queue.test.ts.
 */

function mockEnv(url: string | undefined, token: string | undefined) {
  vi.doMock("@/lib/env", () => ({ env: { QUEUE_API_URL: url, DASHBOARD_API_TOKEN: token } }));
}

describe("createDraft", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the row-contract shape to /api/queue with the bearer token", async () => {
    mockEnv("https://lawmatics-mcp.example.com", "secret-token");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "q-99" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createDraft } = await import("../../src/lib/queue/api");
    const result = await createDraft({
      orgKey: "rpb-law",
      agent: "document-center",
      type: "OPINION_LETTER",
      headline: "Opinion letter DRAFT — Acme — MARKNAME",
      draftBody: "# Acme — Opinion Letter DRAFT — MARKNAME\n\nBody...",
      summary: "Clearance opinion letter draft.",
      matterId: "matter-1",
      clientName: "Acme Co.",
    });

    expect(result).toEqual({ id: "q-99" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://lawmatics-mcp.example.com/api/queue");
    expect(init).toBeDefined();
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({
      org_id: "rpb-law",
      agent: "document-center",
      type: "OPINION_LETTER",
      headline: "Opinion letter DRAFT — Acme — MARKNAME",
      draft_body: "# Acme — Opinion Letter DRAFT — MARKNAME\n\nBody...",
      summary: "Clearance opinion letter draft.",
      matter_id: "matter-1",
      client_name: "Acme Co.",
    });
  });

  it("includes recipient/subject/proposed_send_at only when the caller passes them (CLIENT_EMAIL drafts)", async () => {
    mockEnv("https://lawmatics-mcp.example.com", "secret-token");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "q-100" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const { createDraft } = await import("../../src/lib/queue/api");
    await createDraft({
      orgKey: "rpb-law",
      agent: "filing-followup",
      type: "CLIENT_EMAIL",
      headline: "Monthly Status Update — Month 1 of ~5 — SUNBEAM",
      draftBody: "body",
      matterId: "matter-1",
      clientName: "Jane Doe",
      recipient: "jane@example.com",
      subject: "A quick update on your trademark application",
      proposedSendAt: "2026-08-24T12:00:00.000Z",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      recipient: "jane@example.com",
      subject: "A quick update on your trademark application",
      proposed_send_at: "2026-08-24T12:00:00.000Z",
    });
  });

  it("omits recipient/subject/proposed_send_at entirely when not given, same as summary/matterId today", async () => {
    mockEnv("https://lawmatics-mcp.example.com", "secret-token");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "q-101" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const { createDraft } = await import("../../src/lib/queue/api");
    await createDraft({
      orgKey: "rpb-law",
      agent: "document-center",
      type: "OPINION_LETTER",
      headline: "h",
      draftBody: "b",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body).not.toHaveProperty("recipient");
    expect(body).not.toHaveProperty("subject");
    expect(body).not.toHaveProperty("proposed_send_at");
  });

  it("throws when the queue API isn't configured", async () => {
    mockEnv(undefined, undefined);
    const { createDraft } = await import("../../src/lib/queue/api");
    await expect(
      createDraft({ orgKey: "rpb-law", agent: "a", type: "OPINION_LETTER", headline: "h", draftBody: "b" }),
    ).rejects.toThrow(/not configured/i);
  });

  it("surfaces the server's error detail on a non-2xx response", async () => {
    mockEnv("https://lawmatics-mcp.example.com", "secret-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Expected a JSON body" }), { status: 400 })),
    );

    const { createDraft } = await import("../../src/lib/queue/api");
    await expect(
      createDraft({ orgKey: "rpb-law", agent: "a", type: "OPINION_LETTER", headline: "h", draftBody: "b" }),
    ).rejects.toThrow(/Expected a JSON body/);
  });
});
