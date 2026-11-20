import { describe, expect, it, vi } from "vitest";
import { checkClose, runCloseOverride, OVERRIDE_NOT_RECORDED, OVERRIDE_ROLE_REFUSAL, type OverrideDeps } from "@/lib/matters/close-guard";
import { CLOSE_OVERRIDE_UNRECORDED } from "@/lib/ui/words";
import { CLOSE_GUARD_UNREADABLE } from "@/lib/matters/deadline-safety";

const oa = { id: "d1", kind: "office_action_response", title: null, due_date: "2026-12-01", status: "open" };

function deps(over: Partial<OverrideDeps> & { type?: string; status?: string; open?: typeof oa[] | null } = {}) {
  const log: string[] = [];
  const d: OverrideDeps = {
    readMatter: vi.fn(async () => {
      log.push("readMatter");
      return { status: "ok" as const, matter: { type: over.type ?? "TM", status: over.status ?? "open" } };
    }),
    readOpenDeadlines: vi.fn(async () => {
      log.push("readDeadlines");
      return over.open === undefined ? [oa] : over.open;
    }),
    role: vi.fn(async () => "attorney"),
    callOverride: vi.fn(async () => {
      log.push("override");
      return "done" as const;
    }),
    closeDirect: vi.fn(async () => {
      log.push("close");
      return true;
    }),
    restoreStatus: vi.fn(async (prev: string) => {
      log.push(`restore:${prev}`);
      return true;
    }),
    reportUnrecorded: vi.fn(() => {
      log.push("reported");
    }),
    logOverride: vi.fn(async () => {
      log.push("timeline");
      return true;
    }),
    ...over,
  };
  return { d, log };
}

describe("AT4: closing a matter with an open USPTO-kind deadline is refused (app check)", () => {
  it("returns the fixed refusal naming the deadline", async () => {
    const { d } = deps();
    const res = await checkClose(d);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Office Action response (due 2026-12-01)");
  });

  it("allowed when the only deadlines are closed out (none open)", async () => {
    const { d } = deps({ open: [] });
    expect((await checkClose(d)).ok).toBe(true);
  });

  it("a failed deadlines read refuses the close ('couldn't check'), never allows it", async () => {
    const { d } = deps({ open: null });
    expect(await checkClose(d)).toEqual({ ok: false, error: CLOSE_GUARD_UNREADABLE });
    const { d: d2 } = deps({ readOpenDeadlines: vi.fn(async () => Promise.reject(new Error("db text"))) });
    expect(await checkClose(d2)).toEqual({ ok: false, error: CLOSE_GUARD_UNREADABLE });
  });

  it("a matter the caller can't see is 'not found'", async () => {
    const { d } = deps({ readMatter: vi.fn(async () => ({ status: "missing" as const })) });
    const res = await checkClose(d);
    expect(res.ok).toBe(false);
  });
});

describe("AT5: the override needs an override role and a reason, and records one override and one timeline entry", () => {
  it("a paralegal posting the override form is refused before ANY read or write", async () => {
    const { d, log } = deps({ role: vi.fn(async () => "paralegal") });
    expect(await runCloseOverride("Client asked us to stop", d)).toEqual({ ok: false, error: OVERRIDE_ROLE_REFUSAL });
    expect(log).toEqual([]);
  });

  it("an unreadable role is refused too", async () => {
    const { d, log } = deps({ role: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect((await runCloseOverride("Reason", d)).ok).toBe(false);
    expect(log).toEqual([]);
  });

  it("no reason, or one over 300 characters: refused, nothing written", async () => {
    for (const reason of ["", "   ", "x".repeat(301)]) {
      const { d, log } = deps();
      expect((await runCloseOverride(reason, d)).ok).toBe(false);
      expect(log).toEqual([]);
    }
  });

  it("with lectual 0110: one override call (row + close in one transaction), then ONE timeline entry", async () => {
    const { d, log } = deps();
    expect(await runCloseOverride("Registered; renewal handled by new counsel", d)).toEqual({ ok: true, overridden: true });
    expect(log).toEqual(["readMatter", "readDeadlines", "override", "timeline"]);
    expect(d.callOverride).toHaveBeenCalledTimes(1);
    expect(d.closeDirect).not.toHaveBeenCalled();
    expect(d.logOverride).toHaveBeenCalledTimes(1);
    expect(d.logOverride).toHaveBeenCalledWith({ reason: "Registered; renewal handled by new counsel", deadline_ids: ["d1"], from_status: "open", recorded: "override_row" });
  });

  it("before 0110 (function missing): the close, then the timeline entry, which is the record", async () => {
    const { d, log } = deps({ callOverride: vi.fn(async () => "missing" as const) });
    expect(await runCloseOverride("Reason", d)).toEqual({ ok: true, overridden: true });
    expect(log).toEqual(["readMatter", "readDeadlines", "close", "timeline"]);
    expect(d.logOverride).toHaveBeenCalledWith(expect.objectContaining({ recorded: "timeline" }));
  });

  it("before 0110, a timeline entry that fails puts the status back: never closed past the guard without a recorded reason", async () => {
    const { d, log } = deps({ callOverride: vi.fn(async () => "missing" as const), logOverride: vi.fn(async () => false) });
    expect(await runCloseOverride("Reason", d)).toEqual({ ok: false, error: OVERRIDE_NOT_RECORDED });
    expect(log).toEqual(["readMatter", "readDeadlines", "close", "restore:open"]);
  });

  it("before 0110, a failed timeline entry AND a failed restore: the distinct 'closed, reason not recorded' sentence, reported once", async () => {
    for (const restore of [vi.fn(async () => false), vi.fn(async () => Promise.reject(new Error("db")))]) {
      const { d, log } = deps({ callOverride: vi.fn(async () => "missing" as const), logOverride: vi.fn(async () => false), restoreStatus: restore });
      expect(await runCloseOverride("Reason", d)).toEqual({ ok: false, error: CLOSE_OVERRIDE_UNRECORDED });
      expect(CLOSE_OVERRIDE_UNRECORDED).toBe("The matter was closed, but the reason couldn't be recorded. Tell Lectual.");
      expect(d.reportUnrecorded).toHaveBeenCalledTimes(1);
      expect(log).toContain("reported");
    }
  });

  it("the database refusing the caller (42501) is the role refusal; nothing else is written", async () => {
    const { d, log } = deps({ callOverride: vi.fn(async () => "forbidden" as const) });
    expect(await runCloseOverride("Reason", d)).toEqual({ ok: false, error: OVERRIDE_ROLE_REFUSAL });
    expect(log).not.toContain("timeline");
    expect(log).not.toContain("close");
  });

  it("with no guarded deadline left it is a plain close, and no override is recorded", async () => {
    const { d, log } = deps({ open: [] });
    expect(await runCloseOverride("Reason", d)).toEqual({ ok: true, overridden: false });
    expect(log).toEqual(["readMatter", "readDeadlines", "close"]);
  });

  it("a failed deadlines read refuses the override too", async () => {
    const { d } = deps({ open: null });
    expect(await runCloseOverride("Reason", d)).toEqual({ ok: false, error: CLOSE_GUARD_UNREADABLE });
  });
});
