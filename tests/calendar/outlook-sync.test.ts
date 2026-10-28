import { afterEach, describe, expect, it, vi } from "vitest";
import { runMailboxSync, freshAccessToken, type ConnectionRow } from "@/lib/mailbox/sync";
import { syncOrgCalendars } from "@/lib/calendar/outlook-sync";
import { openToken } from "@/lib/mailbox/crypto";
import type { GraphEvent } from "@/lib/calendar/outlook-parse";
import { STRATEGY_SESSION, LEADS } from "./fixtures";
import {
  NOW,
  ORG,
  OTHER_ORG,
  SCOPES_MAIL_ONLY,
  WINDOW_FROM,
  WINDOW_TO,
  build,
  conn,
  deletes,
  eventRows,
  root,
  upserts,
  type World,
} from "./world";
import { filterValue } from "../mailbox/fake-db";

afterEach(() => vi.restoreAllMocks());

const ev = (id: string, over: Partial<GraphEvent> = {}): GraphEvent => ({
  id,
  subject: `Meeting ${id}`,
  start: { dateTime: "2026-10-25T15:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-10-25T15:30:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  isCancelled: false,
  attendees: [],
  ...over,
});

const run = (w: ReturnType<typeof build>) => runMailboxSync(w.deps);

describe("F2: what is written, and how it is asked for", () => {
  it("copies org_id from the connection row, keys the upsert on (org_id, source, external_id) and tags the connection", async () => {
    const w = build({
      connections: [conn("conn-a"), conn("conn-b", { org_id: OTHER_ORG })],
      leads: { [ORG]: LEADS, [OTHER_ORG]: [] },
      calendar: {
        "access-conn-a": [{ value: [ev("a1", { org_id: OTHER_ORG } as GraphEvent), ev("a2")] }],
        "access-conn-b": [{ value: [ev("b1", { org_id: ORG } as GraphEvent)] }],
      },
    });
    await run(w);
    const stmts = upserts(w.log);
    expect(stmts).toHaveLength(2);
    for (const q of stmts) expect(q.onConflict).toBe("org_id,source,external_id");
    const rows = eventRows(w.log);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    expect(byId.get("a1")).toMatchObject({ org_id: ORG, source: "outlook", mailbox_connection_id: "conn-a" });
    expect(byId.get("a2")).toMatchObject({ org_id: ORG, mailbox_connection_id: "conn-a" });
    expect(byId.get("b1")).toMatchObject({ org_id: OTHER_ORG, source: "outlook", mailbox_connection_id: "conn-b" });
    // No row names a Lawmatics id, and none carries a field outside the stored set.
    for (const r of rows) {
      expect(r).not.toHaveProperty("lawmatics_id");
      expect(Object.keys(r).sort()).toEqual(
        ["all_day", "attendee_emails", "ends_at", "external_id", "is_consult", "join_url", "lead_id", "location", "mailbox_connection_id", "org_id", "organizer_email", "source", "starts_at", "synced_at", "title", "updated_at"].sort(),
      );
    }
  });

  it("asks Graph for now - 7d to now + 30d, in UTC, with a minimal $select, and follows @odata.nextLink", async () => {
    const next = "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=page2";
    const w = build({
      connections: [conn("conn-a")],
      calendar: { "access-conn-a": [{ value: [ev("p1")], nextLink: next }, { value: [ev("p2")] }] },
    });
    await run(w);
    expect(w.calendarCalls).toHaveLength(2);
    const first = new URL(w.calendarCalls[0].url);
    expect(first.origin + first.pathname).toBe("https://graph.microsoft.com/v1.0/me/calendarView");
    expect(first.searchParams.get("startDateTime")).toBe(WINDOW_FROM);
    expect(first.searchParams.get("endDateTime")).toBe(WINDOW_TO);
    expect(first.searchParams.get("$select")!.split(",").sort()).toEqual(
      ["attendees", "bodyPreview", "end", "id", "isAllDay", "isCancelled", "location", "onlineMeeting", "organizer", "start", "subject"].sort(),
    );
    expect(w.calendarCalls[0].headers.prefer).toBe('outlook.timezone="UTC"');
    expect(w.calendarCalls[0].headers.authorization).toBe("Bearer access-conn-a");
    expect(w.calendarCalls[1].url).toBe(next);
    expect(eventRows(w.log).map((r) => r.external_id).sort()).toEqual(["p1", "p2"]);
  });

  it("never follows a next link that leaves Graph, and counts that connection as failed", async () => {
    const w = build({
      connections: [conn("conn-a")],
      calendar: { "access-conn-a": [{ value: [ev("p1")], nextLink: "https://evil.example/steal" }] },
    });
    const summary = await run(w);
    expect(w.calendarCalls).toHaveLength(1);
    expect(w.calls.some((c) => c.url.includes("evil.example"))).toBe(false);
    expect(summary.calendar[0].failed).toBe(1);
    expect(deletes(w.log)).toHaveLength(0);
  });
});

describe("F3 / D4: deletion is limited to this connection's Outlook rows", () => {
  const row = (conn_: string, ext: string, startsAt: string, over: Record<string, unknown> = {}) => ({
    org_id: ORG,
    source: "outlook",
    external_id: ext,
    mailbox_connection_id: conn_,
    starts_at: startsAt,
    ...over,
  });

  const world = (calendar: World["calendar"]): World => ({
    connections: [conn("conn-a"), conn("conn-b")],
    stored: [
      row("conn-a", "keep", "2026-10-25T15:00:00.000Z"),
      row("conn-a", "gone-1", "2026-10-26T15:00:00.000Z"),
      row("conn-a", "cancelled", "2026-10-27T15:00:00.000Z"),
      row("conn-a", "old-outside-window", "2026-09-01T15:00:00.000Z"),
      row("conn-b", "other-conn", "2026-10-26T15:00:00.000Z"),
      { org_id: ORG, source: "lawmatics", external_id: null, lawmatics_id: "lm-1", mailbox_connection_id: null, starts_at: "2026-10-26T15:00:00.000Z" },
      row("conn-z", "other-org-conn", "2026-10-26T15:00:00.000Z", { org_id: OTHER_ORG }),
    ],
    calendar: { "access-conn-a": [{ value: [ev("keep"), ev("cancelled", { isCancelled: true })] }], "access-conn-b": [{ value: [ev("other-conn")] }], ...calendar },
  });

  it("removes only what vanished from this connection, inside the window, and says so in the filter", async () => {
    const w = build(world(undefined));
    const summary = await run(w);
    const del = deletes(w.log);
    expect(del).toHaveLength(1);
    const q = del[0];
    expect(filterValue(q, "org_id")).toBe(ORG);
    expect(filterValue(q, "source")).toBe("outlook");
    expect(filterValue(q, "mailbox_connection_id")).toBe("conn-a");
    expect(q.filters.find((f) => f.op === "gte")).toMatchObject({ column: "starts_at", value: WINDOW_FROM });
    expect(q.filters.find((f) => f.op === "lt")).toMatchObject({ column: "starts_at", value: WINDOW_TO });
    // The vanished set: the missing event and the cancelled one; never the kept one.
    expect((filterValue(q, "external_id") as string[]).sort()).toEqual(["cancelled", "gone-1"]);
    expect(summary.calendar[0].removed).toBe(2);

    const left = w.stored.map((s) => s.external_id ?? s.lawmatics_id);
    expect(left).toEqual(expect.arrayContaining(["keep", "old-outside-window", "other-conn", "lm-1", "other-org-conn"]));
    expect(left).not.toContain("gone-1");
    expect(left).not.toContain("cancelled");
  });

  it("does not store a cancelled event", async () => {
    const w = build(world(undefined));
    await run(w);
    expect(eventRows(w.log).map((r) => r.external_id)).not.toContain("cancelled");
  });

  it("an incomplete read (a page failing) deletes nothing, but keeps what it did read", async () => {
    const w = build(
      world({
        "access-conn-a": [{ value: [ev("keep")], nextLink: "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=2" }, { status: 500 }],
      }),
    );
    const summary = await run(w);
    expect(deletes(w.log)).toHaveLength(0);
    expect(eventRows(w.log).map((r) => r.external_id)).toContain("keep");
    expect(summary.calendar[0].failed).toBe(1);
    expect(w.stored.some((s) => s.external_id === "gone-1")).toBe(true);
  });

  it("an incomplete read (the page cap reached) deletes nothing", async () => {
    const w = build(
      world({
        "access-conn-a": (page: number) => ({ value: [ev(`pg${page}`)], nextLink: `https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=${page + 1}` }),
      }),
    );
    await run(w);
    expect(w.calendarCalls.filter((c) => c.headers.authorization === "Bearer access-conn-a")).toHaveLength(10);
    expect(deletes(w.log)).toHaveLength(0);
    expect(w.stored.some((s) => s.external_id === "gone-1")).toBe(true);
  });

  it("D4: an event present in run 1 and absent from run 2 is deleted; one outside the window never is", async () => {
    const w1 = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ value: [ev("e1"), ev("e2")] }] } });
    await run(w1);
    expect(w1.stored.map((s) => s.external_id).sort()).toEqual(["e1", "e2"]);
    w1.stored.push({ org_id: ORG, source: "outlook", external_id: "ancient", mailbox_connection_id: "conn-a", starts_at: "2026-01-01T00:00:00.000Z" });

    const w2 = build({
      connections: [conn("conn-a")],
      stored: w1.stored,
      calendar: { "access-conn-a": [{ value: [ev("e1")] }] },
    });
    await run(w2);
    expect(w2.stored.map((s) => s.external_id).sort()).toEqual(["ancient", "e1"]);
    expect((filterValue(deletes(w2.log)[0], "external_id") as string[])).toEqual(["e2"]);
  });
});

describe("F4: no body or preview is stored, recorded or logged", () => {
  it("a sentinel planted in the body and preview appears nowhere", async () => {
    const SENTINEL = "SENTINEL-PRIVATE-BODY-7731";
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const w = build({
      connections: [conn("conn-a")],
      leads: { [ORG]: LEADS },
      calendar: {
        "access-conn-a": [
          { value: [{ ...STRATEGY_SESSION, bodyPreview: `${SENTINEL} https://zoom.us/j/1`, body: { content: SENTINEL } } as GraphEvent, ev("x", { bodyPreview: SENTINEL })] },
        ],
      },
    });
    const summary = await run(w);
    expect(JSON.stringify(w.log)).not.toContain(SENTINEL);
    expect(JSON.stringify(w.runs)).not.toContain(SENTINEL);
    expect(JSON.stringify(summary)).not.toContain(SENTINEL);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(SENTINEL);
    // The agent_run summary holds counts, never a title, address, location or link.
    const calRun = w.log.find((q) => q.table === "agent_run" && q.action === "update" && String((q.values as { summary?: string }).summary).includes("calendar"))!;
    expect(JSON.stringify(calRun.values)).not.toMatch(/@|Strategy|Meeting|Teams|https?:/);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("F5: a connection without Calendars.Read is skipped, and mail carries on", () => {
  it("makes no calendar call, counts it as needing reconnect, leaves its mail status alone", async () => {
    const w = build({ connections: [conn("conn-a", { scopes: SCOPES_MAIL_ONLY })] });
    const summary = await run(w);
    expect(w.calendarCalls).toHaveLength(0);
    expect(summary.calendar[0]).toMatchObject({ state: "skipped", needsReconnect: 1, calendars: 0, failed: 0 });
    // Mail sync still ran and succeeded.
    expect(summary).toMatchObject({ ok: 1, failed: 0 });
    const updates = w.log.filter((q) => q.table === "mailbox_connection" && q.action === "update").map((q) => q.values as Record<string, unknown>);
    expect(updates.some((u) => u.status === "error" || u.status === "reauth")).toBe(false);
    expect(updates.some((u) => u.sync_cursor)).toBe(true);
  });

  it("a row with no scopes list at all is treated as lacking it", async () => {
    const w = build({ connections: [conn("conn-a", { scopes: null })] });
    const summary = await run(w);
    expect(w.calendarCalls).toHaveLength(0);
    expect(summary.calendar[0].needsReconnect).toBe(1);
  });

  it("a Google connection is not read for a calendar and is not counted as needing reconnect", async () => {
    // Gmail isn't routed in this world, so its mail step fails inside its own try; the calendar step must still ignore it.
    const w = build({ connections: [conn("conn-g", { provider: "google", scopes: [] })] });
    const summary = await run(w);
    expect(w.calendarCalls).toHaveLength(0);
    expect(summary.calendar).toHaveLength(0);
  });

  it("with one scoped and one unscoped connection, only the scoped one is read", async () => {
    const w = build({
      connections: [conn("conn-a"), conn("conn-b", { scopes: SCOPES_MAIL_ONLY })],
      calendar: { "access-conn-a": [{ value: [ev("a1")] }] },
    });
    const summary = await run(w);
    expect(w.calendarCalls).toHaveLength(1);
    expect(summary.calendar[0]).toMatchObject({ state: "ok", calendars: 1, needsReconnect: 1, written: 1 });
  });
});

describe("F6: the calendar-sync agent_run", () => {
  const calendarRuns = (w: ReturnType<typeof build>) => w.runs.filter((r) => r.agent === "calendar-sync");
  const finish = (w: ReturnType<typeof build>) =>
    w.log.filter((q) => q.table === "agent_run" && q.action === "update").map((q) => q.values as Record<string, unknown>).at(-1)!;

  it("one row per org with a Microsoft connection, finished ok with counts only", async () => {
    const w = build({
      connections: [conn("conn-a"), conn("conn-b", { org_id: OTHER_ORG })],
      calendar: { "access-conn-a": [{ value: [ev("a1"), ev("a2")] }], "access-conn-b": [{ value: [ev("b1")] }] },
    });
    await run(w);
    expect(calendarRuns(w)).toHaveLength(2);
    expect(calendarRuns(w)[0]).toMatchObject({ org_id: ORG, agent: "calendar-sync", trigger: "cron", status: "running" });
    expect(finish(w)).toMatchObject({ status: "ok", items_in: 1, drafts_out: 0, error: null });
    expect(String(finish(w).summary)).toMatch(/1 calendar\(s\) read, 1 event\(s\) read, 1 written, 0 removed, 0 need reconnecting, 0 failed/);
  });

  it("finishes skipped when every connection needs reconnecting", async () => {
    const w = build({ connections: [conn("conn-a", { scopes: SCOPES_MAIL_ONLY })] });
    await run(w);
    expect(finish(w)).toMatchObject({ status: "skipped", error: null });
  });

  it("finishes error when every calendar read failed", async () => {
    const w = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ status: 500 }] } });
    const summary = await run(w);
    expect(finish(w)).toMatchObject({ status: "error" });
    expect(finish(w).error).toMatch(/1 calendar\(s\) could not be read/);
    expect(summary.calendar[0]).toMatchObject({ state: "error", failed: 1 });
  });

  it("finishes ok when one connection fails and another is read", async () => {
    const w = build({
      connections: [conn("conn-a"), conn("conn-b")],
      calendar: { "access-conn-a": [{ status: 500 }], "access-conn-b": [{ value: [ev("b1")] }] },
    });
    const summary = await run(w);
    expect(finish(w)).toMatchObject({ status: "ok" });
    expect(summary.calendar[0]).toMatchObject({ failed: 1, written: 1 });
  });

  it("inserts no calendar-sync row for an org with only Google connections", async () => {
    const w = build({ connections: [conn("conn-g", { provider: "google" })] });
    await run(w);
    expect(calendarRuns(w)).toHaveLength(0);
  });
});

describe("F7: a calendar problem never disturbs mail", () => {
  const mailIntact = (w: ReturnType<typeof build>, summary: Awaited<ReturnType<typeof run>>) => {
    expect(summary).toMatchObject({ orgs: 1, connections: 1, ok: 1, failed: 0 });
    const done = w.log.find((q) => q.table === "mailbox_connection" && q.action === "update" && (q.values as Record<string, unknown>).sync_cursor);
    expect(done!.values).toMatchObject({ status: "active", last_error: null });
    const statusWrites = w.log.filter((q) => q.table === "mailbox_connection" && q.action === "update" && ["error", "reauth"].includes(String((q.values as Record<string, unknown>).status)));
    expect(statusWrites).toHaveLength(0);
  };

  it("Graph 500 on calendarView", async () => {
    const w = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ status: 500 }] } });
    mailIntact(w, await run(w));
  });

  it("a thrown fetch", async () => {
    const w = build({ connections: [conn("conn-a")], throwOnCalendar: true });
    const summary = await run(w);
    mailIntact(w, summary);
    expect(summary.calendar[0].failed).toBe(1);
  });

  it("a refused statement", async () => {
    const w = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ value: [ev("a1")] }] }, upsertError: { code: "XX000", message: "boom" } });
    const summary = await run(w);
    mailIntact(w, summary);
    expect(summary.calendar[0].failed).toBe(1);
    expect(deletes(w.log)).toHaveLength(0);
  });

  it("a mailbox whose mail sync found the refresh token dead is not read, and is not marked twice", async () => {
    const w = build({
      connections: [conn("conn-a", { token_expires_at: "2026-10-21T11:00:00Z" })],
      tokenResponse: { status: 400, body: { error: "invalid_grant" } },
    });
    const summary = await run(w);
    expect(summary).toMatchObject({ ok: 0, failed: 1 });
    expect(w.calendarCalls).toHaveLength(0);
    expect(summary.calendar[0]).toMatchObject({ state: "error", failed: 1 });
    const statusWrites = w.log.filter((q) => q.table === "mailbox_connection" && q.action === "update" && (q.values as Record<string, unknown>).status === "reauth");
    expect(statusWrites).toHaveLength(1);
  });
});

describe("F8: before lectual 0098 is applied", () => {
  it("an undefined column on the upsert ends the step quietly: nothing deleted, mail intact, reported", async () => {
    const w = build({
      connections: [conn("conn-a")],
      stored: [{ org_id: ORG, source: "outlook", external_id: "old", mailbox_connection_id: "conn-a", starts_at: "2026-10-26T15:00:00.000Z" }],
      calendar: { "access-conn-a": [{ value: [ev("a1")] }] },
      upsertError: { code: "42703", message: 'column "source" of relation "crm_calendar_event" does not exist' },
    });
    const summary = await run(w);
    expect(summary).toMatchObject({ ok: 1, failed: 0 });
    expect(summary.calendar[0].state).toBe("database-update-needed");
    expect(deletes(w.log)).toHaveLength(0);
    expect(w.stored).toHaveLength(1);
    const lastRun = w.log.filter((q) => q.table === "agent_run" && q.action === "update").at(-1)!.values as Record<string, unknown>;
    expect(lastRun).toMatchObject({ status: "skipped" });
    expect(String(lastRun.summary)).toContain("switched on for your firm yet");
  });

  it("PostgREST's schema-cache wording counts too", async () => {
    const w = build({
      connections: [conn("conn-a")],
      calendar: { "access-conn-a": [{ value: [ev("a1")] }] },
      upsertError: { code: "PGRST204", message: "Could not find the 'external_id' column of 'crm_calendar_event' in the schema cache" },
    });
    expect((await run(w)).calendar[0].state).toBe("database-update-needed");
  });

  it("a refused calendar-sync agent_run insert (23514) stops the step before any Graph call or event write", async () => {
    const w = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ value: [ev("a1")] }] }, refuseCalendarRun: true });
    const summary = await run(w);
    expect(summary).toMatchObject({ ok: 1, failed: 0 });
    expect(summary.calendar[0]).toMatchObject({ state: "database-update-needed", written: 0, removed: 0 });
    expect(w.calendarCalls).toHaveLength(0);
    expect(upserts(w.log)).toHaveLength(0);
    expect(deletes(w.log)).toHaveLength(0);
    expect(w.log.some((q) => q.table === "crm_calendar_event")).toBe(false);
  });

  it("an undefined column when listing existing rows also stops before any delete", async () => {
    const w2 = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ value: [ev("a1")] }] } });
    const orig = w2.admin.from.bind(w2.admin);
    (w2.admin as unknown as { from: unknown }).from = (table: string) => {
      const q = orig(table) as unknown as { select: (c?: string) => unknown };
      if (table !== "crm_calendar_event") return q;
      const select = q.select.bind(q);
      q.select = (cols?: string) => {
        const r = select(cols) as { then: (ok: (v: unknown) => unknown) => Promise<unknown> };
        r.then = (ok) => Promise.resolve({ data: null, error: { code: "42703", message: "column crm_calendar_event.source does not exist" } }).then(ok);
        return r;
      };
      return q;
    };
    const summary = await runMailboxSync({ ...w2.deps, admin: w2.admin });
    expect(summary.calendar[0].state).toBe("database-update-needed");
    expect(deletes(w2.log)).toHaveLength(0);
  });
});

describe("D1: a consult flows through the whole chain", () => {
  it("a Strategy Session with a lead attendee is stored flagged, linked, with its join link and lowercased attendees", async () => {
    const w = build({ connections: [conn("conn-a")], leads: { [ORG]: LEADS }, calendar: { "access-conn-a": [{ value: [STRATEGY_SESSION] }] } });
    await run(w);
    const [row] = eventRows(w.log);
    expect(row).toMatchObject({
      org_id: ORG,
      external_id: "evt-strategy",
      title: "Strategy Session: Amara Nwosu",
      is_consult: true,
      lead_id: "lead-amara",
      join_url: "https://teams.microsoft.com/l/meetup-join/strategy-1",
      attendee_emails: ["amara@example.com", "rebecca@firm.example"],
      organizer_email: "rebecca@firm.example",
      starts_at: "2026-10-22T18:00:00.000Z",
    });
  });
});

describe("D2: the consult flag by the second rule alone", () => {
  const plain = (organizer: string): GraphEvent => ({
    ...ev("plain"),
    subject: "Catch up",
    organizer: { emailAddress: { address: organizer } },
    attendees: [{ emailAddress: { address: "amara@example.com" } }],
  });

  it("flagged for a firm organizer, not for an outside one", async () => {
    const firm = build({ connections: [conn("conn-a", { email: "rebecca@firm.example" })], leads: { [ORG]: LEADS }, calendar: { "access-conn-a": [{ value: [plain("rebecca@firm.example")] }] } });
    await run(firm);
    expect(eventRows(firm.log)[0]).toMatchObject({ is_consult: true, lead_id: "lead-amara" });

    const outside = build({ connections: [conn("conn-a", { email: "rebecca@firm.example" })], leads: { [ORG]: LEADS }, calendar: { "access-conn-a": [{ value: [plain("stranger@elsewhere.example")] }] } });
    await run(outside);
    expect(eventRows(outside.log)[0]).toMatchObject({ is_consult: false, lead_id: "lead-amara" });
  });

  it("an ambiguous lead is stored unlinked", async () => {
    const w = build({
      connections: [conn("conn-a")],
      leads: { [ORG]: [{ id: "l1", email: "amara@example.com" }, { id: "l2", email: "AMARA@example.com" }] },
      calendar: { "access-conn-a": [{ value: [plain("x@y.org")] }] },
    });
    await run(w);
    expect(eventRows(w.log)[0].lead_id).toBeNull();
  });

  it("another org's lead is never linked", async () => {
    const w = build({ connections: [conn("conn-a")], leads: { [ORG]: [], [OTHER_ORG]: LEADS }, calendar: { "access-conn-a": [{ value: [plain("x@y.org")] }] } });
    await run(w);
    expect(eventRows(w.log)[0].lead_id).toBeNull();
  });
});

describe("D3: running twice is idempotent", () => {
  it("issues the same upsert keys and no deletes the second time", async () => {
    const calendar = { "access-conn-a": [{ value: [ev("e1"), ev("e2")] }] };
    const first = build({ connections: [conn("conn-a")], calendar });
    await run(first);
    const second = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ value: [ev("e1"), ev("e2")] }] }, stored: first.stored });
    await run(second);
    const keys = (w: ReturnType<typeof build>) => eventRows(w.log).map((r) => `${r.org_id}|${r.source}|${r.external_id}`).sort();
    expect(keys(second)).toEqual(keys(first));
    expect(new Set(keys(second)).size).toBe(keys(second).length);
    expect(deletes(second.log)).toHaveLength(0);
    expect(second.stored).toHaveLength(2);
  });

  it("collapses a repeated id within one read to a single row", async () => {
    const w = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ value: [ev("dup"), ev("dup")] }] } });
    await run(w);
    expect(eventRows(w.log)).toHaveLength(1);
  });
});

describe("D5: tokens and independent failure", () => {
  it("stores a rotated refresh token returned while the calendar is being read, and uses the new access token", async () => {
    const w = build({
      connections: [conn("conn-a", { token_expires_at: "2026-10-21T11:00:00Z" })],
      calendar: { "access-refreshed": [{ value: [ev("a1")] }] },
    });
    const row = (await (w.admin as never as { from: (t: string) => { select: () => Promise<{ data: unknown[] }> } }).from("mailbox_connection").select()).data[0] as ConnectionRow;
    const result = await syncOrgCalendars(
      { admin: w.admin, fetchImpl: w.fetchImpl, now: NOW, getAccessToken: (r) => freshAccessToken(w.deps, r) },
      { orgId: ORG, connections: [row], mailDead: new Set(), leads: [] },
    );
    expect(result).toMatchObject({ state: "ok", written: 1 });
    expect(w.tokenCalls).toHaveLength(1);
    const stored = w.log.find((q) => q.table === "mailbox_connection" && q.action === "update" && (q.values as Record<string, unknown>).refresh_token_enc)!;
    expect(openToken(root, (stored.values as { refresh_token_enc: string }).refresh_token_enc)).toBe("refresh-rotated");
    expect(w.calendarCalls[0].headers.authorization).toBe("Bearer access-refreshed");
  });

  it("the mail step's refresh is reused by the calendar step: one token call, not two", async () => {
    const w = build({
      connections: [conn("conn-a", { token_expires_at: "2026-10-21T11:00:00Z" })],
      calendar: { "access-refreshed": [{ value: [ev("a1")] }] },
    });
    const summary = await run(w);
    expect(w.tokenCalls).toHaveLength(1);
    expect(summary.calendar[0]).toMatchObject({ state: "ok", written: 1 });
  });

  it("one connection failing leaves the other's events written", async () => {
    const w = build({
      connections: [conn("conn-a"), conn("conn-b")],
      calendar: { "access-conn-a": () => { throw new Error("only this mailbox"); }, "access-conn-b": [{ value: [ev("b1")] }] },
    });
    const summary = await run(w);
    expect(eventRows(w.log).map((r) => [r.mailbox_connection_id, r.external_id])).toEqual([["conn-b", "b1"]]);
    expect(summary.calendar[0]).toMatchObject({ state: "ok", failed: 1, written: 1 });
    expect(summary).toMatchObject({ ok: 2, failed: 0 });
  });

  it("a calendar-step refresh token that turns out dead marks the row reauth, like the mail step", async () => {
    const w = build({ connections: [conn("conn-a")], calendar: { "access-conn-a": [{ value: [ev("a1")] }] } });
    const row = (await (w.admin as never as { from: (t: string) => { select: () => Promise<{ data: unknown[] }> } }).from("mailbox_connection").select()).data[0] as ConnectionRow;
    const result = await syncOrgCalendars(
      {
        admin: w.admin,
        fetchImpl: w.fetchImpl,
        now: NOW,
        getAccessToken: async () => {
          const { ProviderError } = await import("@/lib/mailbox/providers");
          throw new ProviderError("Microsoft revoked access. Reconnect to resume syncing.", "reauth");
        },
      },
      { orgId: ORG, connections: [row], mailDead: new Set(), leads: [] },
    );
    expect(result).toMatchObject({ state: "error", failed: 1 });
    const mark = w.log.find((q) => q.table === "mailbox_connection" && q.action === "update")!;
    expect(mark.values).toMatchObject({ status: "reauth" });
    expect(filterValue(mark, "org_id")).toBe(ORG);
  });
});

describe("tenant fence", () => {
  it("every calendar statement carries the connection's org", async () => {
    const w = build({
      connections: [conn("conn-a"), conn("conn-b", { org_id: OTHER_ORG })],
      stored: [{ org_id: ORG, source: "outlook", external_id: "x", mailbox_connection_id: "conn-a", starts_at: "2026-10-26T15:00:00.000Z" }],
      calendar: { "access-conn-a": [{ value: [ev("a1")] }], "access-conn-b": [{ value: [ev("b1")] }] },
    });
    await run(w);
    for (const q of w.log.filter((x) => x.table === "crm_calendar_event")) {
      if (q.upsert) {
        for (const r of q.values as Array<{ org_id: string }>) expect([ORG, OTHER_ORG]).toContain(r.org_id);
      } else {
        expect([ORG, OTHER_ORG]).toContain(filterValue(q, "org_id"));
        expect(filterValue(q, "source")).toBe("outlook");
        expect(filterValue(q, "mailbox_connection_id")).toBeTruthy();
      }
    }
    // A delete in one org names that org's connection, never the other's.
    for (const q of deletes(w.log)) expect(filterValue(q, "org_id") === ORG ? filterValue(q, "mailbox_connection_id") : "conn-b").toBe(filterValue(q, "org_id") === ORG ? "conn-a" : "conn-b");
  });
});
