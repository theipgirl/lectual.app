import { describe, expect, it } from "vitest";
import { classifyEmail, SENSITIVE_PHRASES } from "../../src/lib/intake/email-match";
import { parseStageMapping, stageForSignal, DEFAULT_STAGE_NAMES } from "../../src/lib/agents/stage-keeper/mapping";
import { targetStageFromSignals, type TargetResult } from "../../src/lib/agents/stage-keeper/target";
import { isSensitiveTitle } from "../../src/lib/agents/stage-keeper/run";
import { SIGNAL_IDS, signalIdFor, signalKeyFor, type KeeperSignal } from "../../src/lib/stage-keeper/signals";
import type { StageOpt } from "../../src/lib/reconcile/types";
import { FIRM, H, HARTWELL, S } from "./fixtures";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const mail = (type: string, over: Partial<Extract<KeeperSignal, { source: "mail" }>> = {}): KeeperSignal => ({
  source: "mail",
  messageId: `m-${type}`,
  type,
  direction: "outbound",
  at: "2026-09-20T10:00:00Z",
  subject: "Subject",
  sensitive: false,
  ...over,
});
const consult = (over: Partial<Extract<KeeperSignal, { source: "calendar" }>> = {}): KeeperSignal => ({
  source: "calendar",
  eventId: "e1",
  title: "Strategy session",
  startsAt: "2026-09-28T15:00:00Z",
  sensitive: false,
  ...over,
});
const payment: KeeperSignal = { source: "payment", ref: "p1", at: "2026-09-21T10:00:00Z" };

const at = (current: string, signals: KeeperSignal[], stages: StageOpt[] = FIRM, mapping = {}): TargetResult =>
  targetStageFromSignals({ currentStageId: current }, signals, stages, mapping, { now: NOW });
const moveTo = (r: TargetResult) => (r.kind === "move" ? r.stage.id : r.kind === "suggest" ? `suggest:${r.stage.id}` : `nothing:${r.reason}`);

describe("F1 each signal maps to its stage", () => {
  it("a booked future consult gives the Consultation Scheduled stage", () => {
    expect(moveTo(at(S.newPnc, [consult()]))).toBe(S.consult);
  });
  it("an outbound questionnaire gives the questionnaire stage", () => {
    expect(moveTo(at(S.newPnc, [mail("questionnaire")]))).toBe(S.questionnaire);
  });
  it("an outbound post-consult gives the post-consult stage", () => {
    expect(moveTo(at(S.newPnc, [mail("post-consult")]))).toBe(S.post);
  });
  it("an outbound loe-invoice gives LOE & Invoice Sent", () => {
    expect(moveTo(at(S.newPnc, [mail("loe-invoice")]))).toBe(S.loe);
  });

  it("an inbound message of any type moves nothing", () => {
    for (const type of ["questionnaire", "post-consult", "loe-invoice", "welcome", "discovery-call", "follow-up", "other"]) {
      expect(at(S.newPnc, [mail(type, { direction: "inbound" })])).toEqual({ kind: "nothing", reason: "implies-nothing" });
    }
  });

  it("types that imply nothing give nothing, outbound or not", () => {
    for (const type of ["follow-up", "discovery-call", "strategy-session-link", "opinion-letter", "other"]) {
      expect(at(S.newPnc, [mail(type)])).toEqual({ kind: "nothing", reason: "implies-nothing" });
    }
  });

  it("a consult that has already started is not a booked future consult", () => {
    expect(at(S.newPnc, [consult({ startsAt: "2026-09-24T15:00:00Z" })]).kind).toBe("nothing");
  });

  it("signalIdFor and signalKeyFor", () => {
    expect(SIGNAL_IDS).toHaveLength(6);
    expect(signalIdFor(mail("loe-invoice"))).toBe("loe-invoice-sent");
    expect(signalIdFor(mail("loe-invoice", { direction: "inbound" }))).toBeNull();
    expect(signalKeyFor("lead-1", mail("loe-invoice", { messageId: "abc" }))).toBe("lead-1:mail:abc");
    expect(signalKeyFor("lead-1", consult({ eventId: "ev" }))).toBe("lead-1:calendar:ev");
  });
});

describe("F2 the mapping source", () => {
  it("a firm brain stage_mapping entry wins over the default", () => {
    const mapping = parseStageMapping([{ key: "loe-invoice-sent", data: { stage: "Undecided / Questions" }, body: "" }]);
    expect(moveTo(at(S.newPnc, [mail("loe-invoice")], FIRM, mapping))).toBe(S.undecided);
  });

  it("reads the stage from the body when the entry has no data.stage, and ignores entries that are not signal ids", () => {
    const mapping = parseStageMapping([
      { key: "post-consult-sent", data: null, body: "  Undecided / Questions  " },
      { key: "lawmatics-to-tracker", data: { map: { "Consult Scheduled": "3. Consultation Scheduled" } }, body: "" },
      { key: "questionnaire-sent", data: {}, body: "   " },
    ]);
    expect(mapping).toEqual({ "post-consult-sent": "Undecided / Questions" });
  });

  it("a brain entry that names a stage the firm lacks gives nothing for that signal, with no fall-back to the default", () => {
    const mapping = parseStageMapping([{ key: "loe-invoice-sent", data: { stage: "Engagement Out" } }]);
    // The default "LOE & Invoice Sent" exists and would have matched; the firm said what it meant.
    expect(at(S.newPnc, [mail("loe-invoice")], FIRM, mapping)).toEqual({ kind: "nothing", reason: "unresolved" });
    // Another signal with no entry still uses its default.
    expect(moveTo(at(S.newPnc, [mail("post-consult")], FIRM, mapping))).toBe(S.post);
  });

  it("with no entry the default resolves by normalised name: case, punctuation, & and 'and', a leading number", () => {
    const stages: StageOpt[] = [
      { id: "a", name: "Intake", category: "open", orderIndex: 1 },
      { id: "b", name: "3. consultation   SCHEDULED", category: "open", orderIndex: 2 },
      { id: "c", name: "Post-Consultation Email Sent", category: "open", orderIndex: 3 },
      { id: "d", name: "LOE and Invoice Sent", category: "open", orderIndex: 4 },
    ];
    expect(moveTo(at("a", [consult()], stages))).toBe("b");
    expect(moveTo(at("a", [mail("post-consult")], stages))).toBe("c");
    expect(moveTo(at("a", [mail("loe-invoice")], stages))).toBe("d");
  });

  it("the seven-stage default pipeline resolves consult and LOE through the alias names and has no questionnaire stage", () => {
    expect(moveTo(at(H.inquiry, [consult()], HARTWELL))).toBe(H.discovery);
    expect(moveTo(at(H.inquiry, [mail("loe-invoice")], HARTWELL))).toBe(H.engagement);
    expect(at(H.inquiry, [mail("questionnaire")], HARTWELL)).toEqual({ kind: "nothing", reason: "unresolved" });
  });

  it("a firm with no matching stage gets nothing, and unresolved is never turned into the first stage", () => {
    const stages: StageOpt[] = [
      { id: "x", name: "Alpha", category: "open", orderIndex: 1 },
      { id: "y", name: "Beta", category: "open", orderIndex: 2 },
    ];
    for (const signal of [consult(), mail("questionnaire"), mail("post-consult"), mail("loe-invoice")]) {
      expect(at("x", [signal], stages)).toEqual({ kind: "nothing", reason: "unresolved" });
    }
    expect(stageForSignal("loe-invoice-sent", stages, {})).toBeNull();
  });

  it("the default table is the only place a stage name is written", () => {
    expect(Object.keys(DEFAULT_STAGE_NAMES).sort()).toEqual([...SIGNAL_IDS].sort());
  });
});

describe("F3 forward only", () => {
  it("a signal whose stage is the lead's own, or earlier, gives nothing", () => {
    expect(at(S.loe, [mail("loe-invoice")])).toEqual({ kind: "nothing", reason: "not-forward" });
    expect(at(S.loe, [mail("post-consult")])).toEqual({ kind: "nothing", reason: "not-forward" });
    expect(at(S.post, [consult()])).toEqual({ kind: "nothing", reason: "not-forward" });
  });

  it("of several signals the furthest-forward target wins", () => {
    const r = at(S.newPnc, [consult(), mail("post-consult"), mail("loe-invoice"), mail("questionnaire")]);
    expect(moveTo(r)).toBe(S.loe);
  });

  it("only the forward ones compete: an earlier stage never beats a later one the lead has not reached", () => {
    expect(moveTo(at(S.consult, [consult(), mail("post-consult")]))).toBe(S.post);
  });

  it("ties on the target stage go to the newest evidence", () => {
    const older = mail("loe-invoice", { messageId: "old", at: "2026-09-10T10:00:00Z" });
    const newer = mail("loe-invoice", { messageId: "new", at: "2026-09-22T10:00:00Z" });
    for (const order of [[older, newer], [newer, older]]) {
      const r = at(S.newPnc, order);
      expect(r.kind === "move" && r.signal.source === "mail" && r.signal.messageId).toBe("new");
    }
  });
});

describe("F4 never into won, lost or nurture", () => {
  const to = (name: string) => parseStageMapping([{ key: "loe-invoice-sent", data: { stage: name } }]);

  it("a signal that maps to a won stage is a suggestion, never a move", () => {
    const r = at(S.newPnc, [mail("loe-invoice")], FIRM, to("Signed LOE / Deposit Received"));
    expect(r).toMatchObject({ kind: "suggest", why: "won", stage: { id: S.signed } });
  });

  it("a lost or nurture target is a suggestion", () => {
    expect(at(S.newPnc, [mail("loe-invoice")], FIRM, to("Lost"))).toMatchObject({ kind: "suggest", why: "lost" });
    expect(at(S.newPnc, [mail("loe-invoice")], FIRM, to("Nurture"))).toMatchObject({ kind: "suggest", why: "nurture" });
  });

  it("welcome and payment signals produce at most a suggestion, even for an open stage", () => {
    const welcome = parseStageMapping([{ key: "welcome-sent", data: { stage: "Undecided / Questions" } }]);
    expect(at(S.newPnc, [mail("welcome")], FIRM, welcome)).toMatchObject({ kind: "suggest", why: "welcome-or-payment", stage: { id: S.undecided } });
    const pay = parseStageMapping([{ key: "payment-received", data: { stage: "Post Consultation Email Sent" } }]);
    expect(at(S.newPnc, [payment], FIRM, pay)).toMatchObject({ kind: "suggest", why: "welcome-or-payment" });
    // With the default names, a payment targets the won stage: a suggestion for it, still not a move.
    expect(at(S.newPnc, [payment])).toMatchObject({ kind: "suggest", why: "won", stage: { id: S.signed } });
  });

  it("a welcome email on a firm with no welcome stage gives nothing", () => {
    expect(at(S.newPnc, [mail("welcome")])).toEqual({ kind: "nothing", reason: "unresolved" });
  });

  it("a lead already in a won stage gets nothing", () => {
    expect(at(S.signed, [mail("loe-invoice"), consult()])).toEqual({ kind: "nothing", reason: "already-client" });
  });

  it("a lead already in a lost or nurture stage gets a suggestion at most, never a move", () => {
    const stages: StageOpt[] = [
      { id: "n", name: "Follow-Up", category: "nurture", orderIndex: 1 },
      { id: "l", name: "Lost", category: "lost", orderIndex: 2 },
      { id: "c", name: "Consultation Scheduled", category: "open", orderIndex: 3 },
    ];
    expect(at("n", [consult()], stages)).toMatchObject({ kind: "suggest", why: "current-stage", stage: { id: "c" } });
    expect(at("l", [consult()], stages)).toMatchObject({ kind: "suggest", why: "current-stage", stage: { id: "c" } });
  });

  it("a target that is not strictly forward is nothing, never a suggestion", () => {
    expect(at(S.nurture, [mail("loe-invoice")], FIRM, to("Lost"))).toMatchObject({ kind: "suggest", why: "lost" }); // lost (10) is ahead of nurture (9)
    expect(at(S.lost, [mail("loe-invoice")], FIRM, to("Nurture"))).toEqual({ kind: "nothing", reason: "not-forward" });
    expect(at(S.loe, [mail("loe-invoice")], FIRM, to("Nurture")).kind).toBe("suggest"); // forward, so still only a card
  });

  it("an unknown current stage gives nothing", () => {
    expect(at("not-a-stage", [mail("loe-invoice")])).toEqual({ kind: "nothing", reason: "unknown-stage" });
  });
});

describe("F5 sensitive mail", () => {
  it("each sensitive phrase on any message in the window stops the lead, even beside a clear signal", () => {
    for (const phrase of SENSITIVE_PHRASES) {
      const { sensitive } = classifyEmail(`Re: ${phrase} update`, null);
      expect(sensitive, phrase).toBe(true);
      const r = at(S.newPnc, [mail("loe-invoice"), mail("other", { messageId: "s", direction: "inbound", sensitive })]);
      expect(r, phrase).toEqual({ kind: "nothing", reason: "sensitive" });
    }
  });

  it("a calendar title with a sensitive phrase counts, and an ordinary title does not", () => {
    for (const phrase of SENSITIVE_PHRASES) {
      expect(isSensitiveTitle(`Call about the ${phrase}`), phrase).toBe(true);
    }
    expect(isSensitiveTitle("Strategy session with Amara")).toBe(false);
    expect(isSensitiveTitle(null)).toBe(false);
    expect(at(S.newPnc, [consult({ title: "Settlement call", sensitive: isSensitiveTitle("Settlement call") })])).toEqual({ kind: "nothing", reason: "sensitive" });
  });

  it("no signals at all is its own reason", () => {
    expect(at(S.newPnc, [])).toEqual({ kind: "nothing", reason: "no-signals" });
  });
});
