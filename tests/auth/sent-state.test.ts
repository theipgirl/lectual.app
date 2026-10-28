import { describe, expect, it } from "vitest";
import { nextSentState } from "@/app/sign-in/sent-state";

describe("nextSentState", () => {
  it("first send starts at 1 (no 'Sent again.')", () => {
    expect(nextSentState({}, { ok: true, email: "a@x.com" }, false)).toMatchObject({ sends: 1, round: 1 });
  });
  it("a resend of the same address counts up", () => {
    const first = nextSentState({}, { ok: true, email: "a@x.com" }, false);
    expect(nextSentState(first, { ok: true, email: "a@x.com" }, true)).toMatchObject({ sends: 2, round: 2 });
  });
  it("a new address after 'Use a different address' starts again at 1, and the round still moves", () => {
    const second = nextSentState(nextSentState({}, { ok: true, email: "a@x.com" }, false), { ok: true, email: "a@x.com" }, true);
    const fresh = nextSentState(second, { ok: true, email: "b@x.com" }, false);
    expect(fresh).toMatchObject({ sends: 1, round: 3, email: "b@x.com" });
  });
  it("re-typing the same address from the first form is not 'again'", () => {
    const first = nextSentState({}, { ok: true, email: "a@x.com" }, false);
    expect(nextSentState(first, { ok: true, email: "a@x.com" }, false).sends).toBe(1);
  });
  it("a refused resend keeps the confirmation and shows the sentence", () => {
    const first = nextSentState({}, { ok: true, email: "a@x.com" }, false);
    expect(nextSentState(first, { ok: false, error: "Wait" }, true)).toMatchObject({ ok: true, sends: 1, error: "Wait" });
  });
});
