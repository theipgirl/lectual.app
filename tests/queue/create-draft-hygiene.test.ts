import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * createDraft is the one choke point every agent, document, campaign, welcome,
 * prep, follow-up and consult-proposal draft passes through, so hygiene
 * (clean, sign-off, near-duplicate) lives there.
 */

const NOW = new Date("2026-10-20T12:00:00Z");
const ORG = "rpb-law";
const SIGN = "Rebecca P. Beliard, Esq.";

type Row = { id: string; type: string; recipient: string | null; client_name: string | null; created_at: string; draft_body: string; final_body: string | null };

function mockEnv() {
  vi.doMock("@/lib/env", () => ({ env: { QUEUE_API_URL: "https://lawmatics-mcp.example.com", DASHBOARD_API_TOKEN: "secret-token" } }));
}

/** Routes by method: GET answers the pending list, POST answers the new id. */
function router(list: () => Response | Promise<Response>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "q-new" }), { status: 201 });
    return list();
  });
}

const listOf = (rows: Partial<Row>[]) => () => new Response(JSON.stringify({ rows }), { status: 200 });
const posts = (f: ReturnType<typeof router>) => f.mock.calls.filter(([, init]) => init?.method === "POST");
const posted = (f: ReturnType<typeof router>) => JSON.parse(posts(f)[0][1]!.body as string) as Record<string, string>;

const EMAIL_BODY = "Hi Ana,\n\nThanks for the call today. We will file the application on Monday and send you the receipt.\n\nBest,\nRebecca P. Beliard, Esq.";
const email = (over: Record<string, unknown> = {}) => ({
  orgKey: ORG,
  agent: "post-consult",
  type: "CLIENT_EMAIL",
  headline: "Follow up with Ana",
  draftBody: EMAIL_BODY,
  clientName: "Ana Ruiz",
  recipient: "ana@example.com",
  signOff: SIGN,
  ...over,
});

describe("createDraft hygiene (H5)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mockEnv();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("posts a cleaned body and records what it moved in the summary, after the existing summary", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    const dirty = "⚠️ DRAFT — FOR ATTORNEY REVIEW. NOT SENT.\nHi Ana,\nHard Rule 2: never quote fees.\nThanks for your time [confirm client email before sending].\nBest,\nRebecca P. Beliard, Esq.";
    const result = await createDraft(email({ draftBody: dirty, summary: "Two sentences for the reviewer." }));
    expect(result).toEqual({ id: "q-new" });
    const body = posted(fetchMock);
    expect(body.draft_body).toBe("Hi Ana,\nThanks for your time.\nBest,\nRebecca P. Beliard, Esq.");
    expect(body.summary.startsWith("Two sentences for the reviewer.")).toBe(true);
    expect(body.summary).toContain("Moved out of the draft:");
    expect(body.summary).toContain("NOT SENT");
    expect(body.summary).toContain("Hard Rule 2: never quote fees.");
    expect(body.summary).toContain("[confirm client email before sending]");
  });

  it("a clean draft with nothing pending posts a body identical to its input and adds no summary", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    await createDraft(email());
    const body = posted(fetchMock);
    expect(body.draft_body).toBe(EMAIL_BODY);
    expect(body).not.toHaveProperty("summary");
  });

  it("lists pending items for the call's own org, as a GET", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    await createDraft(email({ orgKey: "cabanis law" }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://lawmatics-mcp.example.com/api/queue?status=pending&org_id=cabanis%20law");
    expect(init?.method).toBeUndefined();
    expect(String(url)).not.toContain(ORG);
  });

  it("returns the existing id with deduped: true, and makes no POST, for a near-duplicate from 3 minutes ago", async () => {
    const earlier = new Date(NOW.getTime() - 3 * 60_000).toISOString();
    const fetchMock = router(listOf([{ id: "q-existing", type: "CLIENT_EMAIL", recipient: "ana@example.com", client_name: "Ana Ruiz", created_at: earlier, draft_body: EMAIL_BODY, final_body: null }]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    expect(await createDraft(email())).toEqual({ id: "q-existing", deduped: true });
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("compares the cleaned body, so a banner doesn't hide a duplicate", async () => {
    const earlier = new Date(NOW.getTime() - 3 * 60_000).toISOString();
    const fetchMock = router(listOf([{ id: "q-existing", type: "CLIENT_EMAIL", recipient: "ana@example.com", client_name: "Ana Ruiz", created_at: earlier, draft_body: EMAIL_BODY, final_body: null }]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    const result = await createDraft(email({ draftBody: `NOT SENT\n\n${EMAIL_BODY}` }));
    expect(result).toEqual({ id: "q-existing", deduped: true });
  });

  it.each([
    ["an older one", { created_at: new Date(NOW.getTime() - 45 * 60_000).toISOString() }],
    ["another recipient", { recipient: "bo@example.com" }],
    ["a different type", { type: "OPINION_LETTER" }],
    ["a different body", { draft_body: "Something else entirely, about a different matter and a different plan for next week." }],
  ])("still posts when the pending one is %s", async (_name, over) => {
    const row = { id: "q-existing", type: "CLIENT_EMAIL", recipient: "ana@example.com", client_name: "Ana Ruiz", created_at: new Date(NOW.getTime() - 3 * 60_000).toISOString(), draft_body: EMAIL_BODY, final_body: null, ...over };
    const fetchMock = router(listOf([row]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    expect(await createDraft(email())).toEqual({ id: "q-new" });
    expect(posts(fetchMock)).toHaveLength(1);
  });

  it("creates the draft anyway when the pending list rejects, and logs without the body or recipient", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "q-new" }), { status: 201 });
      throw new Error("connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    expect(await createDraft(email())).toEqual({ id: "q-new" });
    expect(posts(fetchMock as never)).toHaveLength(1);
    expect(errors).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toContain("[queue]");
    expect(logged).not.toContain("ana@example.com");
    expect(logged).not.toContain("Thanks for the call");
    expect(logged).not.toContain("Ana");
  });

  it("creates the draft anyway when the list answers with an error status, or with a non-list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const list of [() => new Response("{}", { status: 500 }), () => new Response(JSON.stringify({ id: "q-9" }), { status: 200 }), () => new Response(JSON.stringify({ rows: "nope" }), { status: 200 })]) {
      vi.resetModules();
      mockEnv();
      const fetchMock = router(list);
      vi.stubGlobal("fetch", fetchMock);
      const { createDraft } = await import("../../src/lib/queue/api");
      expect(await createDraft(email())).toEqual({ id: "q-new" });
      expect(posts(fetchMock)).toHaveLength(1);
    }
  });

  it("keeps a Document Center draft's [confirm …] markers and its DRAFT title", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    const letter = "# Acme — Opinion Letter DRAFT — MARKNAME\n\nClass(es): [confirm from the report]\n\nBest,\nDawn";
    await createDraft({ orgKey: ORG, agent: "document-center", type: "OPINION_LETTER", headline: "Opinion letter DRAFT", draftBody: letter, signOff: SIGN });
    const body = posted(fetchMock);
    expect(body.draft_body).toBe(letter);
    expect(body).not.toHaveProperty("summary");
  });

  it("still removes a banner from a non-email draft", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    await createDraft({ orgKey: ORG, agent: "document-center", type: "OPINION_LETTER", headline: "h", draftBody: "NOT SENT\n\n# Letter\n\nClass: [confirm from the report]" });
    const body = posted(fetchMock);
    expect(body.draft_body).toBe("# Letter\n\nClass: [confirm from the report]");
    expect(body.summary).toContain("NOT SENT");
  });

  it("replaces another staff member's signature with the configured sign-off, and records it", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    await createDraft(email({ draftBody: "Hi Ana,\n\nThanks for the call.\n\nBest,\nDawn" }));
    const body = posted(fetchMock);
    expect(body.draft_body).toBe(`Hi Ana,\n\nThanks for the call.\n\nBest,\n${SIGN}`);
    expect(body.summary).toContain("Sign-off replaced");
    expect(body.summary).toContain("Dawn");
  });

  it("accepts the team sign-off as written", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    const text = "Hi Ana,\n\nYour proposal is ready.\n\nBest,\nThe RPB Law Team";
    await createDraft(email({ draftBody: text, signOff: undefined, teamSignOff: "The RPB Law Team" }));
    const body = posted(fetchMock);
    expect(body.draft_body).toBe(text);
    expect(body).not.toHaveProperty("summary");
  });

  it("with no signOff and no teamSignOff, an unverifiable closing is left alone and the reviewer is flagged", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    const text = "Hi Ana,\n\nThanks.\n\nBest,\nDawn";
    await createDraft(email({ draftBody: text, signOff: undefined }));
    const body = posted(fetchMock);
    expect(body.draft_body).toBe(text);
    expect(body.summary).toContain("Sign-off not checked");
  });

  it("does not check sign-offs on a draft that isn't a client email", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    const text = "Internal heads-up.\n\nBest,\nDawn";
    await createDraft({ orgKey: ORG, agent: "prep-consult", type: "INTERNAL_NOTE", headline: "h", draftBody: text, signOff: SIGN });
    expect(posted(fetchMock).draft_body).toBe(text);
  });

  it("keeps sending the other fields exactly as before", async () => {
    const fetchMock = router(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createDraft } = await import("../../src/lib/queue/api");
    await createDraft(email({ matterId: "m-1", subject: "Next steps", proposedSendAt: "2026-10-21T12:00:00.000Z" }));
    expect(posted(fetchMock)).toMatchObject({
      org_id: ORG,
      agent: "post-consult",
      type: "CLIENT_EMAIL",
      headline: "Follow up with Ana",
      matter_id: "m-1",
      client_name: "Ana Ruiz",
      recipient: "ana@example.com",
      subject: "Next steps",
      proposed_send_at: "2026-10-21T12:00:00.000Z",
    });
    expect(posted(fetchMock)).not.toHaveProperty("signOff");
    expect(posted(fetchMock)).not.toHaveProperty("sign_off");
  });
});
