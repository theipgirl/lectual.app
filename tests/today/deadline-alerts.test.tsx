import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  alertWindow,
  civilDaysUntil,
  ALERT_RECIPIENT_ROLES,
  canReceiveDeadlineAlerts,
  currentRecipients,
  deadlineCardGroups,
  isRecipient,
  noticePayload,
  noticesToRaise,
  parseRecipientData,
  raisedKeys,
  type AlertDeadline,
} from "@/lib/today/deadline-alerts";
import { DeadlineAlertsView } from "@/components/today/DeadlineAlertsCard";
import { describeNotification } from "@/lib/notifications/describe";

process.env.__NEXT_TRAILING_SLASH = "true";
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");

const TODAY = "2026-11-20";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const dl = (id: string, dueDate: string, over: Partial<AlertDeadline> = {}): AlertDeadline => ({ id, matterId: `m-${id}`, title: `Deadline ${id}`, dueDate, confirmed: true, matterLabel: "TM-1 · The Pleat", ...over });

describe("windows", () => {
  it("0..7 days is the 7-day window, 8..30 the 30-day window, overdue and later none", () => {
    expect(alertWindow(civilDaysUntil("2026-11-20", TODAY))).toBe(7);
    expect(alertWindow(civilDaysUntil("2026-11-27", TODAY))).toBe(7);
    expect(alertWindow(civilDaysUntil("2026-11-28", TODAY))).toBe(30);
    expect(alertWindow(civilDaysUntil("2026-12-20", TODAY))).toBe(30);
    expect(alertWindow(civilDaysUntil("2026-12-21", TODAY))).toBe(null);
    expect(alertWindow(civilDaysUntil("2026-11-19", TODAY))).toBe(null);
    expect(alertWindow(null)).toBe(null);
  });
});

describe("AT3a: recipients are the members picked in Settings", () => {
  it("reads only uuids from the stored list; anything else is dropped", () => {
    expect(parseRecipientData({ user_ids: [U1, "Rebecca", 4, U2, U1] })).toEqual([U1, U2]);
    expect(parseRecipientData(null)).toEqual([]);
    expect(parseRecipientData({ user_ids: "x" })).toEqual([]);
  });

  it("a removed member gets none: only current members count", () => {
    expect(currentRecipients([U1, U2], [{ userId: U1, role: "attorney" }, { userId: U3, role: "owner" }])).toEqual([U1]);
  });

  it("a stored recipient whose role became viewer or social media (or unreadable) is dropped on read, like a removed member", () => {
    const members = [
      { userId: U1, role: "viewer" },
      { userId: U2, role: "social_media" },
      { userId: U3, role: "paralegal" },
    ];
    expect(currentRecipients([U1, U2, U3], members)).toEqual([U3]);
    expect(currentRecipients([U1], [{ userId: U1, role: null }])).toEqual([]);
    expect(currentRecipients([U1], [{ userId: U1, role: "something_new" }])).toEqual([]);
  });

  it("only the eight staff roles lectual 0056 lets insert a notification can be recipients", () => {
    expect([...ALERT_RECIPIENT_ROLES].sort()).toEqual(["admin", "attorney", "clerk", "intake", "law_clerk", "owner", "paralegal", "senior_admin"]);
    expect(canReceiveDeadlineAlerts("viewer")).toBe(false);
    expect(canReceiveDeadlineAlerts("social_media")).toBe(false);
  });

  it("recipient / non-recipient / unreadable list are three answers", () => {
    expect(isRecipient({ status: "ok", userIds: [U1] }, U1)).toBe(true);
    expect(isRecipient({ status: "ok", userIds: [U1] }, U2)).toBe(false);
    expect(isRecipient({ status: "unavailable" }, U1)).toBe(null);
  });
});

describe("AT3a: ONE bell notice per deadline per window (30, 7)", () => {
  const list = [dl("a", "2026-11-25"), dl("b", "2026-12-10"), dl("c", "2027-02-01"), dl("d", "2026-11-01")];

  it("raises the 7-day notice for a deadline 5 days out and the 30-day notice for one 20 days out; none for far or overdue", () => {
    const plans = noticesToRaise(list, TODAY, new Set());
    expect(plans.map((p) => `${p.deadlineId}:${p.window}`)).toEqual(["a:7", "b:30"]);
  });

  it("a notice already raised (read back from the recipient's own bell) is not raised again", () => {
    const raised = raisedKeys([noticePayload({ deadlineId: "a", matterId: "m-a", window: 7, title: "x" }), noticePayload({ deadlineId: "b", matterId: "m-b", window: 30, title: "x" })]);
    expect(noticesToRaise(list, TODAY, raised)).toEqual([]);
  });

  it("the same deadline gets its 7-day notice once it moves into that window, after its 30-day one", () => {
    const raised = raisedKeys([noticePayload({ deadlineId: "b", matterId: "m-b", window: 30, title: "x" })]);
    expect(noticesToRaise(list, "2026-12-04", raised).map((p) => `${p.deadlineId}:${p.window}`)).toEqual(["b:7"]);
  });

  it("an unreadable de-dupe read raises NOTHING (never a flood)", () => {
    expect(noticesToRaise(list, TODAY, null)).toEqual([]);
  });

  it("the payload carries ids, the window and the deadline title only", () => {
    expect(Object.keys(noticePayload({ deadlineId: "a", matterId: "m-a", window: 7, title: "Office action" })).sort()).toEqual(["deadline_id", "source", "title", "window"]);
  });

  it("the bell reads it as a deadline notice linking to the matter", () => {
    const d = describeNotification({ kind: "mentioned", matter_id: "44444444-4444-4444-8444-444444444444", payload: { source: "deadline_window", deadline_id: "a", window: 7, title: "Office action response" } });
    expect(d.label).toBe("Deadline");
    expect(d.sentence).toBe("Office action response is due within 7 days");
    expect(d.href).toBe("/dashboard/matters/44444444-4444-4444-8444-444444444444/");
  });
});

describe("AT3: Today's Deadlines card", () => {
  const groups = deadlineCardGroups(
    [dl("m30", "2026-12-15"), dl("w7", "2026-11-24", { confirmed: false }), dl("od", "2026-11-10"), dl("w7b", "2026-11-21")],
    TODAY,
  );

  it("groups overdue first, then due in 7 days, then due in 8..30", () => {
    expect(groups.overdue.map((d) => d.id)).toEqual(["od"]);
    expect(groups.week.map((d) => d.id)).toEqual(["w7b", "w7"]);
    expect(groups.month.map((d) => d.id)).toEqual(["m30"]);
  });

  it("draws overdue above due-in-7 above due-in-30, each unconfirmed one labelled", () => {
    const html = text(renderToStaticMarkup(<DeadlineAlertsView recipients={{ status: "ok", userIds: [U1] }} viewerId={U1} groups={groups} />));
    const at = (s: string) => html.indexOf(s);
    expect(at('data-group="overdue"')).toBeGreaterThan(-1);
    expect(at('data-group="overdue"')).toBeLessThan(at('data-group="week"'));
    expect(at('data-group="week"')).toBeLessThan(at('data-group="month"'));
    const w7 = html.slice(at('data-deadline="w7"'), at('data-deadline="w7"') + 600);
    expect(w7).toContain("Unconfirmed");
    const m30 = html.slice(at('data-deadline="m30"'), at('data-deadline="m30"') + 600);
    expect(m30).not.toContain("Unconfirmed");
  });

  it("a failed deadlines read is 'Couldn't load', never 'No deadlines'", () => {
    const html = text(renderToStaticMarkup(<DeadlineAlertsView recipients={{ status: "ok", userIds: [U1] }} viewerId={U1} groups={null} />));
    expect(html).toContain("Couldn't load");
    expect(html).not.toContain("No open deadlines");
  });

  it("an ok read with nothing in 30 days says so", () => {
    const html = text(renderToStaticMarkup(<DeadlineAlertsView recipients={{ status: "ok", userIds: [U1] }} viewerId={U1} groups={{ overdue: [], week: [], month: [] }} />));
    expect(html).toContain("No open deadlines in the next 30 days.");
  });

  it("AT3a: a non-recipient gets no card", () => {
    expect(renderToStaticMarkup(<DeadlineAlertsView recipients={{ status: "ok", userIds: [U1] }} viewerId={U2} groups={groups} />)).toBe("");
  });

  it("AT3a: an unreadable recipient list says the alerts couldn't be checked (never 'no alerts')", () => {
    const html = text(renderToStaticMarkup(<DeadlineAlertsView recipients={{ status: "unavailable" }} viewerId={U1} groups={null} />));
    expect(html).toContain("Deadline alerts couldn't be checked.");
    expect(html).not.toContain("No open deadlines");
  });
});

// ── the store: raising the recipient's own notices through the scoped client ──
const store = vi.hoisted(() => ({ readError: null as unknown, raised: [] as unknown[], notified: [] as unknown[], filters: [] as unknown[][], batches: 0 }));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: (...a: unknown[]) => (store.filters.push(["eq", ...a]), q),
        in: (...a: unknown[]) => (store.filters.push(["in", ...a]), q),
        limit: () => Promise.resolve({ data: store.readError ? null : store.raised.map((payload) => ({ payload })), error: store.readError }),
      };
      return q;
    },
  })),
}));
vi.mock("@/lib/notifications/core", () => ({
  notifyOwnMany: vi.fn(async (userId: string, items: Array<{ kind: string; matterId: string; payload: unknown }>) => {
    store.batches += 1;
    for (const i of items) store.notified.push({ userId, kind: i.kind, matterId: i.matterId, actorId: null, payload: i.payload });
    return items.length;
  }),
}));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
vi.mock("@/lib/brain/entries", () => ({ createBrainEntry: vi.fn(), updateBrainEntry: vi.fn() }));

describe("AT3a: raiseOwnDeadlineNotices (the recipient's own bell, scoped client)", () => {
  beforeEach(() => {
    store.readError = null;
    store.raised = [];
    store.notified = [];
    store.filters = [];
    store.batches = 0;
  });

  it("raises each new window once, for the signed-in recipient only, in ONE batched insert", async () => {
    const { raiseOwnDeadlineNotices } = await import("@/lib/today/deadline-alerts-store");
    const n = await raiseOwnDeadlineNotices(U1, [dl("a", "2026-11-25"), dl("b", "2026-12-10")], TODAY);
    expect(n).toBe(2);
    expect(store.notified).toEqual([
      { userId: U1, kind: "mentioned", matterId: "m-a", actorId: null, payload: { source: "deadline_window", deadline_id: "a", window: 7, title: "Deadline a" } },
      { userId: U1, kind: "mentioned", matterId: "m-b", actorId: null, payload: { source: "deadline_window", deadline_id: "b", window: 30, title: "Deadline b" } },
    ]);
    expect(store.filters).toContainEqual(["eq", "payload->>source", "deadline_window"]);
    expect(store.batches).toBe(1);
  });

  it("a second load the same day raises nothing (read back from the bell)", async () => {
    const { raiseOwnDeadlineNotices } = await import("@/lib/today/deadline-alerts-store");
    store.raised = [{ source: "deadline_window", deadline_id: "a", window: 7 }, { source: "deadline_window", deadline_id: "b", window: 30 }];
    expect(await raiseOwnDeadlineNotices(U1, [dl("a", "2026-11-25"), dl("b", "2026-12-10")], TODAY)).toBe(0);
    expect(store.notified).toEqual([]);
  });

  it("a failed de-dupe read sends no notice", async () => {
    const { raiseOwnDeadlineNotices } = await import("@/lib/today/deadline-alerts-store");
    store.readError = { code: "57014" };
    expect(await raiseOwnDeadlineNotices(U1, [dl("a", "2026-11-25")], TODAY)).toBe(0);
    expect(store.notified).toEqual([]);
  });
});

// ── review item 4: old overdue rows never push the 7- and 30-day rows out ──
describe("loadAlertDeadlines: two reads, and a cut-short state in words", () => {
  type Row = { id: string; matter_id: string; kind: string; title: string | null; due_date: string; status: string; attorney_confirmed: boolean; source: string; crm_matter: null };
  const mk = (id: string, due: string): Row => ({ id, matter_id: `m-${id}`, kind: "office_action_response", title: null, due_date: due, status: "open", attorney_confirmed: true, source: "calculated", crm_matter: null });

  async function load(all: Row[]) {
    vi.resetModules();
    vi.doMock("@/lib/db/scoped-client", () => ({
      getScopedClient: vi.fn(async () => ({
        from: () => {
          const f: { gte?: string; lte?: string; lt?: string; asc: boolean; from: number; to: number; limit?: number } = { asc: true, from: 0, to: 1e9 };
          const q = {
            select: () => q,
            eq: () => q,
            gte: (_c: string, v: string) => ((f.gte = v), q),
            lte: (_c: string, v: string) => ((f.lte = v), q),
            lt: (_c: string, v: string) => ((f.lt = v), q),
            order: (c: string, o: { ascending: boolean }) => (c === "due_date" ? (f.asc = o.ascending) : null, q),
            range: (a: number, b: number) => ((f.from = a), (f.to = b), q),
            limit: (n: number) => ((f.limit = n), q),
            then: (res: (v: unknown) => unknown) => {
              let rows = all.filter((r) => (!f.gte || r.due_date >= f.gte) && (!f.lte || r.due_date <= f.lte) && (!f.lt || r.due_date < f.lt));
              rows = [...rows].sort((a, b) => (f.asc ? 1 : -1) * a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
              rows = f.limit !== undefined ? rows.slice(0, f.limit) : rows.slice(f.from, f.to + 1);
              return Promise.resolve({ data: rows, error: null }).then(res);
            },
          };
          return q;
        },
      })),
    }));
    const { loadAlertDeadlines } = await import("@/lib/today/deadline-alerts-store");
    return loadAlertDeadlines(TODAY, "2026-12-20");
  }

  it("with more than 500 old overdue rows, every 7- and 30-day row is still read, and the cut is reported", async () => {
    const overdue = Array.from({ length: 600 }, (_, i) => mk(`o${String(i).padStart(3, "0")}`, `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}`));
    const upcoming = [mk("w1", "2026-11-22"), mk("w2", "2026-11-27"), mk("t1", "2026-12-15")];
    const read = await load([...overdue, ...upcoming]);
    expect(read).not.toBeNull();
    const ids = read!.deadlines.map((d) => d.id);
    for (const id of ["w1", "w2", "t1"]) expect(ids).toContain(id);
    expect(read!.cutShort.overdue).toBe(true);
    expect(read!.cutShort.upcoming).toBe(false);
    const groups = deadlineCardGroups(read!.deadlines, TODAY);
    expect(groups.week.map((d) => d.id)).toEqual(["w1", "w2"]);
    expect(groups.month.map((d) => d.id)).toEqual(["t1"]);
  });

  it("the card says the list was cut short, in words, with a calendar link", () => {
    const html = text(renderToStaticMarkup(<DeadlineAlertsView recipients={{ status: "ok", userIds: [U1] }} viewerId={U1} groups={{ overdue: [], week: [dl("w1", "2026-11-22")], month: [] }} cutShort />));
    expect(html).toContain("Not every deadline could be listed here.");
    expect(html).toContain('href="/dashboard/calendar/"');
  });

  it("'and N more' no longer claims a calendar it doesn't link to", () => {
    const many = Array.from({ length: 10 }, (_, i) => dl(`x${i}`, "2026-11-22"));
    const html = text(renderToStaticMarkup(<DeadlineAlertsView recipients={{ status: "ok", userIds: [U1] }} viewerId={U1} groups={{ overdue: [], week: many, month: [] }} />));
    expect(html).toContain("and 2 more");
    expect(html).not.toContain("on the calendar");
  });
});
