import { describe, expect, it, vi } from "vitest";
import {
  MAILBOX_REASONS,
  MAX_MESSAGES_PER_PERSON,
  SEARCH_DAYS,
  milestonesOfHits,
  searchPersonMail,
  searchableAddress,
  type MailboxDeps,
  type SearchableMailbox,
} from "../../src/lib/reconcile/mailbox-search";

/**
 * The on-demand search of the firm's Microsoft mailboxes, against a fake Graph. Every state is named; none
 * reads as "no mail"; no body is ever requested.
 */

const NOW = Date.parse("2026-10-22T12:00:00Z");

const mailbox = (over: Partial<SearchableMailbox> = {}): SearchableMailbox => ({
  id: "m1",
  email: "firm@example.com",
  provider: "microsoft",
  scopes: ["openid", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/Mail.ReadWrite"],
  accessToken: async () => "tok",
  ...over,
});

const deps = (over: Partial<MailboxDeps> = {}): MailboxDeps => ({ moduleOn: true, mailboxes: { ok: true, items: [mailbox()] }, now: () => NOW, ...over });

/** A Graph that answers the inbox query with `received` and the sent-items query with `sent`. */
function graph(opts: { received?: unknown[]; sent?: unknown[]; status?: number; nextLink?: boolean } = {}) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    const status = opts.status ?? 200;
    const isSent = url.includes("/mailFolders/sentitems/");
    const value = isSent ? (opts.sent ?? []) : (opts.received ?? []);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ value, ...(opts.nextLink ? { "@odata.nextLink": "https://graph.microsoft.com/next" } : {}) }),
    } as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, urls };
}

const inMsg = (subject: string, at = "2026-10-16T10:00:00Z") => ({ subject, receivedDateTime: at, isDraft: false });
const outMsg = (subject: string, at = "2026-10-18T10:00:00Z") => ({ subject, sentDateTime: at, isDraft: false });

describe("searchableAddress", () => {
  it("takes a real address and refuses a placeholder, a blank and a malformed one", () => {
    expect(searchableAddress(" Sevetra@Prospera.Example ")).toBe("sevetra@prospera.example");
    expect(searchableAddress("sheet+abc@intake.invalid")).toBeNull();
    expect(searchableAddress("")).toBeNull();
    expect(searchableAddress(null)).toBeNull();
    expect(searchableAddress("a b@x.com")).toBeNull();
    expect(searchableAddress("x'@y.com")).toBeNull();
  });
});

describe("searchPersonMail: ok", () => {
  it("returns subject, date and direction only, from both folders", async () => {
    const g = graph({ received: [inMsg("Question about the proposal")], sent: [outMsg("Your Trademark Proposal", "2026-10-16T15:00:00Z"), outMsg("Following up", "2026-10-18T09:00:00Z")] });
    const r = await searchPersonMail("sevetra@prospera.example", deps({ fetchImpl: g.fetchImpl }));
    expect(r.state).toEqual({ status: "ok", messages: 3, sent: 2, received: 1, truncated: false, mailboxes: 1, unread: 0 });
    expect(r.hits[0]).toEqual({ direction: "sent", at: "2026-10-18T09:00:00Z", subject: "Following up" });
    for (const hit of r.hits) expect(Object.keys(hit).sort()).toEqual(["at", "direction", "subject"]);
  });

  it("a person with mail in neither folder is ok with zero: the search worked", async () => {
    const r = await searchPersonMail("a@b.example", deps({ fetchImpl: graph().fetchImpl }));
    expect(r.state).toMatchObject({ status: "ok", messages: 0 });
  });

  it("never asks Graph for a body, a preview, an attachment or a single message by id", async () => {
    const g = graph({ sent: [outMsg("x")] });
    await searchPersonMail("a@b.example", deps({ fetchImpl: g.fetchImpl }));
    expect(g.urls).toHaveLength(2);
    for (const url of g.urls) {
      const decoded = decodeURIComponent(url);
      expect(decoded).toMatch(/\$select=[^&]*/);
      expect(decoded).not.toMatch(/body|preview|attachment|\$value|\$expand/i);
      expect(url.startsWith("https://graph.microsoft.com/v1.0/me/")).toBe(true);
      expect(decoded).not.toMatch(/\/messages\/[^?]/);
    }
  });

  it("asks only for the last 120 days and at most 25 messages, filtered by the address", async () => {
    const g = graph();
    await searchPersonMail("a@b.example", deps({ fetchImpl: g.fetchImpl }));
    const since = new Date(NOW - SEARCH_DAYS * 86_400_000).toISOString();
    expect(SEARCH_DAYS).toBe(120);
    for (const url of g.urls) {
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain(since);
      expect(decoded).toContain("$top=25");
      expect(decoded).toContain("a@b.example");
    }
    expect(decodeURIComponent(g.urls[0])).toContain("from/emailAddress/address eq 'a@b.example'");
    expect(decodeURIComponent(g.urls[1])).toContain("toRecipients/any(r:r/emailAddress/address eq 'a@b.example')");
  });

  it("is GET only", async () => {
    const g = graph();
    await searchPersonMail("a@b.example", deps({ fetchImpl: g.fetchImpl }));
    for (const call of vi.mocked(g.fetchImpl as never as (u: string, i?: { method?: string }) => unknown).mock.calls) {
      expect(((call as unknown as [string, { method?: string }?])[1]?.method ?? "GET")).toBe("GET");
    }
  });

  it("skips a draft", async () => {
    const g = graph({ sent: [{ subject: "draft", sentDateTime: "2026-10-18T10:00:00Z", isDraft: true }, outMsg("real")] });
    const r = await searchPersonMail("a@b.example", deps({ fetchImpl: g.fetchImpl }));
    expect(r.hits.map((h) => h.subject)).toEqual(["real"]);
  });

  it("truncated at 25: keeps the newest 25 and says so", async () => {
    const many = Array.from({ length: 30 }, (_, i) => outMsg(`m${i}`, new Date(NOW - i * 3600_000).toISOString()));
    const g = graph({ sent: many });
    const r = await searchPersonMail("a@b.example", deps({ fetchImpl: g.fetchImpl }));
    expect(r.hits).toHaveLength(MAX_MESSAGES_PER_PERSON);
    expect(r.state).toMatchObject({ status: "ok", truncated: true, messages: 25 });
    expect(r.hits[0].subject).toBe("m0");
  });

  it("a full first page or a next link is also truncated", async () => {
    expect((await searchPersonMail("a@b.example", deps({ fetchImpl: graph({ nextLink: true }).fetchImpl }))).state).toMatchObject({ truncated: true });
    const page = Array.from({ length: 25 }, (_, i) => inMsg(`m${i}`));
    expect((await searchPersonMail("a@b.example", deps({ fetchImpl: graph({ received: page }).fetchImpl }))).state).toMatchObject({ truncated: true });
  });
});

describe("searchPersonMail: every other state is named and none is 'no mail'", () => {
  const expectUnavailable = (r: Awaited<ReturnType<typeof searchPersonMail>>, code: string, reason: string) => {
    expect(r.state).toEqual({ status: "unavailable", code, reason });
    expect(r.hits).toEqual([]);
  };

  it("no address", async () => {
    expectUnavailable(await searchPersonMail("sheet+x@intake.invalid", deps()), "no-address", MAILBOX_REASONS.noAddress);
    expectUnavailable(await searchPersonMail(null, deps()), "no-address", MAILBOX_REASONS.noAddress);
  });

  it("the Mailboxes module is off, or could not be checked", async () => {
    const g = graph();
    expectUnavailable(await searchPersonMail("a@b.example", deps({ moduleOn: false, fetchImpl: g.fetchImpl })), "module-off", MAILBOX_REASONS.moduleOff);
    expectUnavailable(await searchPersonMail("a@b.example", deps({ moduleOn: null, fetchImpl: g.fetchImpl })), "module-off", MAILBOX_REASONS.moduleOff);
    expect(g.urls).toEqual([]);
  });

  it("no mailbox connected", async () => {
    expectUnavailable(await searchPersonMail("a@b.example", deps({ mailboxes: { ok: true, items: [] } })), "no-mailbox", MAILBOX_REASONS.noMailbox);
  });

  it("the connections could not be read", async () => {
    expectUnavailable(await searchPersonMail("a@b.example", deps({ mailboxes: { ok: false } })), "failed", MAILBOX_REASONS.failed);
  });

  it("only Gmail is connected: not searched", async () => {
    const g = graph();
    const r = await searchPersonMail("a@b.example", deps({ mailboxes: { ok: true, items: [mailbox({ provider: "google" })] }, fetchImpl: g.fetchImpl }));
    expectUnavailable(r, "gmail-only", MAILBOX_REASONS.gmailOnly);
    expect(g.urls).toEqual([]);
  });

  it("the Outlook mailbox never granted Mail.Read", async () => {
    const g = graph();
    const r = await searchPersonMail("a@b.example", deps({ mailboxes: { ok: true, items: [mailbox({ scopes: ["openid", "User.Read"] })] }, fetchImpl: g.fetchImpl }));
    expectUnavailable(r, "scope-missing", MAILBOX_REASONS.scopeMissing);
    expect(g.urls).toEqual([]);
  });

  it("a stored scope list that is not recorded is read as granted (the mailbox syncs, so it has mail access)", async () => {
    const r = await searchPersonMail("a@b.example", deps({ mailboxes: { ok: true, items: [mailbox({ scopes: null })] }, fetchImpl: graph().fetchImpl }));
    expect(r.state.status).toBe("ok");
  });

  it("Graph answers 401 or 403: reconnect", async () => {
    for (const status of [401, 403]) {
      expectUnavailable(await searchPersonMail("a@b.example", deps({ fetchImpl: graph({ status }).fetchImpl })), "reauth", MAILBOX_REASONS.reauth);
    }
  });

  it("Graph answers 500, or the network throws: failed, with a fixed sentence", async () => {
    expectUnavailable(await searchPersonMail("a@b.example", deps({ fetchImpl: graph({ status: 500 }).fetchImpl })), "failed", MAILBOX_REASONS.failed);
    const boom = vi.fn(async () => {
      throw new Error("SECRET-network-detail");
    });
    const r = await searchPersonMail("a@b.example", deps({ fetchImpl: boom as never }));
    expectUnavailable(r, "failed", MAILBOX_REASONS.failed);
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("the token cannot be had: failed, not empty", async () => {
    const r = await searchPersonMail("a@b.example", deps({ mailboxes: { ok: true, items: [mailbox({ accessToken: async () => { throw new Error("SECRET"); } })] }, fetchImpl: graph().fetchImpl }));
    expectUnavailable(r, "failed", MAILBOX_REASONS.failed);
  });

  it("two mailboxes, one failing: ok from the one that answered, and the other is counted as unread", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      // The first mailbox's two queries succeed, the second mailbox's fail.
      const ok = n <= 2;
      return { ok, status: ok ? 200 : 500, json: async () => ({ value: [outMsg("x")] }) } as unknown as Response;
    });
    const d = deps({ mailboxes: { ok: true, items: [mailbox({ id: "m1" }), mailbox({ id: "m2", accessToken: async () => "tok2" })] }, fetchImpl: fetchImpl as never });
    const r = await searchPersonMail("a@b.example", d);
    expect(r.state).toMatchObject({ status: "ok", unread: 1, mailboxes: 1 });
  });
});

describe("milestonesOfHits", () => {
  it("classifies subjects in memory by direction, and a dispute thread says nothing", () => {
    const out = milestonesOfHits([
      { direction: "sent", at: "2026-10-16T00:00:00Z", subject: "Your Trademark Proposal" },
      { direction: "received", at: "2026-10-17T00:00:00Z", subject: "Re: Your Trademark Proposal" },
      { direction: "sent", at: "2026-10-18T00:00:00Z", subject: "Settlement offer" },
    ]);
    expect(out[0].milestones).toEqual(["proposal_sent"]);
    expect(out[1].milestones).toEqual(["contacted"]);
    expect(out[2].milestones).toEqual([]);
  });
});

describe("the search module touches no database and sends nothing", () => {
  it("has no table access, no send, no draft", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/lib/reconcile/mailbox-search.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).not.toMatch(/\.from\(|\.insert\(|\.update\(|sendMail|\/send|createMailboxDraft|db\/admin|getAdminClient/);
    expect(src).not.toMatch(/method:\s*["'](POST|PATCH|PUT|DELETE)/);
  });
});
