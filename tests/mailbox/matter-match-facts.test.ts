import { describe, it, expect } from "vitest";
import { markName, matchMatterEvidence, matchMessageToMatter, serialNumbersIn, type MatterCandidate } from "@/lib/mailbox/matter-match";
import { isUsptoSender } from "@/lib/mailbox/firm-sender";
import { activityPayloadForMessage } from "@/lib/intake/email-match";
import type { ThreadMessage } from "@/lib/intake/email-threads";

const m = (over: Partial<MatterCandidate> & { matterId: string }): MatterCandidate => ({
  markText: null,
  serialNumber: null,
  leadEmails: [],
  ownerName: null,
  ...over,
});

const ev = (subject: string, preview = "", participants: string[] = []) => ({ subject, preview, participants });

const MATTERS: MatterCandidate[] = [
  m({ matterId: "highway", markText: "Highway Homes", serialNumber: "99302700", ownerName: "Dana Reed", leadEmails: ["dana@highway.example"] }),
  m({ matterId: "dream", markText: "PERMISSION TO DREAM (Word Mark)", serialNumber: "99887960" }),
  m({ matterId: "pl", markText: "PL (Design Mark)", serialNumber: null }),
  m({ matterId: "jay-word", markText: "Jay Mompre (Word Mark)", ownerName: "Jay Mompre" }),
  m({ matterId: "jay-logo", markText: "Jay Mompre (Logo Mark)", ownerName: "Jay Mompre" }),
  m({ matterId: "ext", markText: "Northwind Teas", serialNumber: "99768425" }),
  m({ matterId: "new", markText: "Brightline Studio LLC", serialNumber: "50220242" }),
];

describe("serial numbers", () => {
  it("finds labelled and bare 8-digit serials", () => {
    expect([...serialNumbersIn("Office Action Received – U.S. Trademark Application No. 99302700")]).toEqual(["99302700"]);
    expect([...serialNumbersIn("Official USPTO Notification: U.S. Trademark Application SN 99887960 - PERMISSION TO DREAM")]).toContain("99887960");
    expect([...serialNumbersIn("Serial Number 99768425: Received Your Request for Extension")]).toContain("99768425");
    expect([...serialNumbersIn("The USPTO has received your trademark application (serial number 50220242)")]).toContain("50220242");
    expect([...serialNumbersIn("call me at 123456789 or ref 12345678")]).toEqual([]);
  });

  it("a serial equal to a matter's serial_number picks that matter", () => {
    expect(matchMatterEvidence(ev("Office Action Received – U.S. Trademark Application No. 99302700"), MATTERS)).toEqual({ matterId: "highway", basis: "serial" });
    expect(matchMatterEvidence(ev("Serial Number 99768425: Received Your Request for Extension of Time"), MATTERS)).toEqual({ matterId: "ext", basis: "serial" });
    expect(matchMatterEvidence(ev("The USPTO has received your trademark application (serial number 50220242)"), MATTERS)).toEqual({ matterId: "new", basis: "serial" });
  });

  it("one serial on two matters is no match", () => {
    const dup = [m({ matterId: "a", serialNumber: "99302700" }), m({ matterId: "b", serialNumber: "99-302,700" })];
    expect(matchMatterEvidence(ev("Application No. 99302700"), dup)).toBeNull();
  });
});

describe("mark phrase", () => {
  it("strips decorations", () => {
    expect(markName("Jay Mompre (Logo Mark)")).toEqual({ name: "jay mompre", kind: "logo" });
    expect(markName("Word Mark- Highway Homes")).toEqual({ name: "highway homes", kind: "word" });
    expect(markName("Brightline Studio LLC")).toEqual({ name: "brightline studio", kind: null });
    expect(markName("PL (Design Mark)")).toEqual({ name: "pl", kind: "logo" });
  });

  it("a whole phrase in the subject, any case and quote style, picks the matter", () => {
    expect(matchMatterEvidence(ev("Re: Opinion on Trademark Availability: Highway Homes"), MATTERS)).toEqual({ matterId: "highway", basis: "mark" });
    expect(matchMatterEvidence(ev("“HIGHWAY HOMES” next steps"), MATTERS)).toEqual({ matterId: "highway", basis: "mark" });
  });

  it("reads the preview too (the filing receipt names the mark only there)", () => {
    expect(
      matchMatterEvidence(ev("Your Trademark Filing Receipt Inside!", "your trademark application for HIGHWAY HOMES has been successfully filed"), MATTERS),
    ).toEqual({ matterId: "highway", basis: "mark" });
  });

  it("needs word boundaries and at least 4 letters", () => {
    expect(matchMatterEvidence(ev("Highwayhomes promo"), MATTERS)).toBeNull();
    expect(matchMatterEvidence(ev("PL update"), MATTERS)).toBeNull();
  });

  it("a shorter mark swallowed by a longer one that also appears is the longer one's", () => {
    const ms = [m({ matterId: "short", markText: "Highway" }), m({ matterId: "long", markText: "Highway Homes" })];
    expect(matchMatterEvidence(ev("Highway Homes renewal"), ms)).toEqual({ matterId: "long", basis: "mark" });
    expect(matchMatterEvidence(ev("Highway only"), ms)).toEqual({ matterId: "short", basis: "mark" });
  });

  it("word + logo of one owner files on neither, unless the text says which", () => {
    expect(matchMatterEvidence(ev("Re: Jay Mompre application"), MATTERS)).toBeNull();
    expect(matchMatterEvidence(ev("Re: Jay Mompre logo application"), MATTERS)).toEqual({ matterId: "jay-logo", basis: "mark" });
    expect(matchMatterEvidence(ev("Re: Jay Mompre design specimen"), MATTERS)).toEqual({ matterId: "jay-logo", basis: "mark" });
    expect(matchMatterEvidence(ev("Re: Jay Mompre word mark"), MATTERS)).toEqual({ matterId: "jay-word", basis: "mark" });
    expect(matchMatterEvidence(ev("Re: Jay Mompre word and logo"), MATTERS)).toBeNull();
  });

  it("a generic single word is never a mark match", () => {
    expect(matchMatterEvidence(ev("Office Action Received"), [m({ matterId: "x", markText: "Office" })])).toBeNull();
  });
});

describe("lead email and owner", () => {
  it("a participant equal to the linked lead's email picks the matter", () => {
    expect(matchMatterEvidence(ev("Quick question", "", ["Dana@Highway.example"]), MATTERS)).toEqual({ matterId: "highway", basis: "lead-email" });
  });

  it("one address on two matters is no match", () => {
    const ms = [m({ matterId: "a", leadEmails: ["x@y.example"] }), m({ matterId: "b", leadEmails: ["x@y.example"] })];
    expect(matchMatterEvidence(ev("Hello", "", ["x@y.example"]), ms)).toBeNull();
  });

  it("the owner's name alone never matches", () => {
    expect(matchMatterEvidence(ev("Dana Reed says hi"), MATTERS)).toBeNull();
  });

  it("serial wins over mark, mark wins over lead email", () => {
    expect(matchMatterEvidence(ev("Application No. 99768425 Highway Homes", "", ["dana@highway.example"]), MATTERS)).toEqual({ matterId: "ext", basis: "serial" });
    expect(matchMatterEvidence(ev("Northwind Teas", "", ["dana@highway.example"]), MATTERS)).toEqual({ matterId: "ext", basis: "mark" });
  });
});

const msg = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: "m1",
  conversationId: null,
  mailbox: "info@firm.example",
  folder: "inbox",
  direction: "inbound",
  at: null,
  from: { name: null, address: "TMOfficialNotices@uspto.gov" },
  to: [{ name: null, address: "info@firm.example" }],
  cc: [],
  subject: "Official USPTO Notification: U.S. Trademark Application SN 99887960 - PERMISSION TO DREAM",
  preview: "",
  webLink: null,
  ...over,
});

describe("matchMessageToMatter", () => {
  it("the contact rule keeps its match; the facts are tried only when it finds nothing", () => {
    const contacts = [{ contactId: "c", email: "client@x.example" }];
    const links = [{ contactId: "c", matterId: "contact-matter", markText: null }];
    expect(matchMessageToMatter(msg({ from: { name: null, address: "client@x.example" } }), contacts, links, MATTERS)).toEqual({ matterId: "contact-matter", basis: "contact-email" });
    expect(matchMessageToMatter(msg(), contacts, links, MATTERS)).toEqual({ matterId: "dream", basis: "serial" });
  });

  it("the connected mailbox is never the lead's address", () => {
    const ms = [m({ matterId: "a", leadEmails: ["info@firm.example"] })];
    expect(matchMessageToMatter(msg({ subject: "hi", from: { name: null, address: "x@y.example" } }), [], [], ms)).toBeNull();
  });
});

describe("USPTO direction", () => {
  it("knows a USPTO sender", () => {
    expect(isUsptoSender("TEAS@uspto.gov")).toBe(true);
    expect(isUsptoSender("Notices <tmofficialnotices@uspto.gov>")).toBe(true);
    expect(isUsptoSender("x@mail.uspto.gov")).toBe(true);
    expect(isUsptoSender("x@notuspto.gov")).toBe(false);
    expect(isUsptoSender(null)).toBe(false);
  });

  it("stores party: uspto on its payload, and nothing on a client's", () => {
    const base = { confidence: 1, basis: "email" as const, type: "other" as never, sensitive: false };
    expect(activityPayloadForMessage({ ...base, message: msg() })).toMatchObject({ party: "uspto", direction: "inbound" });
    expect(activityPayloadForMessage({ ...base, message: msg({ from: { name: null, address: "c@x.example" } }) })).not.toHaveProperty("party");
  });
});
