import { describe, expect, it } from "vitest";
import { gateDecision, type GateFacts } from "@/lib/loe/email-signing/gate-rules";
import { firmMailFrom, parseFirmMailFrom } from "@/lib/loe/email-signing/mail-config";
import { isSigningAddress, SIGNING_ADDRESS_PATTERN } from "@/lib/loe/email-signing/address";
import { parseReadiness, readyDecision, SEND_FAILURE_FALLBACK, type ReadyFacts } from "@/lib/loe/email-signing/ready-rules";
import { foldName, namesMatch } from "@/lib/loe/email-signing/name-fold";
import { maskEmail } from "@/lib/loe/email-signing/mask";
import { closeArming, INITIAL_ARMING, type ArmingEvent } from "@/lib/loe/email-signing/close-arming";
import { signOpenOutcome } from "@/lib/loe/email-signing/open-outcomes";
import { consentSha256, fieldsOk, renderEmailWords, wordsIssues, wordsSha256, WORDS_LIMITS, type SigningWords } from "@/lib/loe/signing-words";

const ORG = "0a0a0a0a-0000-4000-8000-000000000001";

describe("T2 gateDecision: ON only when every condition holds, in order", () => {
  const all: GateFacts = { switchValue: "on", hasKey: true, hasFrom: true, memoNotSetUp: false, probe: "ok", words: "approved" };
  it("all four hold: on", () => expect(gateDecision(all)).toEqual({ on: true }));
  it("the switch must be exactly 'on'", () => {
    for (const v of [undefined, "", "ON", "true", "1", " on", "on "]) expect(gateDecision({ ...all, switchValue: v })).toEqual({ on: false, reason: "switch_off" });
  });
  it("no key or no sender: no_mail (and the switch wins over it)", () => {
    expect(gateDecision({ ...all, hasKey: false })).toEqual({ on: false, reason: "no_mail" });
    expect(gateDecision({ ...all, hasFrom: false })).toEqual({ on: false, reason: "no_mail" });
    expect(gateDecision({ ...all, switchValue: "off", hasKey: false })).toEqual({ on: false, reason: "switch_off" });
  });
  it("the runtime memo, a missing probe or missing words: not_set_up; any other probe/words failure: unreadable", () => {
    expect(gateDecision({ ...all, memoNotSetUp: true })).toEqual({ on: false, reason: "not_set_up" });
    expect(gateDecision({ ...all, probe: "missing" })).toEqual({ on: false, reason: "not_set_up" });
    expect(gateDecision({ ...all, probe: "error" })).toEqual({ on: false, reason: "unreadable" });
    expect(gateDecision({ ...all, words: "missing" })).toEqual({ on: false, reason: "not_set_up" });
    expect(gateDecision({ ...all, words: "error" })).toEqual({ on: false, reason: "unreadable" });
    expect(gateDecision({ ...all, words: "none" })).toEqual({ on: false, reason: "no_words" });
  });
  it("asks for the probe and the words only when nothing earlier decided", () => {
    expect(gateDecision({ ...all, probe: undefined, words: undefined })).toBe("need_probe");
    expect(gateDecision({ ...all, words: undefined })).toBe("need_words");
    expect(gateDecision({ ...all, switchValue: undefined, probe: undefined })).toEqual({ on: false, reason: "switch_off" });
  });
  it("every combination of the four conditions is on only when all four hold", () => {
    for (const sw of [true, false])
      for (const mail of [true, false])
        for (const probe of ["ok", "missing", "error"] as const)
          for (const words of ["approved", "none", "missing", "error"] as const) {
            const d = gateDecision({ switchValue: sw ? "on" : undefined, hasKey: mail, hasFrom: true, memoNotSetUp: false, probe, words });
            const on = typeof d === "object" && d.on;
            expect(on).toBe(sw && mail && probe === "ok" && words === "approved");
          }
  });
});

describe("T3 parseFirmMailFrom", () => {
  it("keeps a valid entry for a uuid org", () => {
    const m = parseFirmMailFrom(JSON.stringify({ [ORG]: "Sample Firm <signing@sample-firm.example>" }));
    expect(m.get(ORG)).toBe("Sample Firm <signing@sample-firm.example>");
    expect(parseFirmMailFrom(JSON.stringify({ [ORG]: "signing@sample-firm.example" })).get(ORG)).toBe("signing@sample-firm.example");
  });
  it("drops lectual.app and its subdomains, and the SITE_URL host", () => {
    for (const a of ["a@lectual.app", "a@mail.lectual.app", "Name <a@x.lectual.app>"]) expect(parseFirmMailFrom(JSON.stringify({ [ORG]: a })).size).toBe(0);
    expect(parseFirmMailFrom(JSON.stringify({ [ORG]: "a@deploy.example" }), "https://deploy.example").size).toBe(0);
    expect(parseFirmMailFrom(JSON.stringify({ [ORG]: "a@mail.deploy.example" }), "https://deploy.example/x").size).toBe(0);
    expect(parseFirmMailFrom(JSON.stringify({ [ORG]: "a@firm.example" }), "https://deploy.example").size).toBe(1);
  });
  it("refuses CR/LF, two addresses and a bad org id; garbage JSON is empty", () => {
    expect(parseFirmMailFrom(JSON.stringify({ [ORG]: "a@firm.example\r\nBcc: b@x.example" })).size).toBe(0);
    expect(parseFirmMailFrom(JSON.stringify({ [ORG]: "a@firm.example, b@firm.example" })).size).toBe(0);
    expect(parseFirmMailFrom(JSON.stringify({ "org-1": "a@firm.example" })).size).toBe(0);
    expect(parseFirmMailFrom("{not json").size).toBe(0);
    expect(parseFirmMailFrom(undefined).size).toBe(0);
    expect(parseFirmMailFrom(JSON.stringify({ [ORG]: `${"x".repeat(320)}@firm.example` })).size).toBe(0);
  });
  it("firmMailFrom reads the env by org id; no default sender", () => {
    expect(firmMailFrom(ORG, { FIRM_CLIENT_MAIL_FROM: JSON.stringify({ [ORG]: "a@firm.example" }) })).toBe("a@firm.example");
    expect(firmMailFrom(ORG, {})).toBeNull();
  });
});

const W: SigningWords = { consent_line: "a", consent_text: "b", sign_line: "c", box_note: "d", link_subject: "e", link_body: "f {{signing_link}}", copy_subject: "g", copy_body: "h" };

describe("T4 the signing words rules", () => {
  it("valid words have no issues", () => expect(wordsIssues(W)).toEqual([]));
  it("lengths: empty and too long", () => {
    expect(wordsIssues({ ...W, consent_line: "   " })).toEqual([{ field: "consent_line", problem: "empty" }]);
    expect(wordsIssues({ ...W, consent_line: "x".repeat(WORDS_LIMITS.consent_line + 1) })).toEqual([{ field: "consent_line", problem: "too_long" }]);
    expect(wordsIssues({ ...W, link_subject: "a\nb" })).toEqual([{ field: "link_subject", problem: "two_lines" }]);
  });
  it("{{signing_link}} exactly once in the link body; unknown and unclosed fields refused", () => {
    expect(wordsIssues({ ...W, link_body: "no link" })[0]).toEqual({ field: "link_body", problem: "fields" });
    expect(wordsIssues({ ...W, link_body: "{{signing_link}} {{signing_link}}" })[0]).toEqual({ field: "link_body", problem: "fields" });
    expect(fieldsOk("{{unknown}}", ["client_name"], null)).toBe(false);
    expect(fieldsOk("{{client_name", ["client_name"], null)).toBe(false);
    expect(fieldsOk("x }} y", [], null)).toBe(false);
    expect(wordsIssues({ ...W, consent_text: "Hi {{client_name}}" })[0]).toEqual({ field: "consent_text", problem: "fields" });
    expect(wordsIssues({ ...W, link_subject: "{{link_expires}}" })[0]).toEqual({ field: "link_subject", problem: "fields" });
    expect(wordsIssues({ ...W, link_body: "{{signing_link}} {{link_expires}} {{client_name}} {{firm_name}}" })).toEqual([]);
  });
  it("wordsSha256 equals a hand-computed value (U+001F joins, 0117's order)", () => {
    expect(wordsSha256(W)).toBe("e252199ef4393336f547e45a3b84f3a71b428e853f0dafce97859a975787c592");
    expect(consentSha256("b")).toBe("3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d");
  });
  it("renderEmailWords is one pass: a value that looks like a field is never re-merged; a missing value fails", () => {
    expect(renderEmailWords("Hi {{client_name}}: {{signing_link}}", { client_name: "{{signing_link}}", signing_link: "L" })).toEqual({ ok: true, text: "Hi {{signing_link}}: L" });
    expect(renderEmailWords("{{firm_name}}", {})).toEqual({ ok: false });
  });
});

describe("T20 readiness and the address rule", () => {
  const base: ReadyFacts = { gateOn: true, hasLetter: true, letterCheck: "current", addressOk: true, readiness: { kind: "ok", state: "ok", failures: 0 }, localFailures: 0 };
  it("ready only when everything holds", () => expect(readyDecision(base)).toBe(true));
  it("false for every database state other than ok", () => {
    for (const state of ["changed", "no_email", "letter_replaced", "no_words", "weird"]) expect(readyDecision({ ...base, readiness: { kind: "ok", state, failures: 0 } })).toBe(false);
  });
  it("false at the fallback threshold, counting this instance's unrecorded failures", () => {
    expect(SEND_FAILURE_FALLBACK).toBe(3);
    expect(readyDecision({ ...base, readiness: { kind: "ok", state: "ok", failures: 3 } })).toBe(false);
    expect(readyDecision({ ...base, readiness: { kind: "ok", state: "ok", failures: 2 }, localFailures: 1 })).toBe(false);
    expect(readyDecision({ ...base, readiness: { kind: "ok", state: "ok", failures: 2 } })).toBe(true);
  });
  it("false for an rpc error, an unknown shape and a missing object; false for a replaced letter, no address, gate off", () => {
    expect(readyDecision({ ...base, readiness: { kind: "error" } })).toBe(false);
    expect(readyDecision({ ...base, readiness: { kind: "missing" } })).toBe(false);
    expect(readyDecision({ ...base, readiness: parseReadiness({ state: "ok" }) })).toBe(false);
    expect(readyDecision({ ...base, readiness: parseReadiness("ok") })).toBe(false);
    expect(readyDecision({ ...base, readiness: parseReadiness({ state: "ok", failures: 1.5 }) })).toBe(false);
    expect(readyDecision({ ...base, letterCheck: "stale" })).toBe(false);
    expect(readyDecision({ ...base, letterCheck: "unreadable" })).toBe(false);
    expect(readyDecision({ ...base, addressOk: false })).toBe(false);
    expect(readyDecision({ ...base, gateOn: false })).toBe(false);
    expect(readyDecision({ ...base, readiness: null })).toBe(false);
  });
  it("isSigningAddress is exactly 0117's rule (btrim, the pattern, 3..320)", () => {
    expect(SIGNING_ADDRESS_PATTERN.source).toBe("^[^@\\s]+@[^@\\s]+$");
    const table: Array<[string, boolean]> = [
      ["", false],
      ["   ", false],
      ["client.example", false],
      ["a@b@c", false],
      ["a b@example.com", false],
      ["  a@example.com  ", true],
      ["a@example.com", true],
      ["a@b", true],
      [`${"a".repeat(310)}@example.com`, false],
    ];
    for (const [v, want] of table) expect([v, isSigningAddress(v)]).toEqual([v, want]);
  });
});

describe("T18 name folding (ASCII only) and the masked address", () => {
  it("folds case and whitespace runs, ASCII only", () => {
    expect(namesMatch("  sam   CLIENT ", "Sam Client")).toBe(true);
    expect(namesMatch("Sam Clients", "Sam Client")).toBe(false);
    expect(namesMatch("ZOË", "Zoë")).toBe(false);
    expect(foldName("ZOË")).toBe("zoË");
  });
  it("masks the address", () => {
    expect(maskEmail("sam@example.com")).toBe("s•••@example.com");
    expect(maskEmail("bad")).toBe("•••");
  });
});

describe("T13 closeArming (pure)", () => {
  const run = (events: ArmingEvent[]) => {
    let s = INITIAL_ARMING;
    const fired: boolean[] = [];
    for (const e of events) {
      const r = closeArming(s, e);
      s = r.state;
      fired.push(r.fire);
    }
    return fired;
  };
  it("armed on load: the first change fires once, a second does not", () => expect(run([{ type: "change" }, { type: "change" }])).toEqual([true, false]));
  it("change -> send ok -> change fires a SECOND time (uncertain counts as ok)", () => {
    expect(run([{ type: "change" }, { type: "send_start" }, { type: "send_done", ok: true }, { type: "change" }])).toEqual([true, false, false, true]);
  });
  it("a change during an in-flight send closes at once when the send answers ok; not when it fails", () => {
    expect(run([{ type: "change" }, { type: "send_start" }, { type: "change" }, { type: "send_done", ok: true }])).toEqual([true, false, false, true]);
    expect(run([{ type: "change" }, { type: "send_start" }, { type: "change" }, { type: "send_done", ok: false }, { type: "change" }])).toEqual([true, false, false, false, false]);
  });
  it("a failed close re-arms", () => {
    expect(run([{ type: "change" }, { type: "close_done", reached: false }, { type: "change" }])).toEqual([true, false, true]);
    expect(run([{ type: "change" }, { type: "close_done", reached: true }, { type: "change" }])).toEqual([true, false, false]);
  });
});

describe("signing_open answers are all mapped", () => {
  it("preconditions, missing objects, counted refusals and errors", () => {
    for (const p of ["signing_letter_replaced", "signing_changed", "signing_no_email"]) expect(signOpenOutcome({ code: "23514", message: `${p}: x` })).toEqual({ kind: "precondition" });
    for (const c of ["42883", "PGRST202", "42P01", "PGRST205"]) expect(signOpenOutcome({ code: c })).toEqual({ kind: "missing" });
    for (const p of ["signing_words_changed", "signing_invalid"]) expect(signOpenOutcome({ code: "23514", message: `${p}: x` })).toEqual({ kind: "counted", failure: "open_refused" });
    for (const e of [{ code: "23505" }, { code: "40P01" }, { code: "XX000", message: "boom" }, null]) expect(signOpenOutcome(e)).toEqual({ kind: "counted", failure: "open_error" });
  });
});
