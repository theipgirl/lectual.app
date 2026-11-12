import { describe, expect, it } from "vitest";
import { agreementFingerprint, canonicalFingerprint } from "@/lib/loe/fingerprint";
import { buildExhibit } from "@/lib/loe/exhibit";
import {
  addressBlock,
  addressJson,
  assembleAgreement,
  canSign,
  checkSigning,
  cleanSigningDetails,
  DEFAULT_COUNTRY,
  REQUIRED_DETAIL_KEYS,
  emptyDetails,
  fingerprintOf,
  letterDateText,
  letterValues,
  missingDetails,
  sha256Hex,
  signedAtText,
  signedAtUtcIso,
  signedLineText,
} from "@/lib/loe/signing";
import { money } from "@/components/client-proposal/format";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection, normalizeSelection } from "@/lib/proposals/pricing";
import { renderLetter } from "@/lib/loe/render";
import { TEST_DETAILS, fullLetterBody } from "./full-letter-fixture";
import { twoBrandPerMark, withLoe } from "./loe-fixtures";

function exhibitFor(selectionOver: Record<string, boolean> = {}) {
  const content = withLoe(twoBrandPerMark());
  const selection = normalizeSelection(content, { ...defaultSelection(content), ...selectionOver });
  const r = quoteWithClientClasses(content, selection, { entries: {}, added: {} }, { repair: true });
  if (!r.ok) throw new Error("no quote");
  return buildExhibit(r.content, r.quote, money);
}

const INPUTS = { details: TEST_DETAILS, typedName: "Sevetri Wilson", dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };

describe("cleaning what a client typed", () => {
  it("removes angle brackets and control characters, collapses spaces and caps the length", () => {
    const d = cleanSigningDetails({
      client_name: "  Alex <script>alert(1)</script>\u0000\u0007  Sample ",
      street: "1\u2028Main\tStreet",
      city: "x".repeat(500),
      title: 42,
      extra_key: "ignored",
    });
    expect(d.client_name).toBe("Alex scriptalert(1)/script Sample");
    expect(d.street).toBe("1 Main Street");
    expect(d.city).toHaveLength(200);
    expect(d.title).toBe("");
    expect(Object.keys(d)).not.toContain("extra_key");
    expect(JSON.stringify(d)).not.toMatch(/[<>]/);
  });

  it("a non-object cleans to empty details, never throwing", () => {
    expect(cleanSigningDetails(null)).toEqual(emptyDetails());
    expect(cleanSigningDetails("x")).toEqual(emptyDetails());
    expect(cleanSigningDetails([1])).toEqual(emptyDetails());
  });

  it("requires a full legal name and a full mailing address (street, city, state, ZIP, country)", () => {
    expect(missingDetails(emptyDetails())).toEqual(["client_name", "street", "city", "region", "postal", "country"]);
    expect(missingDetails(TEST_DETAILS)).toEqual([]);
  });

  for (const key of REQUIRED_DETAIL_KEYS) {
    it(`refuses when only ${key} is missing (server checkSigning and the page's canSign)`, () => {
      const details = { ...TEST_DETAILS, [key]: "   " };
      const input = { typedName: "Sevetri Wilson", agree: true, details, fingerprint: "x" };
      expect(missingDetails(cleanSigningDetails(details))).toEqual([key]);
      expect(checkSigning(input)).toEqual({ ok: false, reason: "details_required" });
      expect(canSign(input)).toBe(false);
    });
  }

  it("passes with the three optional fields empty", () => {
    const details = { ...TEST_DETAILS, entity_name: "", title: "", street2: "" };
    const input = { typedName: "Sevetri Wilson", agree: true, details, fingerprint: "x" };
    expect(missingDetails(details)).toEqual([]);
    expect(checkSigning(input).ok).toBe(true);
    expect(canSign(input)).toBe(true);
  });

  it("starts the form with United States as the country", () => {
    expect(DEFAULT_COUNTRY).toBe("United States");
  });
});

describe("checkSigning", () => {
  const good = { typedName: "Sevetri Wilson", agree: true, details: TEST_DETAILS, fingerprint: "x" };
  it("accepts a name, a tick and details, and returns them cleaned", () => {
    const r = checkSigning({ ...good, typedName: "  Sevetri   <b>Wilson</b> " });
    expect(r.ok && r.typedName).toBe("Sevetri bWilson/b");
  });
  it("refuses, in this order: details, name, tick", () => {
    expect(checkSigning({ ...good, details: emptyDetails() })).toEqual({ ok: false, reason: "details_required" });
    expect(checkSigning({ ...good, typedName: " " })).toEqual({ ok: false, reason: "name_required" });
    expect(checkSigning({ ...good, typedName: "A" })).toEqual({ ok: false, reason: "name_required" });
    expect(checkSigning({ ...good, agree: false })).toEqual({ ok: false, reason: "agree_required" });
    expect(checkSigning({ ...good, agree: "true" })).toEqual({ ok: false, reason: "agree_required" });
    expect(checkSigning(undefined)).toEqual({ ok: false, reason: "details_required" });
  });
  it("the sign button rule: disabled until the name is typed and the tick is given", () => {
    expect(canSign({ typedName: "", agree: false, details: TEST_DETAILS })).toBe(false);
    expect(canSign({ typedName: "Sevetri Wilson", agree: false, details: TEST_DETAILS })).toBe(false);
    expect(canSign({ typedName: "", agree: true, details: TEST_DETAILS })).toBe(false);
    expect(canSign({ typedName: "Sevetri Wilson", agree: true, details: TEST_DETAILS })).toBe(true);
    expect(canSign({ typedName: "Sevetri Wilson", agree: true, details: emptyDetails() })).toBe(false);
  });
});

describe("the agreement", () => {
  it("merges the seven fields; the entity falls back to the client's own name", () => {
    const values = letterValues({ ...INPUTS, details: { ...TEST_DETAILS, entity_name: "" } });
    expect(values.entity_name).toBe("Sevetri Wilson");
    expect(values.address_block).toBe("100 Example Street\nSuite 4\nMiami, FL 33101\nUnited States");
    expect(Object.keys(values).sort()).toEqual(["address_block", "client_email", "client_name", "date", "entity_name", "signed_date", "signer_name"]);
  });

  it("a typed value that looks like a merge field or markup comes out as literal text", () => {
    const evil = { ...TEST_DETAILS, client_name: "{{signer_name}} }} <img src=x>" };
    const r = assembleAgreement({ body: fullLetterBody(), inputs: { ...INPUTS, details: evil }, exhibit: exhibitFor() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.agreement.text).toContain("{{signer_name}} }} <img src=x>");
      expect(renderLetter(fullLetterBody(), letterValues({ ...INPUTS, details: evil })).ok).toBe(true);
    }
  });

  it("the agreement text holds every paragraph then the exhibit", () => {
    const r = assembleAgreement({ body: fullLetterBody(), inputs: INPUTS, exhibit: exhibitFor() });
    if (!r.ok) throw new Error("no agreement");
    expect(r.agreement.text).toContain("Exhibit A: Fee Structure and Estimated Costs");
    expect(r.agreement.text.indexOf("Dear Sevetri Wilson:")).toBeGreaterThan(-1);
    expect(r.agreement.text.indexOf("Exhibit A")).toBeGreaterThan(r.agreement.text.lastIndexOf("Fee Structure & Estimated Costs"));
  });

  it("an unmergeable letter yields no agreement at all", () => {
    expect(assembleAgreement({ body: "Dear {{nope}}", inputs: INPUTS, exhibit: exhibitFor() })).toEqual({ ok: false });
  });
});

describe("the fingerprint", () => {
  function fp(details = TEST_DETAILS, exhibit = exhibitFor(), typedName = "Sevetri Wilson") {
    const r = assembleAgreement({ body: fullLetterBody(), inputs: { ...INPUTS, details, typedName }, exhibit });
    if (!r.ok) throw new Error("no agreement");
    return agreementFingerprint({ letter: r.agreement.blocks, details, exhibit });
  }

  it("is the same twice, and changes when a detail, the typed name or the selection changes", () => {
    const base = fp();
    expect(fp()).toBe(base);
    expect(fp({ ...TEST_DETAILS, street: "101 Example Street" })).not.toBe(base);
    expect(fp(TEST_DETAILS, exhibitFor(), "Sevetri W Wilson")).not.toBe(base);
    expect(fp(TEST_DETAILS, exhibitFor({ "fold-c2": false }))).not.toBe(base);
    expect(fp(TEST_DETAILS, exhibitFor({ "ci-logo": true }))).not.toBe(base);
  });

  it("the browser's Web Crypto hash equals the server's node hash", async () => {
    const exhibit = exhibitFor();
    const r = assembleAgreement({ body: fullLetterBody(), inputs: INPUTS, exhibit });
    if (!r.ok) throw new Error("no agreement");
    // The fingerprint is over the canonical string, in which the date fields are a fixed placeholder (review item 4).
    expect(await fingerprintOf(r.agreement)).toBe(canonicalFingerprint(r.agreement.canonical));
    expect(await fingerprintOf(r.agreement)).not.toBe(agreementFingerprint({ letter: r.agreement.blocks, details: TEST_DETAILS, exhibit }));
    expect(r.agreement.canonical).not.toContain(INPUTS.dateText);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("small helpers", () => {
  it("formats the address and the address record", () => {
    expect(addressBlock({ ...emptyDetails(), street: "Ærøskøbing 12, 5970 Ærø", city: "Ærø", country: "Denmark" })).toBe("Ærøskøbing 12, 5970 Ærø\nÆrø\nDenmark");
    expect(addressJson(TEST_DETAILS)).toEqual({ street: "100 Example Street", street2: "Suite 4", city: "Miami", region: "FL", postal: "33101", country: "United States" });
  });

  it("shows dates in the firm's zone", () => {
    const at = new Date("2026-11-13T02:30:00Z");
    expect(letterDateText(at, "America/New_York")).toBe("November 12, 2026");
    expect(letterDateText(at, "Asia/Tokyo")).toBe("November 13, 2026");
    expect(letterDateText(at, "Not/AZone")).toBe("November 13, 2026");
    // Review item 7: a signed time always names its zone (the zone's short name from Intl).
    expect(signedAtText("2026-11-12T19:14:00.000Z", "America/New_York")).toBe("November 12, 2026 at 2:14 PM EST");
    expect(signedLineText("2026-11-12T19:14:00.000Z", "America/New_York", "Alex Sample")).toBe("Signed November 12, 2026 at 2:14 PM EST by Alex Sample");
    expect(signedLineText("garbage", "America/New_York", "Alex Sample")).toBe("Signed by Alex Sample");
  });

  it("a signed time names its zone in summer, in the west, abroad, and when the zone is unusable", () => {
    expect(signedAtText("2026-07-04T18:14:00.000Z", "America/New_York")).toBe("July 4, 2026 at 2:14 PM EDT");
    expect(signedAtText("2026-11-12T19:14:00.000Z", "America/Los_Angeles")).toBe("November 12, 2026 at 11:14 AM PST");
    expect(signedAtText("2026-11-12T19:14:00.000Z", "Europe/Berlin")).toBe("November 12, 2026 at 8:14 PM GMT+1");
    expect(signedAtText("2026-11-12T19:14:00.000Z", "UTC")).toBe("November 12, 2026 at 7:14 PM UTC");
    expect(signedAtText("2026-11-12T19:14:00.000Z", "Not/AZone")).toBe("November 12, 2026 at 7:14 PM UTC");
    // The hour that happens twice when the clocks go back is told apart by the zone name.
    expect(signedAtText("2026-11-01T05:30:00.000Z", "America/New_York")).toBe("November 1, 2026 at 1:30 AM EDT");
    expect(signedAtText("2026-11-01T06:30:00.000Z", "America/New_York")).toBe("November 1, 2026 at 1:30 AM EST");
    for (const zone of ["America/New_York", "America/Chicago", "Europe/London", "Asia/Tokyo", "UTC", "Not/AZone"]) {
      expect(signedAtText("2026-11-12T19:14:00.000Z", zone), zone).toMatch(/ (AM|PM) \S+$/);
    }
    expect(signedAtText("garbage", "America/New_York")).toBe("");
  });

  it("the UTC form is ISO 8601", () => {
    expect(signedAtUtcIso("2026-11-12T14:14:03-05:00")).toBe("2026-11-12T19:14:03.000Z");
    expect(signedAtUtcIso("garbage")).toBe("");
  });
});
