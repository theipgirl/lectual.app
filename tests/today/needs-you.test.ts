import { describe, it, expect } from "vitest";
import { buildNeedsYou, emptyNeedsYouNote, type NeedsYouInput } from "@/lib/today/needs-you";

const NOW = new Date("2026-09-29T12:00:00Z");
const ME = "user-me";
const base: NeedsYouInput = {
  userId: ME,
  now: NOW,
  deadlines: [],
  tasks: [],
  queue: { status: "ok", items: [] },
  quotes: [],
  payments: [],
  agentFailures: [],
  connections: [],
  submissions: [],
  hotLeads: [],
  stalled: [],
};

describe("buildNeedsYou", () => {
  it("phrases every signal as the next action with one link, and says who it is for", () => {
    const out = buildNeedsYou({
      ...base,
      deadlines: [
        { id: "d1", matterId: "m1", name: "Office action response", dueDate: "2026-10-04", confirmed: false, matterRef: "TM-1", ownerId: ME },
        { id: "d2", matterId: "m2", name: "Statement of use", dueDate: "2026-09-26", confirmed: true, matterRef: "TM-2", ownerId: "other" },
        { id: "d3", matterId: "m3", name: "Renewal", dueDate: "2027-01-01", confirmed: false, matterRef: "TM-3", ownerId: ME },
      ],
      queue: { status: "ok", items: [{ id: "q1", headline: "Follow-up to Blue Fern", client_name: "Blue Fern", created_at: "2026-09-29T08:00:00Z" }] },
      quotes: [
        { id: "qa", title: "Trademark package", status: "accepted", expiresAt: null, acceptedAt: "2026-09-20T00:00:00Z", clientName: "Orchid Co", createdBy: ME },
        { id: "qb", title: "Trademark package", status: "accepted", expiresAt: null, acceptedAt: "2026-09-20T00:00:00Z", clientName: "Paid Co", createdBy: ME },
        { id: "qc", title: "Search", status: "sent", expiresAt: "2026-10-02T12:00:00Z", acceptedAt: null, clientName: "Slow Co", createdBy: "other" },
        { id: "qd", title: "Search", status: "sent", expiresAt: "2026-12-01T00:00:00Z", acceptedAt: null, clientName: "Later Co", createdBy: "other" },
      ],
      payments: [{ quoteId: "qb", purpose: "legal_fee", status: "succeeded" }],
      agentFailures: [
        { agent: "email-intel", name: "Email → client intel", text: "x", reason: "Access withdrawn.", action: { label: "Reconnect the mailbox", href: "/dashboard/settings/mailboxes/" }, at: "2026-09-29T06:00:00Z" },
      ],
      connections: [
        { key: "mail-1", service: "mailbox", label: "Your mailbox me@firm.com", ownerId: ME, href: "/dashboard/settings/mailboxes/" },
        { key: "lp-1", service: "lawpay", label: "LawPay", ownerId: null, href: "/dashboard/settings/integrations/lawpay/" },
      ],
      submissions: [{ id: "s1", name: "Sam Lee", submittedAt: "2026-09-29T09:00:00Z" }],
    });
    const byKey = Object.fromEntries(out.items.map((i) => [i.key, i]));
    expect(byKey["d-d1"]).toMatchObject({ action: "Deadline in 5 days. Confirm the date", forYou: true, href: "/dashboard/matters/m1/" });
    expect(byKey["d-d2"]).toMatchObject({ kind: "deadline-overdue", forYou: false });
    expect(byKey["d-d3"]).toBeUndefined();
    expect(byKey["q-q1"]).toMatchObject({ action: "Draft waiting for your approval", href: "/dashboard/queue/q1/" });
    expect(byKey["qp-qa"]).toMatchObject({ action: "Quote signed. Record the payment", subject: "Orchid Co", forYou: true });
    expect(byKey["qp-qb"]).toBeUndefined();
    expect(byKey["qx-qc"]).toMatchObject({ kind: "quote-expiring", action: "Quote expires in 3 days, not signed yet. Follow up with the client" });
    expect(byKey["qx-qd"]).toBeUndefined();
    expect(byKey["af-email-intel"]).toMatchObject({ action: "Agent couldn't finish. Reconnect the mailbox", href: "/dashboard/settings/mailboxes/" });
    expect(byKey["rc-mail-1"]).toMatchObject({ forYou: true, cta: "Reconnect" });
    expect(byKey["rc-lp-1"].detail).toMatch(/Card payments are paused/);
    expect(byKey["sub-s1"]).toMatchObject({ kind: "intake-review" });
    expect(out.items[0].key).toBe("d-d2"); // overdue first
    expect(out.unavailable).toEqual([]);
    for (const i of out.items) expect(i.href).toMatch(/^\//);
  });

  it("an unreachable queue is an item, never an empty list; an unconfigured queue is silent", () => {
    const down = buildNeedsYou({ ...base, queue: { status: "unavailable" } });
    expect(down.items.map((i) => i.kind)).toEqual(["queue-unreachable"]);
    const none = buildNeedsYou({ ...base, queue: { status: "unconfigured" } });
    expect(none.items).toEqual([]);
    expect(emptyNeedsYouNote(none, "unconfigured")).toMatch(/No approval queue is connected/);
  });

  it("names every source it couldn't read, and makes no payment claim without payment rows", () => {
    const out = buildNeedsYou({
      ...base,
      deadlines: null,
      tasks: null,
      quotes: [{ id: "qa", title: "T", status: "accepted", expiresAt: null, acceptedAt: "2026-09-20T00:00:00Z", clientName: "X", createdBy: null }],
      payments: null,
      agentFailures: null,
      connections: null,
      submissions: null,
      stalled: null,
    });
    expect(out.items).toEqual([]);
    expect(out.unavailable).toEqual(["deadlines", "tasks", "payments", "agent runs", "connections", "intake submissions", "matters"]);
    expect(emptyNeedsYouNote(out, "ok")).toMatch(/couldn't be read/);
  });

  it("keeps the old Top-of-the-list kinds: tasks, hot leads, quiet matters", () => {
    const out = buildNeedsYou({
      ...base,
      tasks: [{ id: "t1", title: "Call client", dueDate: "2026-09-27", href: "/dashboard/leads/l/", assigneeId: ME }],
      hotLeads: [{ id: "l1", name: "Amara", reason: "Ready to file" }],
      stalled: [{ id: "m9", label: "ORCHID", matterNumber: "TM-9", stageCode: "15", stageLabel: "Client review", waitingOn: "client", daysInStage: 30, daysOverThreshold: 9 }],
    });
    expect(out.items.map((i) => i.kind)).toEqual(["task", "hot-lead", "quiet-matter"]);
    expect(out.items[0]).toMatchObject({ forYou: true, action: "Task overdue since 2 days ago. Finish it or move the date" });
  });

  it("rolls many unreviewed submissions into one item", () => {
    const subs = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `N${i}`, submittedAt: "2026-09-29T00:00:00Z" }));
    const out = buildNeedsYou({ ...base, submissions: subs });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].action).toBe("5 new intake submissions to review");
  });
});
