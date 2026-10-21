import { describe, expect, it } from "vitest";
import { buildFunnel, durationBetween, formatDuration, intakeDetail, intakeTableRows, medianOf, parseRange, percent, submissionStats, timingSplit } from "@/lib/intake-forms/performance";
import { parseAnswers, parseContact, submissionStatusLabel } from "@/lib/intake-forms/submission";

describe("funnel", () => {
  it("counts distinct sessions per step and splits starts by mode", () => {
    const f = buildFunnel([
      { kind: "visit", session_hash: "a" },
      { kind: "visit", session_hash: "a" },
      { kind: "visit", session_hash: "b" },
      { kind: "visit", session_hash: "c" },
      { kind: "visit", session_hash: null },
      { kind: "start_conversation", session_hash: "a" },
      { kind: "start_form", session_hash: "b" },
      { kind: "complete", session_hash: "a" },
      { kind: "unknown", session_hash: "z" },
    ]);
    expect(f).toMatchObject({ visited: 4, chat: 1, form: 1, started: 2, completed: 1 });
    expect(f.startRate).toBe("50.0%");
    expect(f.completeRate).toBe("50.0%");
  });

  it("shows a dash, not 0%, when there is nothing to divide by", () => {
    const f = buildFunnel([]);
    expect(f.visited).toBe(0);
    expect(f.startRate).toBe("—");
    expect(percent(1, 0)).toBe("—");
  });

  it("never shows fewer visits than starts", () => {
    expect(buildFunnel([{ kind: "start_form", session_hash: "x" }]).visited).toBe(1);
  });

  it("only accepts the design's ranges", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("365")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });
});

describe("intake rows", () => {
  const row = {
    id: "s1",
    mode: "conversation",
    contact: { name: "Nadia Petra", email: "nadia@maisonpetra.co", company: "Maison Petra" },
    fit: "fit",
    status: "consult_booked",
    started_at: "2026-09-25T12:04:00Z",
    last_active_at: "2026-09-27T11:48:00Z",
  };

  it("maps a submission to the design's table row, on the firm's clock", () => {
    const [r] = intakeTableRows([row], Date.parse("2026-09-27T12:00:00Z"));
    expect(r).toMatchObject({ name: "Nadia Petra", company: "Maison Petra", mode: "Chat", fit: "Fit", status: "Consult booked", last: "12 min ago" });
    expect(r.started).toBe("Sep 25, 8:04 AM");
  });

  it("degrades a malformed contact instead of throwing", () => {
    const [r] = intakeTableRows([{ ...row, contact: "garbage", fit: "weird", status: "stopped" }]);
    expect(r.name).toBe("No name given");
    expect(r.company).toBe("—");
    expect(r.fit).toBe("Unscored");
    expect(r.status).toBe("Stopped replying");
  });

  it("builds the drawer with contact first, then answers", () => {
    const d = intakeDetail({
      ...row,
      answers: [
        { id: "q1", question: "What name?", answer: "MAISON PETRA" },
        ["Used publicly?", "Yes, since March."],
      ],
      screening_note: "US trademark, two classes.",
      submitted_at: "2026-09-25T12:20:00Z",
    });
    expect(d.answers).toEqual([
      { q: "Contact", a: "Nadia Petra · nadia@maisonpetra.co" },
      { q: "What name?", a: "MAISON PETRA" },
      { q: "Used publicly?", a: "Yes, since March." },
    ]);
    expect(d.why).toBe("US trademark, two classes.");
    expect(d.modeLine).toBe("Chat · Sep 25, 8:04 AM");
    expect(intakeDetail({ ...row, answers: null, screening_note: null, submitted_at: null }).why).toBe("Not screened yet.");
  });
});

describe("submission shapes", () => {
  it("parses contact and answers leniently", () => {
    expect(parseContact({ full_name: " Sam ", email: 3 })).toEqual({ name: "Sam", email: "", phone: "", company: "" });
    expect(parseAnswers("x")).toEqual([]);
    expect(parseAnswers([{ q: "A", a: "B" }, 5, [], { question: "", answer: "" }])).toEqual([{ id: null, question: "A", answer: "B" }]);
    expect(submissionStatusLabel("new")).toBe("New");
  });
});

describe("time to finish, split in two (Sprint 9, F11)", () => {
  const t = (min: number, sec = 0) => new Date(Date.UTC(2026, 9, 18, 15, 0, sec) + min * 60_000).toISOString();

  it("takes the median of page → contact details over everyone, and contact details → finish over people who finished", () => {
    const rows = [
      { started_at: t(0), created_at: t(1), submitted_at: t(4) }, // 1 min, 3 min
      { started_at: t(0), created_at: t(3), submitted_at: t(5) }, // 3 min, 2 min
      { started_at: t(0), created_at: t(5), submitted_at: null }, // 5 min, did not finish
    ];
    expect(timingSplit(rows)).toEqual({ medianToContactMs: 3 * 60_000, medianContactToFinishMs: 150_000 });
  });

  it("uses the middle value for an odd count and the mean of the middle two for an even one", () => {
    const odd = [0, 2, 9].map((m) => ({ started_at: t(0), created_at: t(m), submitted_at: t(m + 1) }));
    expect(timingSplit(odd).medianToContactMs).toBe(2 * 60_000);
    const even = [1, 2, 4, 9].map((m) => ({ started_at: t(0), created_at: t(m), submitted_at: t(m + 1) }));
    expect(timingSplit(even).medianToContactMs).toBe(3 * 60_000);
    expect(timingSplit(even).medianContactToFinishMs).toBe(60_000);
  });

  it("ignores negative and unparseable durations", () => {
    const rows = [
      { started_at: t(5), created_at: t(1), submitted_at: t(0) }, // both negative
      { started_at: "nonsense", created_at: t(1), submitted_at: t(2) }, // first unparseable, second 1 min
      { started_at: t(0), created_at: t(2), submitted_at: t(4) }, // 2 min, 2 min
      { started_at: t(0), submitted_at: t(4) }, // no created_at: nothing to measure
    ];
    expect(timingSplit(rows)).toEqual({ medianToContactMs: 2 * 60_000, medianContactToFinishMs: 90_000 });
  });

  it("gives null (shown as a dash) when there is nothing to take a median of", () => {
    expect(timingSplit([])).toEqual({ medianToContactMs: null, medianContactToFinishMs: null });
    expect(timingSplit([{ started_at: t(0), created_at: t(1), submitted_at: null }])).toEqual({ medianToContactMs: 60_000, medianContactToFinishMs: null });
    expect(formatDuration(null)).toBe("—");
  });

  it("leaves the existing numbers alone", () => {
    const rows = [
      { started_at: t(0), created_at: t(1), submitted_at: t(4) },
      { started_at: t(0), created_at: t(1), submitted_at: null },
    ];
    expect(submissionStats(rows)).toMatchObject({ captured: 2, completed: 1, unfinished: 1, medianMs: 4 * 60_000, completionRate: "50.0%" });
    expect(medianOf([])).toBeNull();
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(durationBetween(t(1), t(0))).toBeNull();
    expect(durationBetween(null, t(0))).toBeNull();
  });
});

// ── Sprint 10 F24: the visit/start/complete funnel never reads (or counts) step events ──

describe("the funnel read leaves step events to their own loader (F24)", () => {
  it("asks only for the funnel's kinds, so step events cannot use up its 50,000-event cap", async () => {
    const { vi } = await import("vitest");
    const calls: [string, ...unknown[]][] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "neq", "gte", "order"]) builder[m] = (...args: unknown[]) => (calls.push([m, ...args]), builder);
    builder.range = async (...args: unknown[]) => (calls.push(["range", ...args]), { data: [{ kind: "visit", session_hash: "a" }], error: null });
    vi.resetModules();
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ from: () => builder }) }));
    const { loadFunnel, FUNNEL_KINDS } = await import("@/lib/intake-forms/load-performance");
    const res = await loadFunnel("form-1", 30, new Date("2026-10-21T12:00:00Z"));
    expect(res.status).toBe("ok");
    const kinds = calls.find((c) => c[0] === "in" && c[1] === "kind");
    expect(kinds?.[2]).toEqual(["visit", "start_conversation", "start_form", "start_assessment", "complete"]);
    expect(kinds?.[2]).toEqual([...FUNNEL_KINDS]);
    expect(kinds?.[2]).not.toContain("step");
    // No other filter lets a step event in.
    expect(calls.some((c) => c[0] === "eq" && c[1] === "kind")).toBe(false);
    vi.doUnmock("@/lib/db/scoped-client");
  });
});

describe("buildFunnel with step events mixed in (F24)", () => {
  it("returns the same numbers as the same list without them", () => {
    const base = [
      { kind: "visit", session_hash: "a" },
      { kind: "visit", session_hash: "b" },
      { kind: "start_form", session_hash: "a" },
      { kind: "complete", session_hash: "a" },
    ];
    const withSteps = [base[0], { kind: "step", session_hash: "a" }, base[1], { kind: "step", session_hash: "a" }, { kind: "step", session_hash: null }, base[2], base[3]];
    expect(buildFunnel(withSteps)).toEqual(buildFunnel(base));
    expect(buildFunnel(withSteps)).toMatchObject({ visited: 2, form: 1, started: 1, completed: 1 });
  });
});
