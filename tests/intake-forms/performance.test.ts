import { describe, expect, it } from "vitest";
import { buildFunnel, intakeDetail, intakeTableRows, parseRange, percent } from "@/lib/intake-forms/performance";
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
