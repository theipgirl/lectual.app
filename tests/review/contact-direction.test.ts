import { describe, expect, it } from "vitest";
import { contactKindOf, contactWords, summarizeContact } from "@/lib/review/contact";
import { firmSendersFrom } from "@/lib/mailbox/firm-sender";
import { lastContactText } from "@/lib/review/format";

const now = new Date("2026-11-17T12:00:00Z");
const firm = firmSendersFrom(["info@rpblawfirm.com"]);

describe("review email direction", () => {
  it("an email_received from the firm's own domain is ours (a cc from trademarks@ into info@)", () => {
    const row = { type: "email_received", created_at: "2026-11-10T10:00:00Z", from: "trademarks@rpblawfirm.com" };
    expect(contactKindOf(row, firm)).toBe("email_sent");
    const r = summarizeContact([row], now, firm);
    expect(r.direction).toBe("we");
    expect(r.lastOutbound?.at).toBe("2026-11-10T10:00:00Z");
  });

  it("without firm senders it reads as before", () => {
    const row = { type: "email_received", created_at: "2026-11-10T10:00:00Z", from: "trademarks@rpblawfirm.com" };
    expect(summarizeContact([row], now).direction).toBe("they");
  });

  it("a USPTO notice is last contact with no direction", () => {
    const sent = { type: "email_sent", created_at: "2026-11-01T10:00:00Z" };
    const notice = { type: "email_received", created_at: "2026-11-12T10:00:00Z", party: "uspto" };
    const r = summarizeContact([sent, notice], now, firm);
    expect(r.last).toEqual({ at: "2026-11-12T10:00:00Z", type: "uspto_notice" });
    expect(r.direction).toBe("we");
    expect(contactWords("uspto_notice")).toBe("USPTO notice");
    expect(lastContactText({ contactKnown: true, lastContact: { date: "2026-11-12", type: "uspto_notice" } }, "2026-11-17")).toContain("USPTO notice");
  });

  it("a @uspto.gov sender with no party (an older row) is a notice too", () => {
    expect(contactKindOf({ type: "email_received", created_at: "2026-11-12T10:00:00Z", from: "TEAS@uspto.gov" }, firm)).toBe("uspto_notice");
    const r = summarizeContact([{ type: "email_received", created_at: "2026-11-12T10:00:00Z", from: "TEAS@uspto.gov" }], now, firm);
    expect(r.direction).toBeNull();
    expect(r.last?.type).toBe("uspto_notice");
  });

  it("a client's email stays theirs", () => {
    expect(summarizeContact([{ type: "email_received", created_at: "2026-11-12T10:00:00Z", from: "dana@highway.example" }], now, firm).direction).toBe("they");
  });
});
