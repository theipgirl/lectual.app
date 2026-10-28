import { describe, it, expect } from "vitest";
import { buildRunDigest, failureAction, triageHotCount, type DigestRun } from "@/lib/agents/digest";

const NOW = new Date("2026-09-29T12:00:00Z");
const run = (p: Partial<DigestRun> & Pick<DigestRun, "agent">): DigestRun => ({
  status: "ok",
  started_at: "2026-09-29T10:00:00Z",
  items_in: 0,
  drafts_out: 0,
  summary: null,
  error: null,
  ...p,
});

describe("buildRunDigest", () => {
  it("says the log couldn't be read, never 'nothing ran'", () => {
    expect(buildRunDigest(null, NOW)).toEqual({ status: "unavailable" });
  });

  it("phrases each agent from its own counts and summaries, totalled across runs", () => {
    const d = buildRunDigest(
      [
        run({ agent: "intake-triage", items_in: 7, drafts_out: 2, summary: "7 lead(s) scored, 2 hot." }),
        run({ agent: "intake-triage", items_in: 5, drafts_out: 1, summary: "5 lead(s) scored, 1 hot.", started_at: "2026-09-29T06:00:00Z" }),
        run({ agent: "email-intel", items_in: 6, drafts_out: 1, summary: "6 email(s) read, 4 record(s) filled in." }),
        run({ agent: "post-consult", items_in: 2, drafts_out: 2, summary: "2 follow-up email(s) drafted for approval." }),
      ],
      NOW,
    );
    if (d.status !== "ok") throw new Error("expected ok");
    const text = Object.fromEntries(d.lines.map((l) => [l.agent, l.text]));
    expect(text["intake-triage"]).toBe("screened 12 new leads · 3 hot, need your review · 3 briefings in Approvals");
    expect(text["email-intel"]).toBe("read 6 client emails · filled in 4 client records · 1 legal question flagged for the attorney (in Approvals)");
    expect(text["post-consult"]).toBe("drafted 2 follow-ups (in Approvals)");
    expect(d.failures).toEqual([]);
    expect(d.runs).toBe(4);
    expect(d.lastRunAt).toBe("2026-09-29T10:00:00Z");
  });

  it("leaves a clause out rather than invent it when a summary isn't in the known shape", () => {
    const d = buildRunDigest([run({ agent: "intake-triage", items_in: 3, summary: "something else" })], NOW);
    if (d.status !== "ok") throw new Error();
    expect(d.lines[0].text).toBe("screened 3 new leads");
  });

  it("reports a failure only while it is the agent's latest run, with what to do", () => {
    const d = buildRunDigest(
      [
        run({ agent: "email-intel", status: "error", error: "Access to this mailbox was withdrawn. Reconnect to resume syncing.", started_at: "2026-09-29T11:00:00Z" }),
        run({ agent: "email-intel", items_in: 1, summary: "1 email(s) read, 0 record(s) filled in.", started_at: "2026-09-29T05:00:00Z" }),
        run({ agent: "post-consult", status: "error", error: "boom", started_at: "2026-09-29T04:00:00Z" }),
        run({ agent: "post-consult", items_in: 0, summary: "No new consult notes.", started_at: "2026-09-29T09:00:00Z" }),
      ],
      NOW,
    );
    if (d.status !== "ok") throw new Error();
    expect(d.failures.map((f) => f.agent)).toEqual(["email-intel"]);
    expect(d.failures[0]).toMatchObject({
      text: "From their emails couldn't finish its last run",
      reason: "A mailbox needs to be reconnected. Reconnect it in Settings, then try again.",
      action: { label: "Reconnect the mailbox", href: "/dashboard/settings/mailboxes/" },
    });
  });

  it("ignores runs outside the window and mailbox-sync rows", () => {
    const d = buildRunDigest(
      [run({ agent: "intake-triage", items_in: 9, started_at: "2026-09-27T10:00:00Z" }), run({ agent: "mailbox-sync", items_in: 40 })],
      NOW,
    );
    if (d.status !== "ok") throw new Error();
    expect(d.lines).toEqual([]);
    expect(d.runs).toBe(0);
  });

  it("shows a skipped run's reason", () => {
    const d = buildRunDigest([run({ agent: "post-consult", status: "skipped", summary: "No approval queue is connected for this firm, so no client email was drafted." })], NOW);
    if (d.status !== "ok") throw new Error();
    expect(d.lines[0].text).toMatch(/^didn't run: No approval queue/);
  });
});

describe("digest helpers", () => {
  it("parses the triage hot count or admits it can't", () => {
    expect(triageHotCount("4 lead(s) scored, 0 hot.")).toBe(0);
    expect(triageHotCount("No new leads to score.")).toBeNull();
  });
  it("maps failures to an action", () => {
    expect(failureAction("model overloaded (529)").label).toBe("Try Run now later");
    expect(failureAction("lead read failed: x")).toEqual({ label: "Lectual has been told and is looking into it.", href: null });
  });
});

describe("buildRunDigest: the Stage Keeper (Sprint 16, F16)", () => {
  const d = (runs: DigestRun[]) => {
    const out = buildRunDigest(runs, NOW);
    if (out.status !== "ok") throw new Error("expected ok");
    return out;
  };

  it("moves are items minus cards, and the line links to the filtered board", () => {
    const line = d([run({ agent: "stage-keeper", items_in: 4, drafts_out: 1, summary: "counts" })]).lines[0];
    expect(line).toMatchObject({
      agent: "stage-keeper",
      name: "Automatic stage moves",
      text: "moved 3 leads · 1 suggestion waiting on the lead page",
      tone: "attention",
      href: "/dashboard/intake/?view=board&agent=today",
    });
  });

  it("singular and plural, moves alone, cards alone, and nothing to place", () => {
    expect(d([run({ agent: "stage-keeper", items_in: 1, drafts_out: 0 })]).lines[0]).toMatchObject({ text: "moved 1 lead", tone: "ok" });
    expect(d([run({ agent: "stage-keeper", items_in: 2, drafts_out: 2 })]).lines[0].text).toBe("2 suggestions waiting on the lead page");
    expect(d([run({ agent: "stage-keeper", items_in: 0 })]).lines[0]).toMatchObject({ text: "found no lead to place", tone: "quiet" });
  });

  it("a failed run Lectual must fix says Lectual has been told, with no link", () => {
    const out = d([run({ agent: "stage-keeper", status: "error", error: "3 lead move(s) failed. 3 lead(s) read: 0 moved." })]);
    expect(out.failures[0]).toMatchObject({ agent: "stage-keeper", text: "Automatic stage moves couldn't finish its last run", action: { label: "Lectual has been told and is looking into it.", href: null } });
  });
});
