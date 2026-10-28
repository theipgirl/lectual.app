import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { nextConfirm } from "@/lib/ui/inline-confirm";
import { DISMISS_CAP, DISMISS_NOTE, dismissStale, dismissableFollowups } from "@/lib/queue/dismiss";
import { followup, qitem, U } from "./routing-fixtures";

const state = vi.hoisted(() => ({
  load: { status: "ok", items: [] as unknown[] } as { status: string; items: unknown[] },
  role: "attorney" as string,
  resolve: vi.fn(),
  routed: { status: "ok", routing: {}, members: [] } as unknown,
}));

const NOW = Date.parse("2026-10-28T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const rebecca = { userId: U.rebecca, role: "attorney" as const };
const caitlyn = { userId: U.caitlyn, role: "paralegal" as const };

describe("which follow-ups may be dismissed", () => {
  it("age: 7.1 days yes, 6.9 days no", () => {
    const items = [followup({ id: "old", created_at: ago(7.1) }), followup({ id: "new", created_at: ago(6.9) })];
    expect(dismissableFollowups(items, { routing: {}, viewer: rebecca, now: NOW }).map((i) => i.id)).toEqual(["old"]);
  });

  it("only stalled follow-ups: every other kind is left alone", () => {
    const stale = ago(30);
    const others = [
      qitem({ id: "pc", created_at: stale }),
      qitem({ id: "w", created_at: stale, agent: "welcome-client", headline: "Welcome" }),
      qitem({ id: "b", created_at: stale, type: "BRIEFING", agent: "morning-brief", headline: "Morning brief" }),
      qitem({ id: "e", created_at: stale, type: "ENGAGEMENT_LETTER", agent: "document-center" }),
      qitem({ id: "o", created_at: stale, type: "OPINION_LETTER", agent: "document-center" }),
      qitem({ id: "pa", created_at: stale, agent: "staff", headline: "Partnership follow-up" }),
    ];
    expect(dismissableFollowups([...others, followup({ id: "f", created_at: stale })], { routing: {}, viewer: rebecca, now: NOW }).map((i) => i.id)).toEqual(["f"]);
  });

  it("a follow-up that reads as legal advice, and one that is not pending, are left alone", () => {
    const items = [followup({ id: "adv", created_at: ago(9), draft_body: "You should file now." }), followup({ id: "done", created_at: ago(9), status: "approved" })];
    expect(dismissableFollowups(items, { routing: {}, viewer: rebecca, now: NOW })).toEqual([]);
  });

  it("owner vs admin: a routed follow-up is dismissable by its owner and the admin tier only", () => {
    const items = [followup({ id: "f", created_at: ago(9) })];
    const routing = { stalled_followup: U.caitlyn };
    expect(dismissableFollowups(items, { routing, viewer: caitlyn, now: NOW })).toHaveLength(1);
    expect(dismissableFollowups(items, { routing, viewer: rebecca, now: NOW })).toHaveLength(0);
    expect(dismissableFollowups(items, { routing, viewer: { userId: U.taylor, role: "owner" }, now: NOW })).toHaveLength(1);
    expect(dismissableFollowups(items, { routing, viewer: { userId: U.viewer, role: "viewer" }, now: NOW })).toHaveLength(0);
    expect(dismissableFollowups(items, { routing, viewer: null, now: NOW })).toHaveLength(0);
  });

  it("unrouted: a usual approver owns them, a paralegal does not", () => {
    const items = [followup({ id: "f", created_at: ago(9) })];
    expect(dismissableFollowups(items, { routing: {}, viewer: rebecca, now: NOW })).toHaveLength(1);
    expect(dismissableFollowups(items, { routing: {}, viewer: caitlyn, now: NOW })).toHaveLength(0);
  });
});

describe("dismissStale", () => {
  it("rejects each eligible item with the note", async () => {
    const reject = vi.fn(async () => undefined);
    const items = [followup({ id: "a", created_at: ago(8) }), followup({ id: "b", created_at: ago(9) }), followup({ id: "c", created_at: ago(1) })];
    const r = await dismissStale({ items, routing: {}, viewer: rebecca, now: NOW, reject });
    expect(r).toEqual({ attempted: 2, done: 2, failed: 0, remaining: 0 });
    expect(reject.mock.calls).toEqual([["a", DISMISS_NOTE], ["b", DISMISS_NOTE]]);
    expect(DISMISS_NOTE).toBe("Dismissed: follow-up older than 7 days");
  });

  it("one failure is counted and does not stop the rest", async () => {
    const reject = vi.fn(async (id: string) => {
      if (id === "a") throw new Error("boom");
    });
    const items = [followup({ id: "a", created_at: ago(8) }), followup({ id: "b", created_at: ago(8) })];
    expect(await dismissStale({ items, routing: {}, viewer: rebecca, now: NOW, reject })).toMatchObject({ done: 1, failed: 1 });
  });

  it("caps at 50 a click and says how many are left", async () => {
    const items = Array.from({ length: 60 }, (_, i) => followup({ id: `f${i}`, created_at: ago(8) }));
    const reject = vi.fn(async () => undefined);
    const r = await dismissStale({ items, routing: {}, viewer: rebecca, now: NOW, reject });
    expect(r).toEqual({ attempted: DISMISS_CAP, done: DISMISS_CAP, failed: 0, remaining: 10 });
  });

  it("a non-owner non-admin rejects nothing", async () => {
    const reject = vi.fn();
    const r = await dismissStale({ items: [followup({ created_at: ago(9) })], routing: { stalled_followup: U.caitlyn }, viewer: rebecca, now: NOW, reject });
    expect(r.attempted).toBe(0);
    expect(reject).not.toHaveBeenCalled();
  });
});

describe("dismissStaleFollowupsAction", () => {
  beforeEach(() => {
    vi.resetModules();
    state.resolve.mockReset().mockResolvedValue({ status: "rejected" });
    state.load = { status: "ok", items: [] };
    state.role = "attorney";
    state.routed = { status: "ok", routing: {}, members: [] };
  });

  async function action() {
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: U.rebecca, email: "rebecca@example.com" } } }) } }) }));
    vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: async () => "firm-key" }));
    vi.doMock("@/lib/queue/roles", async (orig) => ({ ...(await orig<object>()), resolveQueueRole: async () => state.role }));
    vi.doMock("@/lib/queue/api", () => ({ getQueueItem: vi.fn(), saveQueueEdit: vi.fn(), resolveQueueItem: (...a: unknown[]) => state.resolve(...a) }));
    vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: async () => state.load }));
    vi.doMock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: async () => state.routed }));
    for (const m of ["@/lib/documents/approve-hook", "@/lib/mailbox/my-mailbox", "@/lib/queue/stale", "@/components/queue/stale-warning", "@/lib/org/profile", "@/lib/consult-proposal/link", "@/lib/queue/hygiene", "@/lib/queue/audit-context"]) vi.doMock(m, () => ({}));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("next/navigation", () => ({ redirect: vi.fn() }));
    return (await import("@/app/dashboard/queue/actions")).dismissStaleFollowupsAction;
  }
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };

  it("rejects with the note and the session email, ignoring ids posted by the browser", async () => {
    vi.useFakeTimers().setSystemTime(NOW);
    state.load = { status: "ok", items: [followup({ id: "a", created_at: ago(9) }), followup({ id: "fresh", created_at: ago(1) }), qitem({ id: "pc", created_at: ago(20) })] };
    const run = await action();
    const r = await run({}, form({ confirm: "yes", id: "pc", ids: "pc,fresh" }));
    expect(r).toEqual({ message: "Dismissed 1 follow-up." });
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(state.resolve).toHaveBeenCalledWith({ orgKey: "firm-key", id: "a", action: "reject", resolvedBy: "rebecca@example.com", note: DISMISS_NOTE });
    vi.useRealTimers();
  });

  it("needs the confirm flag", async () => {
    const run = await action();
    expect((await run({}, form({}))).error).toMatch(/Confirm first/);
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("an unreadable queue is an error, never 'Nothing to dismiss'", async () => {
    state.load = { status: "unavailable", items: [] };
    const run = await action();
    const r = await run({}, form({ confirm: "yes" }));
    expect(r.error).toMatch(/can't be reached/);
    expect(r.message).toBeUndefined();
  });

  it("nothing eligible says so; partial failure names the counts", async () => {
    vi.useFakeTimers().setSystemTime(NOW);
    const run = await action();
    expect(await run({}, form({ confirm: "yes" }))).toEqual({ message: "Nothing to dismiss." });
    state.load = { status: "ok", items: [followup({ id: "a", created_at: ago(9) }), followup({ id: "b", created_at: ago(9) })] };
    state.resolve.mockRejectedValueOnce(new Error("x"));
    expect(await run({}, form({ confirm: "yes" }))).toEqual({ error: "Dismissed 1, 1 couldn't be dismissed. Refresh to try again." });
    vi.useRealTimers();
  });

  it("a viewer and a non-owner reject nothing", async () => {
    vi.useFakeTimers().setSystemTime(NOW);
    state.load = { status: "ok", items: [followup({ id: "a", created_at: ago(9) })] };
    state.routed = { status: "ok", routing: { stalled_followup: U.caitlyn }, members: [] };
    const run = await action();
    expect(await run({}, form({ confirm: "yes" }))).toEqual({ message: "Nothing to dismiss." });
    expect(state.resolve).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("the confirm UI", () => {
  it("Cancel never fires; only Confirm does", () => {
    expect(nextConfirm("asking", "cancel").fire).toBe(false);
    expect(nextConfirm("asking", "confirm").fire).toBe(true);
  });

  it("asking state shows the count, Dismiss and Cancel", async () => {
    vi.doMock("@/app/dashboard/queue/actions", () => ({ dismissStaleFollowupsAction: vi.fn() }));
    const { DismissFollowups } = await import("@/components/queue/DismissFollowups");
    const { createElement } = await import("react");
    const html = renderToStaticMarkup(createElement(DismissFollowups, { count: 14, initial: "asking" }));
    expect(html).toContain("Dismiss 14 follow-ups older than 7 days?");
    expect(html).toContain("Cancel");
    const idle = renderToStaticMarkup(createElement(DismissFollowups, { count: 14 }));
    expect(idle).toContain("Dismiss follow-ups older than 7 days");
    expect(idle).not.toContain("Cancel");
    expect(renderToStaticMarkup(createElement(DismissFollowups, { count: 1, initial: "asking" }))).toContain("Dismiss 1 follow-up older than 7 days?");
  });
});
