import { describe, it, expect } from "vitest";
import {
  decodeEntities,
  fetchNewMessages,
  gmailToThreadMessage,
  parseAddressList,
} from "@/lib/mailbox/fetch";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake fetch that answers by URL substring, recording every call. */
function router(routes: Array<[string | RegExp, (url: string) => Response]>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [match, respond] of routes) {
      if (typeof match === "string" ? url.includes(match) : match.test(url)) return respond(url);
    }
    throw new Error(`unrouted: ${url}`);
  }) as typeof fetch;
  return { impl, calls };
}

describe("address parsing", () => {
  it("handles quoted commas, angle brackets and bare addresses", () => {
    expect(parseAddressList(`"Okafor, Desmond" <Desmond@Example.com>, amara@example.com`)).toEqual([
      { name: "Okafor, Desmond", address: "desmond@example.com" },
      { name: null, address: "amara@example.com" },
    ]);
  });
  it("returns [] for empty headers and nulls the address when there isn't one", () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([{ name: null, address: null }]);
  });
  it("decodes Gmail's escaped snippets", () => {
    expect(decodeEntities("don&#39;t &amp; won&#x27;t &quot;x&quot;")).toBe(`don't & won't "x"`);
  });
});

describe("Gmail mapping", () => {
  const base = {
    id: "m1",
    threadId: "t1",
    internalDate: String(Date.parse("2026-09-20T10:00:00Z")),
    snippet: "Hi &amp; thanks",
    payload: {
      headers: [
        { name: "From", value: "Amara Nwosu <amara@example.com>" },
        { name: "To", value: "intake@firm.example" },
        { name: "Subject", value: "SANKOFA filing" },
      ],
    },
  };
  it("maps an inbox message", () => {
    const m = gmailToThreadMessage({ ...base, labelIds: ["INBOX"] }, "intake@firm.example")!;
    expect(m).toMatchObject({
      id: "gmail:m1",
      conversationId: "t1",
      direction: "inbound",
      folder: "inbox",
      at: "2026-09-20T10:00:00.000Z",
      from: { name: "Amara Nwosu", address: "amara@example.com" },
      subject: "SANKOFA filing",
      preview: "Hi & thanks",
    });
  });
  it("treats SENT as outbound and skips drafts, spam, trash and chats", () => {
    expect(gmailToThreadMessage({ ...base, labelIds: ["SENT"] }, "x@y")!.direction).toBe("outbound");
    for (const l of ["DRAFT", "SPAM", "TRASH", "CHAT"]) {
      expect(gmailToThreadMessage({ ...base, labelIds: [l] }, "x@y")).toBeNull();
    }
  });
});

describe("Gmail fetch", () => {
  const meta = (id: string, labels = ["INBOX"]) =>
    json({ id, threadId: `t-${id}`, labelIds: labels, internalDate: "1758362400000", snippet: "", payload: { headers: [] } });

  it("first sync: takes the history id first, lists the 30-day window, reads metadata only", async () => {
    const { impl, calls } = router([
      ["/profile", () => json({ historyId: "900" })],
      ["/messages?q=", () => json({ messages: [{ id: "a" }, { id: "b" }] })],
      [/\/messages\/(a|b)\?/, (u) => meta(u.includes("/messages/a?") ? "a" : "b")],
    ]);
    const r = await fetchNewMessages("google", { accessToken: "at", mailbox: "me@x.com", cursor: null, fetchImpl: impl });
    expect(r.cursor).toBe("900");
    expect(r.messages.map((m) => m.id)).toEqual(["gmail:a", "gmail:b"]);
    expect(calls[0]).toContain("/profile");
    expect(decodeURIComponent(calls[1])).toContain("newer_than:30d");
    expect(calls.filter((c) => c.includes("/messages/")).every((c) => c.includes("format=metadata"))).toBe(true);
  });

  it("incremental: reads history from the cursor and advances it", async () => {
    const { impl } = router([
      ["/history?", () => json({ history: [{ messagesAdded: [{ message: { id: "c" } }, { message: { id: "c" } }] }], historyId: "950" })],
      ["/messages/c?", () => meta("c", ["SENT"])],
    ]);
    const r = await fetchNewMessages("google", { accessToken: "at", mailbox: "me@x.com", cursor: "900", fetchImpl: impl });
    expect(r.cursor).toBe("950");
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].direction).toBe("outbound");
    expect(r.restarted).toBe(false);
  });

  it("restarts the window when Google has expired the history id", async () => {
    const { impl } = router([
      ["/history?", () => json({ error: { code: 404 } }, 404)],
      ["/profile", () => json({ historyId: "1200" })],
      ["/messages?q=", () => json({})],
    ]);
    const r = await fetchNewMessages("google", { accessToken: "at", mailbox: "me@x.com", cursor: "1", fetchImpl: impl });
    expect(r).toMatchObject({ restarted: true, cursor: "1200", messages: [] });
  });

  it("turns a 401 into a reconnect, not a silent failure", async () => {
    const { impl } = router([["/profile", () => json({}, 401)]]);
    await expect(fetchNewMessages("google", { accessToken: "at", mailbox: "me@x.com", cursor: null, fetchImpl: impl })).rejects.toMatchObject({ code: "reauth" });
  });
});

describe("Outlook (Graph delta) fetch", () => {
  const msg = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    conversationId: `c-${id}`,
    subject: "VELA",
    bodyPreview: "Hello",
    from: { emailAddress: { name: "Client", address: "Client@Example.com" } },
    toRecipients: [{ emailAddress: { address: "intake@firm.example" } }],
    receivedDateTime: "2026-09-20T10:00:00Z",
    sentDateTime: "2026-09-20T09:59:00Z",
    webLink: `https://outlook.office.com/${id}`,
    ...extra,
  });

  it("walks both folders to their delta links and stores both", async () => {
    const { impl, calls } = router([
      ["/inbox/messages/delta?$select", () => json({ value: [msg("i1"), msg("gone", { "@removed": { reason: "deleted" } }), msg("d", { isDraft: true })], "@odata.nextLink": "https://graph.microsoft.com/inbox-page2" })],
      ["inbox-page2", () => json({ value: [msg("i2")], "@odata.deltaLink": "https://graph.microsoft.com/inbox-delta" })],
      ["/sentitems/messages/delta", () => json({ value: [msg("s1")], "@odata.deltaLink": "https://graph.microsoft.com/sent-delta" })],
    ]);
    const r = await fetchNewMessages("microsoft", { accessToken: "at", mailbox: "intake@firm.example", cursor: null, fetchImpl: impl, now: Date.parse("2026-09-25T00:00:00Z") });
    expect(r.messages.map((m) => `${m.id}:${m.direction}`)).toEqual(["graph:i1:inbound", "graph:i2:inbound", "graph:s1:outbound"]);
    expect(r.messages[2].at).toBe("2026-09-20T09:59:00Z");
    expect(r.messages[0].from.address).toBe("client@example.com");
    expect(JSON.parse(r.cursor)).toEqual({ inbox: "https://graph.microsoft.com/inbox-delta", sentitems: "https://graph.microsoft.com/sent-delta" });
    expect(decodeURIComponent(calls[0])).toContain("receivedDateTime ge 2026-08-26");
  });

  it("stops at the cap and resumes from the next page, skipping nothing", async () => {
    const page = (n: number) => json({ value: Array.from({ length: 3 }, (_, i) => msg(`p${n}-${i}`)), "@odata.nextLink": `https://graph.microsoft.com/next-${n + 1}` });
    const { impl } = router([
      ["/inbox/messages/delta?$select", () => page(1)],
      [/next-\d/, (u) => page(Number(u.slice(-1)))],
      ["/sentitems/messages/delta", () => json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/sent-delta" })],
    ]);
    const r = await fetchNewMessages("microsoft", { accessToken: "at", mailbox: "x@y", cursor: null, fetchImpl: impl, maxMessages: 8 });
    expect(r.truncated).toBe(true);
    expect(JSON.parse(r.cursor).inbox).toMatch(/^https:\/\/graph\.microsoft\.com\/next-\d$/);
  });

  it("restarts a folder whose stored delta link has expired (410)", async () => {
    const { impl } = router([
      ["inbox-old", () => json({ error: "syncStateNotFound" }, 410)],
      ["/inbox/messages/delta?$select", () => json({ value: [msg("fresh")], "@odata.deltaLink": "https://graph.microsoft.com/inbox-new" })],
      ["sent-old", () => json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/sent-old" })],
    ]);
    const cursor = JSON.stringify({ inbox: "https://graph.microsoft.com/inbox-old", sentitems: "https://graph.microsoft.com/sent-old" });
    const r = await fetchNewMessages("microsoft", { accessToken: "at", mailbox: "x@y", cursor, fetchImpl: impl });
    expect(r.restarted).toBe(true);
    expect(JSON.parse(r.cursor).inbox).toBe("https://graph.microsoft.com/inbox-new");
  });

  it("never sends the bearer token to a stored link that isn't Graph", async () => {
    const { impl, calls } = router([
      ["/messages/delta?$select", () => json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/d" })],
    ]);
    const cursor = JSON.stringify({ inbox: "https://evil.example/steal", sentitems: "https://graph.microsoft.com/messages/delta?$select=x" });
    await fetchNewMessages("microsoft", { accessToken: "at", mailbox: "x@y", cursor, fetchImpl: impl });
    expect(calls.some((c) => c.includes("evil.example"))).toBe(false);
  });
});
