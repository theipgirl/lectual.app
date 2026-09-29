import { describe, it, expect } from "vitest";
import { matchMessageToMatter } from "@/lib/mailbox/matter-match";
import type { ThreadMessage } from "@/lib/intake/email-threads";

const msg = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: "m",
  conversationId: null,
  mailbox: "intake@firm.example",
  folder: "inbox",
  direction: "inbound",
  at: null,
  from: { name: "Leslie Ayafor", address: "leslie@ayaforstudio.example" },
  to: [{ name: null, address: "intake@firm.example" }],
  cc: [],
  subject: "Question about AYAFOR",
  preview: "",
  webLink: null,
  ...over,
});

const contacts = [
  { contactId: "c1", email: "Leslie@AyaforStudio.example" },
  { contactId: "c2", email: "someone@intake.invalid" },
];

describe("matching mail to a matter through its contacts", () => {
  it("one matter for the contact → that matter", () => {
    expect(matchMessageToMatter(msg(), contacts, [{ contactId: "c1", matterId: "M1", markText: "AYAFOR" }])).toEqual({ matterId: "M1", basis: "contact-email" });
  });

  it("several matters → the one whose mark is in the subject", () => {
    const links = [
      { contactId: "c1", matterId: "M1", markText: "AYAFOR" },
      { contactId: "c1", matterId: "M2", markText: "STUDIO NINE" },
    ];
    expect(matchMessageToMatter(msg(), contacts, links)).toEqual({ matterId: "M1", basis: "contact-email+mark" });
  });

  it("several matters and no single mark hit → no match (never guess)", () => {
    const links = [
      { contactId: "c1", matterId: "M1", markText: "ALPHA" },
      { contactId: "c1", matterId: "M2", markText: "BETA" },
    ];
    expect(matchMessageToMatter(msg(), contacts, links)).toBeNull();
  });

  it("ignores placeholder addresses and the connected mailbox itself", () => {
    const self = [{ contactId: "c3", email: "intake@firm.example" }];
    expect(matchMessageToMatter(msg(), self, [{ contactId: "c3", matterId: "M9", markText: null }])).toBeNull();
    const placeholder = msg({ from: { name: null, address: "someone@intake.invalid" } });
    expect(matchMessageToMatter(placeholder, contacts, [{ contactId: "c2", matterId: "M5", markText: null }])).toBeNull();
  });

  it("no name or mark matching on its own — only an address counts", () => {
    const stranger = msg({ from: { name: "Leslie Ayafor", address: "leslie@other.example" } });
    expect(matchMessageToMatter(stranger, contacts, [{ contactId: "c1", matterId: "M1", markText: "AYAFOR" }])).toBeNull();
  });
});
