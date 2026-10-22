import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SENSITIVE_PHRASES } from "@/lib/intake/email-match";
import {
  BUCKET_LABEL,
  BUCKET_ORDER,
  ROLE,
  dedupeByConversation,
  domainOf,
  firmDomainsOf,
  triageMessage,
  type Bucket,
  type TriageInput,
} from "@/lib/inbox/triage";

const ctx = { firmDomains: ["firm.example"] };
const msg = (over: Partial<TriageInput>): TriageInput => ({
  id: "m1",
  mailbox: "attorney@firm.example",
  fromName: "Sender",
  fromAddress: "sender@client.example",
  subject: "Hello",
  preview: "",
  receivedDateTime: "2026-10-21T10:00:00Z",
  ...over,
});
const bucketOf = (over: Partial<TriageInput>) => triageMessage(msg(over), ctx);

describe("inbox triage (F11): one table row per bucket", () => {
  const table: Array<[string, Partial<TriageInput>, Bucket, string?]> = [
    ["approve: a teammate's DRAFT prefix", { fromAddress: "mate@firm.example", fromName: "Mate", subject: "DRAFT: reply to Sankofa" }, "approve"],
    ["approve: a teammate asks for approval", { fromAddress: "mate@firm.example", subject: "Welcome email", preview: "Ready to send, can you review?" }, "approve"],
    ["approve outranks needs-you: a drafted office-action notice", { fromAddress: "mate@firm.example", subject: "DRAFT office action notice", preview: "office action deadline" }, "approve"],
    ["needs-you: an urgent phrase", { subject: "Urgent: please advise" }, "needs-you"],
    ["needs-you: a deadline", { subject: "Deadline tomorrow" }, "needs-you"],
    ["needs-you: high importance from a human", { subject: "Quick one", importance: "high" }, "needs-you"],
    ["route: wants a call goes to discovery", { subject: "Can we schedule a call?" }, "route", ROLE.discovery],
    ["route: a questionnaire goes to intake", { subject: "Questionnaire received" }, "route", ROLE.intake],
    ["route: a filing receipt goes to filings", { subject: "Filing receipt attached" }, "route", ROLE.filings],
    ["route: partnership goes to partnerships", { subject: "Collab idea for you" }, "route", ROLE.partnerships],
    ["route: the public intake address goes to intake", { mailbox: "info@firm.example", subject: "Hi there", preview: "I run a bakery" }, "route", ROLE.intake],
    ["scam: a directory fee from a commercial domain", { fromAddress: "billing@tm-register.example", subject: "Trademark registration fee due", preview: "your payment is due" }, "scam"],
    ["fyi: an out-of-office", { subject: "Automatic reply: away" }, "fyi"],
    ["fyi: an unmatched ordinary message is fyi and never needs-you", { subject: "Thanks for the info", preview: "Great, talk soon" }, "fyi"],
    ["fyi: internal firm mail with no signal", { fromAddress: "mate@firm.example", subject: "Lunch?" }, "fyi"],
    ["low: marketing", { subject: "Special offer: boost your reach", preview: "limited time" }, "low"],
  ];
  it.each(table)("%s", (_name, over, bucket, role) => {
    const t = bucketOf(over);
    expect(t.bucket).toBe(bucket);
    expect(t.reason.length).toBeGreaterThan(0);
    if (role) expect(t.assignTo).toBe(role);
  });

  it("scam runs before urgency: a fake with urgent words is not promoted to needs-you", () => {
    const t = bucketOf({ fromAddress: "x@tm-directory.example", subject: "FINAL NOTICE urgent: trademark registration fee", preview: "deadline wire transfer" });
    expect(t.bucket).toBe("scam");
  });

  it("marketing runs before urgency: a CLE ad naming litigation is low, not needs-you", () => {
    const t = bucketOf({ fromAddress: "ads@cle-vendor.example", subject: "Elder Financial Abuse Litigation: register now" });
    expect(t.bucket).toBe("low");
  });

  it("a word like 'circle' is not the marketing marker 'cle'", () => {
    expect(bucketOf({ subject: "Circle back on the deadline" }).bucket).toBe("needs-you");
  });

  it("USPTO: an office action or refusal is needs-you for the attorney, anything else from the office is routed", () => {
    expect(bucketOf({ fromAddress: "notices@uspto.gov", subject: "Office Action for serial 90000001" })).toMatchObject({ bucket: "needs-you", assignTo: ROLE.attorney });
    expect(bucketOf({ fromAddress: "notices@uspto.gov", subject: "Filing receipt", preview: "thank you" })).toMatchObject({ bucket: "route", assignTo: ROLE.filings });
  });

  it("an internal teammate's draft is approve, not needs-you, even from the firm's subdomain", () => {
    expect(triageMessage(msg({ fromAddress: "x@mail.firm.example", subject: "[Draft] reply" }), ctx).bucket).toBe("approve");
  });

  it("without the firm's domains an internal sender is just a sender", () => {
    expect(triageMessage(msg({ fromAddress: "mate@firm.example", subject: "DRAFT: reply" }), { firmDomains: [] }).bucket).toBe("fyi");
  });
});

describe("the sensitive flag", () => {
  it.each([...SENSITIVE_PHRASES])("%s marks the message sensitive and lands in needs-you", (phrase) => {
    const t = bucketOf({ subject: `Re: the ${phrase} matter` });
    expect(t.sensitive).toBe(true);
    expect(t.bucket).toBe("needs-you");
  });
  it("an ordinary message is not sensitive", () => {
    expect(bucketOf({ subject: "Hello", preview: "How are you" }).sensitive).toBe(false);
  });
});

describe("conversations, order and labels", () => {
  it("dedupe keeps the first copy of a thread and merges the mailboxes", () => {
    const rows = [
      { id: "a", mailbox: "me@firm.example", c: "t1" },
      { id: "b", mailbox: "info@firm.example", c: "t1" },
      { id: "c", mailbox: "info@firm.example", c: "t2" },
      { id: "d", mailbox: "me@firm.example", c: null as string | null },
    ];
    const out = dedupeByConversation(rows, (r) => r.c);
    expect(out.map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(out[0].mailbox).toBe("me@firm.example · info@firm.example");
  });
  it("the bucket order and labels are the plugin's", () => {
    expect(BUCKET_ORDER).toEqual(["approve", "needs-you", "route", "scam", "fyi", "low"]);
    expect(BUCKET_LABEL.scam).toMatch(/do not engage/);
  });
  it("the firm's domains come from its connected mailbox addresses", () => {
    expect(domainOf("A@Firm.Example")).toBe("firm.example");
    expect(firmDomainsOf(["a@firm.example", "b@firm.example", "c@other.example"])).toEqual(["firm.example", "other.example"]);
  });
});

describe("the port is pure and names no one", () => {
  const source = readFileSync("src/lib/inbox/triage.ts", "utf8");
  it("reads no environment variable", () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
  });
  it("names no RPB staff member and no firm", () => {
    for (const name of ["Rebecca", "Dawn", "Rayn", "Taylor", "Caitlyn", "Amor", "rpblawfirm", "RPB"]) expect(source).not.toContain(name);
  });
  it("takes the six sensitive phrases from the app's own list", () => {
    expect(source).toContain("...SENSITIVE_PHRASES");
    for (const p of SENSITIVE_PHRASES) expect(source).not.toContain(`"${p}"`);
  });
  it("assignTo is a role label", () => {
    expect(Object.values(ROLE)).toEqual(["Attorney", "Intake", "Filings", "Partnerships", "Discovery calls"]);
  });
});
