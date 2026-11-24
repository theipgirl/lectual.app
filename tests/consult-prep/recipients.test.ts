import { describe, expect, it } from "vitest";
import { MAX_CC, bareAddress, guardRecipients, parseRecipientSetting, splitTypedAddresses, validateCcForSave } from "@/lib/consult-prep/recipients";

describe("bare addresses", () => {
  it("accepts a plain address, lowercased and trimmed", () => {
    expect(bareAddress("  Info@RPB.example ")).toBe("info@rpb.example");
  });
  it.each(["Rebecca <rebecca@x.example>", "a@b", "a b@c.example", "a@b.example, c@d.example", "", "@x.example", "a@@x.example", "a@x.example>", "\"a\"@x.example"])("refuses %j", (v) => {
    expect(bareAddress(v)).toBeNull();
  });
  it("refuses a non-string", () => {
    expect(bareAddress(null)).toBeNull();
    expect(bareAddress(42)).toBeNull();
  });
});

describe("the stored setting", () => {
  it("reads ids and Cc, drops what is not the right shape, and de-duplicates", () => {
    expect(parseRecipientSetting({ user_ids: ["a", "a", 3, ""], cc: ["Info@Firm.example", "bad", "info@firm.example"] })).toEqual({ userIds: ["a"], cc: ["info@firm.example"] });
    for (const junk of [null, undefined, [], "x", 3]) expect(parseRecipientSetting(junk)).toEqual({ userIds: [], cc: [] });
  });
});

describe("the recipient guard", () => {
  const to = ["attorney@firm.example", "clerk@firm.example"];
  it("keeps To, and a Cc on a To member's domain", () => {
    expect(guardRecipients({ to, cc: ["info@firm.example"], clientAddresses: ["dana@client.example"] })).toMatchObject({ to, cc: ["info@firm.example"], refusedCc: 0 });
  });
  it("drops a Cc on a domain no To member is on", () => {
    expect(guardRecipients({ to, cc: ["info@firm.example", "x@elsewhere.example"], clientAddresses: [] })).toMatchObject({ cc: ["info@firm.example"], refusedCc: 1 });
  });
  it("never sends to the lead's own address, in To or in Cc, whatever its case", () => {
    const g = guardRecipients({ to: [...to, "Dana@Client.example"], cc: ["dana@client.example", "info@client.example"], clientAddresses: ["DANA@client.example"] });
    expect(g.to).toEqual(to);
    expect(g.cc).toEqual(["info@client.example"].filter(() => false));
    expect(g.refusedTo).toBe(1);
  });
  it("a Cc on the client's domain is allowed only if a member is on that domain (the rule is the domain, not the client)", () => {
    expect(guardRecipients({ to: ["me@client.example"], cc: ["boss@client.example"], clientAddresses: ["dana@client.example"] }).cc).toEqual(["boss@client.example"]);
  });
  it("an address that is both To and Cc is sent once", () => {
    expect(guardRecipients({ to, cc: [to[0]], clientAddresses: [] }).cc).toEqual([]);
  });
  it("no To left is no send", () => {
    expect(guardRecipients({ to: [], cc: ["info@firm.example"], clientAddresses: [] })).toMatchObject({ to: [], cc: [] });
    expect(guardRecipients({ to: ["dana@client.example"], cc: ["info@client.example"], clientAddresses: ["dana@client.example"] })).toMatchObject({ to: [], cc: [] });
  });
  it("junk in To or Cc is dropped; Cc is capped", () => {
    const many = Array.from({ length: 9 }, (_, i) => `c${i}@firm.example`);
    expect(guardRecipients({ to: ["not an address", ...to], cc: ["junk", ...many], clientAddresses: [] }).cc).toHaveLength(MAX_CC);
    expect(guardRecipients({ to: ["not an address", ...to], cc: [], clientAddresses: [] }).to).toEqual(to);
  });
});

describe("the check when the setting is saved", () => {
  const to = ["attorney@firm.example"];
  it("accepts bare addresses on a chosen member's domain", () => {
    expect(validateCcForSave(["info@firm.example", " Info@Firm.example ", ""], to)).toEqual({ ok: true, cc: ["info@firm.example"] });
    expect(validateCcForSave([], to)).toEqual({ ok: true, cc: [] });
  });
  it("refuses a format, a foreign domain and too many", () => {
    expect(validateCcForSave(["Name <info@firm.example>"], to)).toEqual({ ok: false, reason: "format" });
    expect(validateCcForSave(["info@elsewhere.example"], to)).toEqual({ ok: false, reason: "domain" });
    expect(validateCcForSave(Array.from({ length: MAX_CC + 1 }, (_, i) => `c${i}@firm.example`), to)).toEqual({ ok: false, reason: "count" });
  });
  it("with nobody chosen no Cc is allowed", () => {
    expect(validateCcForSave(["info@firm.example"], [])).toEqual({ ok: false, reason: "domain" });
  });
  it("splits what a person typed", () => {
    expect(splitTypedAddresses("a@x.example, b@x.example;c@x.example\n d@x.example")).toEqual(["a@x.example", "b@x.example", "c@x.example", "d@x.example"]);
  });
});
