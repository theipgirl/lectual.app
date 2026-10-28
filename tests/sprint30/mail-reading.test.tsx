import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { fetchLiveInbox, fetchMessageToRead, LIVE_MESSAGE_ID, type MessageToRead } from "@/lib/mailbox/fetch";
import {
  loadLiveInbox,
  loadLiveMessage,
  loadStoredMessage,
  type MailReadDeps,
  type ReadableMailbox,
  type ReadState,
} from "@/lib/mailbox/read-message";
import { ProviderError } from "@/lib/mailbox/providers";
import { MailReadingPane } from "@/components/mailbox/MailReadingPane";
import { LiveInboxList } from "@/components/mailbox/LiveInboxList";

process.env.__NEXT_TRAILING_SLASH = "true";

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");
const BOX = "11111111-1111-4111-8111-111111111111";
const OTHER_BOX = "22222222-2222-4222-8222-222222222222";
const ACT = "33333333-3333-4333-8333-333333333333";
const SENTINEL = "SENTINEL-BODY-never-logged-or-stored";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ── the provider calls ───────────────────────────────────────────────────────

describe("fetchMessageToRead", () => {
  it("Graph: asks for a text body, maps the headers, and encodes the id", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, {
        subject: "Re: Your trademark",
        from: { emailAddress: { name: "Amara Nwosu", address: "Amara@Example.com" } },
        toRecipients: [{ emailAddress: { address: "rebecca@firm.example" } }],
        ccRecipients: [],
        receivedDateTime: "2026-10-26T15:00:00Z",
        body: { contentType: "text", content: "Hello,\nSee https://example.com/x\n<script>x</script> <b>bold</b>" },
      }),
    );
    const msg = await fetchMessageToRead("microsoft", { accessToken: "tok", messageId: "graph:AAMk-abc_123=", fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/me/messages/AAMk-abc_123%3D?");
    expect((init.headers as Record<string, string>).prefer).toBe('outlook.body-content-type="text"');
    expect(msg).toMatchObject({ subject: "Re: Your trademark", from: "Amara Nwosu <amara@example.com>", to: ["rebecca@firm.example"], cc: [], at: "2026-10-26T15:00:00Z" });
    expect(msg?.body).toContain("<script>x</script>");
  });

  it("Graph: an HTML body is converted to text with scripts dropped", async () => {
    const fetchImpl = vi.fn(async () => json(200, { subject: "s", body: { contentType: "html", content: "<p>Hi</p><script>evil()</script><p>there</p>" } }));
    const msg = await fetchMessageToRead("microsoft", { accessToken: "t", messageId: "abc", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(msg?.body).not.toContain("evil");
    expect(msg?.body).toContain("Hi");
  });

  it("Gmail: reads the plain part and the headers", async () => {
    const data = Buffer.from("Plain words", "utf8").toString("base64url");
    const fetchImpl = vi.fn(async () =>
      json(200, {
        id: "g1",
        labelIds: ["INBOX"],
        internalDate: String(Date.parse("2026-10-26T15:00:00Z")),
        payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "Amara <a@example.com>" }, { name: "To", value: "r@firm.example" }, { name: "Cc", value: "x@firm.example" }, { name: "Subject", value: "Hi" }], parts: [{ mimeType: "text/plain", body: { data } }] },
      }),
    );
    const msg = await fetchMessageToRead("google", { accessToken: "t", messageId: "gmail:abc123", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(msg).toMatchObject({ from: "Amara <a@example.com>", to: ["r@firm.example"], cc: ["x@firm.example"], subject: "Hi", body: "Plain words" });
  });

  it("returns null with no request for an unsafe id, and null for a 404", async () => {
    const fetchImpl = vi.fn(async () => json(404, {}));
    for (const id of ["a/b", "a b", "..", "a?x=1", "a#b", ""]) {
      expect(await fetchMessageToRead("microsoft", { accessToken: "t", messageId: id, fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fetchMessageToRead("microsoft", { accessToken: "t", messageId: "ok", fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a 401 is a reauth ProviderError", async () => {
    await expect(fetchMessageToRead("microsoft", { accessToken: "t", messageId: "ok", fetchImpl: (async () => json(401, {})) as unknown as typeof fetch })).rejects.toMatchObject({ code: "reauth" });
  });

  it("LIVE_MESSAGE_ID rejects slash, dots, whitespace and query characters", () => {
    for (const bad of ["a/b", "a.b", "..", "a b", "a\tb", "a?b", "a&b", "a%2Fb", "", "a".repeat(513)]) expect(LIVE_MESSAGE_ID.test(bad), bad).toBe(false);
    for (const good of ["AAMkAGI2-abc_123=", "18f3a9c0d1e2f3a4", "a+b"]) expect(LIVE_MESSAGE_ID.test(good), good).toBe(true);
  });
});

describe("fetchLiveInbox", () => {
  it("Graph: $top=50, newest first, nothing else", async () => {
    const fetchImpl = vi.fn(async () => json(200, { value: [{ id: "m1", subject: "S", bodyPreview: "p", from: { emailAddress: { address: "a@x.com" } }, receivedDateTime: "2026-10-26T10:00:00Z" }] }));
    const res = await fetchLiveInbox("microsoft", { accessToken: "t", mailbox: "r@firm.example", fetchImpl: fetchImpl as unknown as typeof fetch });
    const url = decodeURIComponent((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url).toContain("/inbox/messages");
    expect(url).toContain("$top=50");
    expect(url).toContain("$orderby=receivedDateTime desc");
    expect(res.messages.map((m) => m.id)).toEqual(["graph:m1"]);
  });

  it("Gmail: maxResults=50 on the INBOX label, then metadata per message", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("/messages?")
        ? json(200, { messages: [{ id: "g1" }] })
        : json(200, { id: "g1", labelIds: ["INBOX"], snippet: "snip", internalDate: String(Date.parse("2026-10-26T10:00:00Z")), payload: { headers: [{ name: "From", value: "A <a@x.com>" }, { name: "Subject", value: "S" }] } }),
    );
    const res = await fetchLiveInbox("google", { accessToken: "t", mailbox: "r@gmail.com", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(String((fetchImpl.mock.calls[0] as unknown as [string])[0])).toMatch(/labelIds=INBOX&maxResults=50/);
    expect(res.messages).toHaveLength(1);
  });
});

// ── access rules ─────────────────────────────────────────────────────────────

function message(over: Partial<MessageToRead> = {}): MessageToRead {
  return { from: "Amara <a@example.com>", to: ["r@firm.example"], cc: [], at: "2026-10-26T15:00:00Z", subject: "Hello", body: "Body text", ...over };
}

function fakeDeps(over: Partial<MailReadDeps> & { rows?: Record<string, { id: string; type: string; payload: unknown }>; boxes?: ReadableMailbox[] } = {}) {
  const fetchMessage = vi.fn(async () => message());
  const fetchInbox = vi.fn(async () => ({ messages: [], truncated: false }));
  const token = vi.fn(async () => "tok");
  const boxes: ReadableMailbox[] = over.boxes ?? [{ id: BOX, email: "r@firm.example", provider: "microsoft", accessToken: token }];
  const deps: MailReadDeps = {
    readActivity: async (id) => ({ ok: true, row: over.rows?.[id] ?? null }),
    mailboxes: async () => ({ ok: true, items: boxes }),
    fetchMessage,
    fetchInbox,
    tagsFor: async () => new Map(),
    ...over,
  };
  return { deps, fetchMessage, fetchInbox, token };
}

const row = (payload: Record<string, unknown> = {}, type = "email_received") => ({
  [ACT]: { id: ACT, type, payload: { source: "mailbox-sync", connection_id: BOX, message_id: "graph:STORED-ID", web_link: "https://outlook.office.com/mail/x", ...payload } },
});

describe("stored path: ?m=<activity id>", () => {
  it("a non-uuid id is 'no longer available' with zero fetches and zero reads", async () => {
    const readActivity = vi.fn();
    const { deps, fetchMessage } = fakeDeps({ readActivity });
    for (const bad of ["abc", "../../etc", undefined, "", `${ACT}x`]) expect(await loadStoredMessage(bad, deps)).toEqual({ status: "not-available" });
    expect(readActivity).not.toHaveBeenCalled();
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  it("reads the stored row, then fetches only the row's stored message id through the row's connection", async () => {
    const { deps, fetchMessage, token } = fakeDeps({ rows: row() });
    const res = await loadStoredMessage(ACT, deps);
    expect(res).toMatchObject({ status: "ok", mailbox: "r@firm.example", provider: "microsoft", openUrl: "https://outlook.office.com/mail/x" });
    expect(token).toHaveBeenCalledTimes(1);
    expect(fetchMessage).toHaveBeenCalledTimes(1);
    expect(fetchMessage).toHaveBeenCalledWith("microsoft", { accessToken: "tok", messageId: "graph:STORED-ID" });
  });

  it.each([
    ["a missing row", {}],
    ["a non-mail activity type", row({}, "stage_changed")],
    ["a row naming no connection", row({ connection_id: undefined })],
    ["a row naming no message", row({ message_id: undefined })],
    ["a connection the person cannot see (another person's personal mailbox or another firm)", row({ connection_id: OTHER_BOX })],
  ])("%s: 'no longer available' and zero fetches", async (_n, rows) => {
    const { deps, fetchMessage, token } = fakeDeps({ rows: rows as never });
    expect(await loadStoredMessage(ACT, deps)).toEqual({ status: "not-available" });
    expect(fetchMessage).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });

  it("a hostile id in the URL's other params changes nothing: only the stored id is fetched", async () => {
    const { deps, fetchMessage } = fakeDeps({ rows: row() });
    // loadStoredMessage takes no other URL value at all; the live params are ignored when `m` is the pane.
    await loadStoredMessage(ACT, deps);
    expect(JSON.stringify(fetchMessage.mock.calls)).toContain("STORED-ID");
    expect(JSON.stringify(fetchMessage.mock.calls)).not.toContain("..");
  });

  it("unreadable row or mailbox lists are 'failed', never 'not available'", async () => {
    expect(await loadStoredMessage(ACT, fakeDeps({ readActivity: async () => ({ ok: false }) }).deps)).toEqual({ status: "failed" });
    expect(await loadStoredMessage(ACT, fakeDeps({ rows: row(), mailboxes: async () => ({ ok: false }) }).deps)).toEqual({ status: "failed" });
    expect(await loadStoredMessage(ACT, fakeDeps({ readActivity: async () => Promise.reject(new Error("x")) }).deps)).toEqual({ status: "failed" });
  });

  it("states: gone (404), reauth (token/scope), failed", async () => {
    expect(await loadStoredMessage(ACT, fakeDeps({ rows: row(), fetchMessage: async () => null }).deps)).toEqual({ status: "gone" });
    expect(await loadStoredMessage(ACT, fakeDeps({ rows: row(), fetchMessage: async () => Promise.reject(new ProviderError("x", "reauth")) }).deps)).toEqual({ status: "reauth" });
    expect(await loadStoredMessage(ACT, fakeDeps({ rows: row(), fetchMessage: async () => Promise.reject(new Error("net")) }).deps)).toEqual({ status: "failed" });
    const t = fakeDeps({ rows: row(), boxes: [{ id: BOX, email: "r@firm.example", provider: "microsoft", accessToken: async () => Promise.reject(new ProviderError("x", "reauth")) }] });
    expect(await loadStoredMessage(ACT, t.deps)).toEqual({ status: "reauth" });
  });
});

describe("live path: ?box=<connection id>&live=<provider message id>", () => {
  it("a valid pair calls the fetcher exactly once, with that connection's token and the id", async () => {
    const { deps, fetchMessage } = fakeDeps();
    const res = await loadLiveMessage(BOX, "AAMk-1_2=", deps);
    expect(res.status).toBe("ok");
    expect(fetchMessage).toHaveBeenCalledTimes(1);
    expect(fetchMessage).toHaveBeenCalledWith("microsoft", { accessToken: "tok", messageId: "AAMk-1_2=" });
  });

  it("a foreign or unlisted connection id gives zero fetches", async () => {
    const { deps, fetchMessage, token } = fakeDeps();
    expect(await loadLiveMessage(OTHER_BOX, "abc", deps)).toEqual({ status: "not-available" });
    expect(await loadLiveMessage("not-a-uuid", "abc", deps)).toEqual({ status: "not-available" });
    expect(await loadLiveMessage(undefined, "abc", deps)).toEqual({ status: "not-available" });
    expect(fetchMessage).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });

  it.each(["a/b", "a?x=1", "..", "a b", "a\nb", "a.b", "", undefined])("a message id %j gives zero fetches", async (bad) => {
    const { deps, fetchMessage } = fakeDeps();
    expect(await loadLiveMessage(BOX, bad, deps)).toEqual({ status: "not-available" });
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  it("needs no stored activity row: the visible connection is the authority", async () => {
    const readActivity = vi.fn();
    const { deps } = fakeDeps({ readActivity });
    expect((await loadLiveMessage(BOX, "abc", deps)).status).toBe("ok");
    expect(readActivity).not.toHaveBeenCalled();
  });

  it("the page gives `m` priority over `live`", () => {
    const page = fs.readFileSync("src/app/dashboard/mail/page.tsx", "utf8");
    expect(page).toMatch(/m \? loadStoredMessage\(m, liveMailReadDeps\) : live \? loadLiveMessage\(box, live, liveMailReadDeps\)/);
  });
});

describe("live Inbox", () => {
  const tm = (id: string, at: string, subject = "S") => ({ id, conversationId: null, mailbox: "r@firm.example", folder: "inbox" as const, direction: "inbound" as const, at, from: { name: "Amara", address: "a@x.com" }, to: [], cc: [], subject, preview: "preview words", webLink: null });

  it("lists the messages newest first with the provider ids, and carries client tags for matched ones", async () => {
    const fetchInbox = vi.fn(async () => ({ messages: [tm("graph:old", "2026-10-20T10:00:00Z"), tm("graph:new", "2026-10-26T10:00:00Z")], truncated: false }));
    const { deps } = fakeDeps({ fetchInbox, tagsFor: async () => new Map([["graph:new", { label: "Amara Nwosu", href: "/dashboard/leads/l1/" }]]) });
    const state = await loadLiveInbox(undefined, deps);
    expect(state.status).toBe("ok");
    if (state.status !== "ok") return;
    expect(state.rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(state.rows[0].client?.label).toBe("Amara Nwosu");
    expect(state.rows[1].client).toBeNull();
    expect(fetchInbox).toHaveBeenCalledWith("microsoft", { accessToken: "tok", mailbox: "r@firm.example" });
  });

  it("an unlisted box is 'not available' with no read; failures are their own sentences, never an empty list", async () => {
    const a = fakeDeps();
    expect(await loadLiveInbox(OTHER_BOX, a.deps)).toEqual({ status: "not-available" });
    expect(a.fetchInbox).not.toHaveBeenCalled();
    expect(await loadLiveInbox(undefined, fakeDeps({ boxes: [] }).deps)).toEqual({ status: "no-mailbox" });
    expect(await loadLiveInbox(undefined, fakeDeps({ fetchInbox: async () => Promise.reject(new Error("x")) }).deps)).toEqual({ status: "failed" });
    expect(await loadLiveInbox(undefined, fakeDeps({ fetchInbox: async () => Promise.reject(new ProviderError("x", "reauth")) }).deps)).toEqual({ status: "reauth" });
    expect(await loadLiveInbox(undefined, fakeDeps({ mailboxes: async () => ({ ok: false }) }).deps)).toEqual({ status: "failed" });
  });

  it("a tag lookup that fails still lists the messages", async () => {
    const { deps } = fakeDeps({ fetchInbox: async () => ({ messages: [tm("graph:a", "2026-10-26T10:00:00Z")], truncated: false }), tagsFor: async () => Promise.reject(new Error("x")) });
    const state = await loadLiveInbox(undefined, deps);
    expect(state.status === "ok" && state.rows.length).toBe(1);
  });

  it("renders subject, from, date, preview, the tag, and a link that opens the pane via box + live", async () => {
    const fetchInbox = vi.fn(async () => ({ messages: [tm("graph:new", "2026-10-26T10:00:00Z", "Quarterly question")], truncated: false }));
    const { deps } = fakeDeps({ fetchInbox, tagsFor: async () => new Map([["graph:new", { label: "Amara Nwosu", href: "/dashboard/leads/l1/" }]]) });
    const state = await loadLiveInbox(undefined, deps);
    const html = text(renderToStaticMarkup(<LiveInboxList state={state} now={new Date("2026-10-27T12:00:00Z")} openHref={(id) => `/dashboard/mail/?tab=inbox&box=${BOX}&live=${id}`} />));
    expect(html).toContain("Quarterly question");
    expect(html).toContain("Amara");
    expect(html).toContain("preview words");
    expect(html).toContain("Amara Nwosu");
    expect(html).toContain(`href="/dashboard/mail/?tab=inbox&amp;box=${BOX}&amp;live=new"`);
  });

  it("a failed read renders its sentence, not an empty list", async () => {
    const html = text(renderToStaticMarkup(<LiveInboxList state={{ status: "failed" }} now={new Date()} openHref={() => ""} />));
    expect(html).toContain("The inbox couldn't be read");
    expect(html).not.toContain("is empty");
  });
});

// ── the pane ─────────────────────────────────────────────────────────────────

const ok = (m: Partial<MessageToRead> = {}, openUrl: string | null = "https://outlook.office.com/mail/x"): ReadState => ({ status: "ok", message: message(m), mailbox: "r@firm.example", provider: "microsoft", openUrl });
const pane = (state: ReadState) => text(renderToStaticMarkup(<MailReadingPane state={state} backHref="/dashboard/mail/?box=b" />));

describe("reading pane", () => {
  it("shows From, To, Cc (omitted when empty), date, subject and a Back link, and the Outlook link stays secondary", () => {
    const withCc = pane(ok({ cc: ["c@firm.example"], subject: "Subject line" }));
    expect(withCc).toContain("Subject line");
    expect(withCc).toContain("<dt>From</dt>");
    expect(withCc).toContain("<dt>To</dt>");
    expect(withCc).toContain("<dt>Cc</dt>");
    expect(withCc).toContain("<dt>Date</dt>");
    expect(withCc).toContain('href="/dashboard/mail/?box=b"');
    expect(withCc).toContain("Open in Outlook");
    expect(pane(ok())).not.toContain("<dt>Cc</dt>");
  });

  it("the body is text in a <pre>: tags are escaped and links are not anchors", () => {
    const html = pane(ok({ body: "See https://example.com/a?b=1 now\n<script>alert(1)</script> and <b>bold</b>" }));
    expect(html).toMatch(/<pre class="lx-mail-body">/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("https://example.com/a?b=1");
    expect(html).not.toMatch(/<a [^>]*href="https:\/\/example\.com/);
  });

  it("each failure state has its own sentence, and a token problem offers Reconnect", () => {
    expect(pane({ status: "not-available" })).toContain("This message is no longer available.");
    expect(pane({ status: "gone" })).toContain("This message is no longer in the mailbox.");
    const failed = pane({ status: "failed" });
    expect(failed).toContain("couldn't be read");
    expect(failed).not.toContain("Reconnect");
    const reauth = pane({ status: "reauth" });
    expect(reauth).toContain("Reconnect");
    expect(reauth).toContain("/dashboard/settings/integrations/");
  });

  it("an empty body says so rather than drawing a blank", () => {
    expect(pane(ok({ body: "  " }))).toContain("(This message has no text.)");
  });
});

// ── the body is never stored, cached or logged ───────────────────────────────

describe("sentinel body", () => {
  beforeEach(() => vi.resetModules());

  it("never reaches console, a database write, a cache or a cache header", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const calls: string[] = [];
    const builder = (): unknown =>
      new Proxy(function () {}, {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
          calls.push(prop);
          return builder;
        },
        apply: () => builder(),
      });
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ from: builder() })) }));
    vi.doMock("@/lib/mailbox/my-mailbox", () => ({ searchableMailboxAccess: vi.fn(async () => ({ ok: true, items: [] })) }));
    const { liveMailReadDeps } = await import("@/lib/mailbox/read-message-live");
    await liveMailReadDeps.readActivity(ACT);
    await liveMailReadDeps.tagsFor(["graph:x"]);
    expect(calls.filter((c) => /^(insert|update|upsert|delete|rpc)$/.test(c))).toEqual([]);

    const { deps } = fakeDeps({ rows: row(), fetchMessage: async () => message({ body: SENTINEL }) });
    const state = await loadStoredMessage(ACT, deps);
    const html = renderToStaticMarkup(<MailReadingPane state={state} backHref="/x" />);
    expect(html).toContain(SENTINEL);
    for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);
  });

  it("no mail file uses dangerouslySetInnerHTML, unstable_cache, a cache header or a logger, and the page is force-dynamic", () => {
    const files = ["src/app/dashboard/mail/page.tsx", "src/components/mailbox/MailReadingPane.tsx", "src/components/mailbox/LiveInboxList.tsx", "src/lib/mailbox/read-message.ts", "src/lib/mailbox/read-message-live.ts"];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|unstable_cache|Cache-Control|revalidate|console\./i);
    }
    expect(fs.readFileSync("src/app/dashboard/mail/page.tsx", "utf8")).toContain('export const dynamic = "force-dynamic"');
    expect(fs.readFileSync("src/lib/mailbox/fetch.ts", "utf8")).not.toMatch(/console\./);
  });
});

// ── layout ───────────────────────────────────────────────────────────────────

describe("styles and wiring", () => {
  const css = fs.readFileSync("src/components/mailbox/mail-pane.css", "utf8");

  it("the body wraps so nothing scrolls sideways at 375px", () => {
    expect(css).toMatch(/\.lx-mail-body\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/);
  });

  it("at 640px and below the pane replaces the list", () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.lx-mail-wrap\[data-pane="open"\] \.lx-mail-list\s*\{\s*display:\s*none/);
  });

  it("uses tokens only: no raw hex colours and no new fonts", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/font-family:\s*(?!\s|inherit)/);
  });

  it("the list rows link to ?m= keeping box and f, and 'Open in Outlook' stays as a secondary link", () => {
    const page = fs.readFileSync("src/app/dashboard/mail/page.tsx", "utf8");
    expect(page).toContain("href({ m: r.id })");
    expect(page).toMatch(/if \(b\) q\.set\("box", b\);\s*if \(ff\) q\.set\("f", ff\);/);
    expect(page).toContain("Open in {providerOf");
    expect(page).toContain('tab: "inbox"');
  });
});
