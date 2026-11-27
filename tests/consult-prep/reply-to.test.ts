// S2c: the reply-to of a consult prep email goes only to a firm address.

import { describe, expect, it } from "vitest";
import { guardReplyTo, senderAddress } from "@/lib/consult-prep/recipients";

const FROM = "RPB Law Firm <brief@rpblawfirm.com>";
const TO = ["rebecca@rpblawfirm.com"];

describe("guardReplyTo", () => {
  it("reads the sender's address out of a From header", () => {
    expect(senderAddress(FROM)).toBe("brief@rpblawfirm.com");
    expect(senderAddress("brief@rpblawfirm.com")).toBe("brief@rpblawfirm.com");
    expect(senderAddress("RPB <not an address>")).toBeNull();
  });
  it("allows an address on the sender's own domain", () => {
    expect(guardReplyTo({ replyTo: "info@rpblawfirm.com", from: FROM, to: [], clientAddresses: [] })).toBe("info@rpblawfirm.com");
    expect(guardReplyTo({ replyTo: " Info@RPBLawFirm.com ", from: FROM, to: TO, clientAddresses: [] })).toBe("info@rpblawfirm.com");
  });
  it("allows an address on a recipient's domain (the Cc rule), so a sender on another domain still works", () => {
    expect(guardReplyTo({ replyTo: "info@rpblawfirm.com", from: "Lectual <prep@lectual.app>", to: TO, clientAddresses: [] })).toBe("info@rpblawfirm.com");
  });
  it("refuses anything else: another domain, the client's own address, a display name or a list", () => {
    expect(guardReplyTo({ replyTo: "someone@elsewhere.example", from: FROM, to: TO, clientAddresses: [] })).toBeNull();
    expect(guardReplyTo({ replyTo: "dana@rpblawfirm.com", from: FROM, to: TO, clientAddresses: ["Dana@rpblawfirm.com"] })).toBeNull();
    expect(guardReplyTo({ replyTo: "Info <info@rpblawfirm.com>", from: FROM, to: TO, clientAddresses: [] })).toBeNull();
    expect(guardReplyTo({ replyTo: "info@rpblawfirm.com, x@rpblawfirm.com", from: FROM, to: TO, clientAddresses: [] })).toBeNull();
    expect(guardReplyTo({ replyTo: null, from: FROM, to: TO, clientAddresses: [] })).toBeNull();
  });
  it("on a public webmail domain the domain proves nothing: only a recipient's exact address", () => {
    expect(guardReplyTo({ replyTo: "someone@gmail.com", from: "Firm <firm@gmail.com>", to: ["rebecca@gmail.com"], clientAddresses: [] })).toBeNull();
    expect(guardReplyTo({ replyTo: "rebecca@gmail.com", from: "Firm <firm@gmail.com>", to: ["rebecca@gmail.com"], clientAddresses: [] })).toBe("rebecca@gmail.com");
  });
});

describe("testRecipientsOnFirmDomains (the test brief's explicit check)", () => {
  it("firm domains are the sender's and the firm's connected mailboxes'; every To and Cc must be on one, or be a firm mailbox", async () => {
    const { testRecipientsOnFirmDomains } = await import("@/lib/consult-prep/recipients");
    const boxes = ["rebecca@rpblawfirm.com"];
    expect(testRecipientsOnFirmDomains({ to: ["rebecca@rpblawfirm.com"], cc: ["info@rpblawfirm.com"], from: FROM, firmAddresses: [] })).toBe(true);
    // the sender is on another domain: the firm's mailboxes carry the domain
    expect(testRecipientsOnFirmDomains({ to: ["rebecca@rpblawfirm.com"], cc: [], from: "Lectual <prep@lectual.app>", firmAddresses: boxes })).toBe(true);
    expect(testRecipientsOnFirmDomains({ to: ["rebecca@rpblawfirm.com"], cc: [], from: "Lectual <prep@lectual.app>", firmAddresses: [] })).toBe(false);
    expect(testRecipientsOnFirmDomains({ to: [], cc: ["info@rpblawfirm.com"], from: FROM, firmAddresses: boxes })).toBe(false);
    expect(testRecipientsOnFirmDomains({ to: ["rebecca@rpblawfirm.com"], cc: ["x@elsewhere.example"], from: FROM, firmAddresses: boxes })).toBe(false);
    // a member's personal address is not the firm's, unless it is one of the firm's connected mailboxes (exactly)
    expect(testRecipientsOnFirmDomains({ to: ["rebecca@gmail.com"], cc: [], from: FROM, firmAddresses: boxes })).toBe(false);
    expect(testRecipientsOnFirmDomains({ to: ["rebecca@gmail.com"], cc: [], from: FROM, firmAddresses: ["rebecca@gmail.com"] })).toBe(true);
    expect(testRecipientsOnFirmDomains({ to: ["someone@gmail.com"], cc: [], from: FROM, firmAddresses: ["rebecca@gmail.com"] })).toBe(false);
    expect(testRecipientsOnFirmDomains({ to: ["not an address"], cc: [], from: FROM, firmAddresses: boxes })).toBe(false);
  });
});
