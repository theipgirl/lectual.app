import { beforeEach, describe, expect, it, vi } from "vitest";
import { prerender } from "react-dom/static";

process.env.__NEXT_TRAILING_SLASH = "true";

/** The My Mail page itself, rendered with every read faked: list, reading pane, Inbox tab. */

const BOX = "11111111-1111-4111-8111-111111111111";
const ACT = "33333333-3333-4333-8333-333333333333";

async function html(node: React.ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  const reader = prelude.getReader();
  let out = "";
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
}

async function renderMail(search: Record<string, string>, deps: Partial<import("@/lib/mailbox/read-message").MailReadDeps> = {}) {
  vi.resetModules();
  const activity = [
    { id: ACT, type: "email_received", created_at: "2026-10-26T15:00:00Z", lead_id: "lead-1", matter_id: null, payload: { source: "mailbox-sync", connection_id: BOX, from: "amara@example.com", to: ["r@firm.example"], subject: "About my mark", at: "2026-10-26T15:00:00Z", web_link: "https://outlook.office.com/mail/x", message_id: "graph:M1" } },
  ];
  const chain = (rows: unknown[]): unknown =>
    new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
        return () => chain(rows);
      },
    });
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => true) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner", org: { id: "o" }, user: { id: "u" } })) }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      from: (table: string) => chain(table === "crm_activity" ? activity : table === "crm_lead" ? [{ id: "lead-1", first_name: "Amara", last_name: "Nwosu", business_name: null, email: "amara@example.com" }] : []),
    })),
  }));
  vi.doMock("@/lib/mailbox/connections", () => ({
    listConnections: vi.fn(async () => ({ ok: true, connections: [{ id: BOX, provider: "microsoft", email: "r@firm.example", status: "active", scope: "personal", last_synced_at: "2026-10-26T16:00:00Z" }] })),
  }));
  const fetchMessage = vi.fn(async () => ({ from: "Amara <amara@example.com>", to: ["r@firm.example"], cc: [], at: "2026-10-26T15:00:00Z", subject: "About my mark", body: "Hello <b>there</b>" }));
  const fetchInbox = vi.fn(async () => ({
    messages: [{ id: "graph:L1", conversationId: null, mailbox: "r@firm.example", folder: "inbox" as const, direction: "inbound" as const, at: "2026-10-27T10:00:00Z", from: { name: "Newsletter", address: "n@x.com" }, to: [], cc: [], subject: "Live subject", preview: "live preview", webLink: null }],
    truncated: false,
  }));
  vi.doMock("@/lib/mailbox/read-message-live", () => ({
    liveMailReadDeps: {
      readActivity: async (id: string) => ({ ok: true, row: id === ACT ? { id: ACT, type: "email_received", payload: activity[0].payload } : null }),
      mailboxes: async () => ({ ok: true, items: [{ id: BOX, email: "r@firm.example", provider: "microsoft", accessToken: async () => "tok" }] }),
      fetchMessage,
      fetchInbox,
      tagsFor: async () => new Map(),
      ...deps,
    },
  }));
  const { default: MyMailPage } = await import("@/app/dashboard/mail/page");
  const out = await html(await MyMailPage({ searchParams: Promise.resolve(search) }));
  return { out, fetchMessage, fetchInbox };
}

beforeEach(() => vi.resetModules());

describe("My Mail page", () => {
  it("the list links each row to ?m=<activity id> and keeps the Outlook link as secondary", async () => {
    const { out, fetchMessage } = await renderMail({});
    expect(out).toContain(`href="/dashboard/mail/?m=${ACT}"`);
    expect(out).toContain("Open in Outlook");
    expect(out).not.toContain("lx-mail-pane");
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  it("?m= opens the message in the page, with a Back link that drops m and keeps box", async () => {
    const { out, fetchMessage } = await renderMail({ m: ACT, box: BOX });
    expect(out).toContain('data-pane="open"');
    expect(out).toContain("&lt;b&gt;there&lt;/b&gt;");
    expect(out).toContain(`href="/dashboard/mail/?box=${BOX}"`);
    expect(fetchMessage).toHaveBeenCalledTimes(1);
  });

  it("?m= for a row nobody can see says it is no longer available", async () => {
    const { out } = await renderMail({ m: "99999999-9999-4999-8999-999999999999" });
    expect(out).toContain("This message is no longer available.");
  });

  it("?tab=inbox lists the live messages and opens one through box + live; nothing is read from the stored list", async () => {
    const { out, fetchInbox } = await renderMail({ tab: "inbox" });
    expect(out).toContain("Live subject");
    expect(out).toContain(`box=${BOX}&amp;tab=inbox&amp;live=L1`);
    expect(out).toContain("tab=inbox");
    expect(fetchInbox).toHaveBeenCalledTimes(1);
  });

  it("?box + ?live opens a live message in the pane", async () => {
    const { out, fetchMessage } = await renderMail({ tab: "inbox", box: BOX, live: "L1" });
    expect(out).toContain('data-pane="open"');
    expect(fetchMessage).toHaveBeenCalledWith("microsoft", { accessToken: "tok", messageId: "L1" });
  });

  it("a hostile live id fetches nothing and the page says so", async () => {
    const { out, fetchMessage } = await renderMail({ box: BOX, live: "../../x" });
    expect(fetchMessage).not.toHaveBeenCalled();
    expect(out).toContain("This message is no longer available.");
  });
});
