import { describe, expect, it } from "vitest";
import { certificateFrom, checkCertificate, isAcceptablePng } from "@/lib/loe/email-signing/certificate";
import { bytesFrom } from "@/lib/loe/email-signing/evidence";
import { CONSENT_SHA, PNG_BYTES, PNG_SHA, REQUEST_ID, SENT_TO, SIGNATURE_ID, evidenceFor, linkSnapshot } from "./evidence-fixtures";

const TZ = "America/New_York";

function build(over: Parameters<typeof evidenceFor>[1] = {}, snapshot = linkSnapshot()) {
  const e = evidenceFor(snapshot, over);
  return { e, snapshot, input: { request: e.request, events: e.events, snapshot, verifiedSha256: snapshot.agreement!.sha256, tz: TZ } };
}

describe("certificateFrom: built only from verified, granted evidence", () => {
  it("builds the page's values in the contract's fields, from the granted columns only", () => {
    const { input, snapshot } = build();
    const c = certificateFrom(input)!;
    expect(c).toBeTruthy();
    expect(c.sentTo).toBe(SENT_TO);
    expect(c.sentAt).toBe("November 12, 2026 at 1:50 PM EST");
    expect(c.openedAt).toBe("November 12, 2026 at 1:58 PM EST");
    expect(c.consentAt).toBe("November 12, 2026 at 2:00 PM EST");
    expect(c.consentSha256).toBe(CONSENT_SHA);
    expect(c.wordsVersion).toBe("4");
    expect(c.signedAt).toContain("EST");
    expect(c.signedAtUtc).toBe("2026-11-12T19:14:00.000Z");
    // The signer's own IP and browser, not the open's (the open may be a mail scanner).
    expect(c.ip).toBe("203.0.113.7");
    expect(c.browser).toBe("Sample Browser/9.0");
    expect(c.letterFingerprint).toBe(snapshot.agreement!.sha256);
    expect(c.typedName).toBe("Callum Ferreira");
    expect(c.signature.kind).toBe("drawn");
    // The staff fixture has no agreement_sha256 / consent_sha256 / sent_to on the request, and still builds.
    expect(Object.keys(build().e.request)).not.toEqual(expect.arrayContaining(["agreement_sha256"]));
    for (const k of ["agreement_sha256", "consent_sha256", "sent_to", "token_sha256", "agreement_text"]) expect(k in build().e.request).toBe(false);
  });

  it("prints 'Not recorded' for a fact that was not recorded, never a guess", () => {
    const { input } = build({ request: { opened_at: null, words_version: null } });
    const c = certificateFrom(input)!;
    expect(c.openedAt).toBe("Not recorded");
    expect(c.wordsVersion).toBe("Not recorded");
    const noUa = build({ events: build().e.events.map((x) => (x.kind === "signed" ? { ...x, ip: null, user_agent: null } : x)) });
    const c2 = certificateFrom(noUa.input)!;
    expect(c2.ip).toBe("Not recorded");
    expect(c2.browser).toBe("Not recorded");
  });

  it("a typed signature carries the typed name and its style", () => {
    const c = certificateFrom(build({ typed: true }).input)!;
    expect(c.signature).toEqual({ kind: "typed", style: "print", name: "Callum Ferreira" });
  });

  it("is null (missing) for every broken link of the chain", () => {
    const base = build();
    const cases: Array<[string, Parameters<typeof evidenceFor>[1]]> = [
      ["not signed", { request: { status: "open" } }],
      ["another request", { request: { id: "00000000-2222-4333-8444-555555555555" } }],
      ["another signature row", { request: { signature_id: "88888888-2222-4333-8444-555555555555" } }],
      ["no sent event", { events: base.e.events.filter((e) => e.kind !== "sent") }],
      ["no consent event", { events: base.e.events.filter((e) => e.kind !== "consent") }],
      ["no signature event", { events: base.e.events.filter((e) => e.kind !== "signature") }],
      ["no signed event", { events: base.e.events.filter((e) => e.kind !== "signed") }],
      ["two sent events", { events: [...base.e.events, base.e.events[0]] }],
      ["two signed events", { events: [...base.e.events, base.e.events[base.e.events.length - 1]] }],
    ];
    for (const [name, over] of cases) {
      const b = build(over);
      expect(certificateFrom(b.input), name).toBeNull();
      expect(checkCertificate(b.input).kind, name).toBe("missing");
    }
    // An in-app snapshot (no method) never gets a certificate.
    const inApp = { ...base.snapshot, agreement: { ...base.snapshot.agreement!, method: undefined } };
    expect(checkCertificate({ ...base.input, snapshot: inApp }).kind).toBe("missing");
  });

  it("is a mismatch when the signed event's sha256 differs from the snapshot's or from the verified text's", () => {
    const base = build();
    const events = base.e.events.map((e) => (e.kind === "signed" ? { ...e, agreement_sha256: "a".repeat(64) } : e));
    expect(checkCertificate({ ...base.input, events }).kind).toBe("mismatch");
    expect(checkCertificate({ ...base.input, verifiedSha256: "b".repeat(64) }).kind).toBe("mismatch");
  });

  it("re-checks a drawn PNG: magic, at most 100 KB, sha256 equal to the recorded one", () => {
    const base = build();
    const swap = (patch: Partial<(typeof base.e.events)[number]>) => base.e.events.map((e) => (e.kind === "signature" ? { ...e, ...patch } : e));
    expect(checkCertificate({ ...base.input, events: swap({ signature_sha256: "f".repeat(64) }) }).kind).toBe("mismatch");
    expect(checkCertificate({ ...base.input, events: swap({ signature_png: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) }) }).kind).toBe("mismatch");
    const big = new Uint8Array(102_401);
    big.set(PNG_BYTES.subarray(0, 8));
    expect(isAcceptablePng(big)).toBe(false);
    expect(checkCertificate({ ...base.input, events: swap({ signature_png: big }) }).kind).toBe("mismatch");
    expect(checkCertificate({ ...base.input, events: swap({ signature_png: null }) }).kind).toBe("mismatch");
    expect(PNG_SHA).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("bytesFrom", () => {
  it("reads PostgREST's hex and refuses anything else", () => {
    expect(Array.from(bytesFrom("\\x89504e47")!)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytesFrom("\\x8")).toBeNull();
    expect(bytesFrom("zz")).toBeNull();
    expect(bytesFrom(5)).toBeNull();
    expect(REQUEST_ID && SIGNATURE_ID).toBeTruthy();
  });
});
