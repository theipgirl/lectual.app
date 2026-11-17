import { describe, it, expect } from "vitest";
import { firmSendersFrom, NO_FIRM_SENDERS, relabelFirmSent } from "@/lib/mailbox/firm-sender";
import { activityTypeFor, buildEmailEvidence, type EvidenceLead } from "@/lib/intake/email-match";
import type { ThreadMessage } from "@/lib/intake/email-threads";

const lead: EvidenceLead = {
  id: "lead-1",
  firstName: "Amara",
  lastName: "Nwosu",
  businessName: null,
  email: "amara@client.example",
  markText: null,
  stageName: null,
  assignedTo: null,
  lastOutboundAt: null,
  lastInboundAt: null,
};

function msg(over: Partial<Omit<ThreadMessage, "from" | "to" | "cc">> & { id: string; from: string; to?: string[]; cc?: string[] }): ThreadMessage {
  const { from, to = [], cc = [], ...rest } = over;
  return {
    conversationId: "c1",
    mailbox: "info@rpblawfirm.com",
    folder: "inbox",
    direction: "inbound",
    at: "2026-11-10T10:00:00Z",
    from: { name: null, address: from },
    to: to.map((address) => ({ name: null, address })),
    cc: cc.map((address) => ({ name: null, address })),
    subject: "Hello",
    preview: "",
    webLink: null,
    ...rest,
  };
}

const senders = firmSendersFrom(["info@rpblawfirm.com"]);

describe("relabelFirmSent", () => {
  it("turns firm mail that arrived as a cc into outbound, leaving others untouched", () => {
    const firm = msg({ id: "a", from: "Support <support@rpblawfirm.com>", to: ["amara@client.example"], cc: ["info@rpblawfirm.com"] });
    const client = msg({ id: "b", from: "amara@client.example", to: ["info@rpblawfirm.com"] });
    const out = relabelFirmSent([firm, client], senders);
    expect(out[0].direction).toBe("outbound");
    expect(out[1]).toBe(client);
    expect(firm.direction).toBe("inbound");
  });

  it("sets lastOutboundAt, not lastInboundAt, and still matches the lead as a recipient", () => {
    const firm = msg({ id: "a", from: "support@rpblawfirm.com", to: ["amara@client.example"], cc: ["info@rpblawfirm.com"] });
    const report = buildEmailEvidence({ messages: relabelFirmSent([firm], senders), leads: [lead], directory: [] });
    expect(report.leads).toHaveLength(1);
    const { cadence } = report.leads[0];
    expect(cadence.lastOutboundAt).toBe("2026-11-10T10:00:00Z");
    expect(cadence.lastInboundAt).toBeNull();
    expect(activityTypeFor(relabelFirmSent([firm], senders)[0].direction)).toBe("email_sent");
  });

  it("without the relabel the same message reads as inbound (the bug)", () => {
    const firm = msg({ id: "a", from: "support@rpblawfirm.com", to: ["amara@client.example"], cc: ["info@rpblawfirm.com"] });
    const report = buildEmailEvidence({ messages: [firm], leads: [lead], directory: [] });
    expect(report.leads[0].cadence.lastInboundAt).not.toBeNull();
  });

  it("keeps client mail inbound", () => {
    const client = msg({ id: "b", from: "amara@client.example", to: ["info@rpblawfirm.com"] });
    const report = buildEmailEvidence({ messages: relabelFirmSent([client], senders), leads: [lead], directory: [] });
    expect(report.leads[0].cadence.lastInboundAt).toBe("2026-11-10T10:00:00Z");
    expect(report.leads[0].cadence.lastOutboundAt).toBeNull();
  });

  it("a public-domain mailbox contributes its exact address only", () => {
    const gmail = firmSendersFrom(["firm.owner@gmail.com"]);
    const own = msg({ id: "c", from: "firm.owner@gmail.com" });
    const stranger = msg({ id: "d", from: "someone.else@gmail.com" });
    const out = relabelFirmSent([own, stranger], gmail);
    expect(out[0].direction).toBe("outbound");
    expect(out[1].direction).toBe("inbound");
  });

  it("no firm senders changes nothing", () => {
    const firm = msg({ id: "a", from: "support@rpblawfirm.com" });
    expect(relabelFirmSent([firm], NO_FIRM_SENDERS)[0]).toBe(firm);
  });
});
