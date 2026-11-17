import { describe, it, expect } from "vitest";
import { groupMailByDay, mailTime, safeMailLink, toMailRows, type MailActivity } from "@/lib/mailbox/my-mail";

const NOW = new Date("2026-09-26T15:00:00Z"); // Sat 26 Sep 2026, 3pm UTC
const TZ = "UTC";
const act = (id: string, at: string, o: Partial<MailActivity> = {}, p: Record<string, unknown> = {}): MailActivity => ({
  id,
  type: "email_received",
  created_at: at,
  lead_id: null,
  matter_id: null,
  payload: { source: "mailbox-sync", from: "amara@sankofa.example", to: ["dana@firm.example"], subject: "Re: filing", at, connection_id: "c1", web_link: "https://mail.google.com/mail/?authuser=x#all/1", ...p },
  ...o,
});
const names = { leads: new Map([["l1", "Sankofa Brew"]]), matters: new Map([["m1", "SANKOFA"]]) };

describe("toMailRows", () => {
  it("prefers the matter over the lead for the client tag, newest first", () => {
    const rows = toMailRows(
      [act("a", "2026-09-20T10:00:00Z", { lead_id: "l1" }), act("b", "2026-09-25T10:00:00Z", { lead_id: "l1", matter_id: "m1" })],
      names,
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[0].client).toEqual({ label: "SANKOFA", href: "/dashboard/matters/m1/" });
    expect(rows[1].client).toEqual({ label: "Sankofa Brew", href: "/dashboard/leads/l1/" });
  });
  it("reads direction from the activity type and survives a malformed payload", () => {
    const [r] = toMailRows([{ id: "x", type: "email_sent", created_at: "2026-09-26T09:00:00Z", lead_id: null, matter_id: null, payload: null }], names);
    expect(r).toMatchObject({ direction: "out", from: "Unknown sender", subject: "(no subject)", to: [], link: null, client: null });
  });
});

describe("safeMailLink", () => {
  it("only lets https links to the mail clients through", () => {
    expect(safeMailLink("https://mail.google.com/mail/#all/1")).toBeTruthy();
    expect(safeMailLink("https://outlook.office365.com/owa/?ItemID=1")).toBeTruthy();
    expect(safeMailLink("javascript:alert(1)")).toBeNull();
    expect(safeMailLink("https://mail.google.com.evil.example/x")).toBeNull();
    expect(safeMailLink("http://mail.google.com/x")).toBeNull();
  });
});

describe("groupMailByDay", () => {
  it("buckets into today, yesterday, this week and earlier, skipping empty groups", () => {
    const rows = toMailRows(
      [
        act("t", "2026-09-26T09:00:00Z"),
        act("y", "2026-09-25T22:00:00Z"),
        act("w", "2026-09-22T09:00:00Z"),
        act("e", "2026-08-01T09:00:00Z"),
      ],
      names,
    );
    expect(groupMailByDay(rows, NOW, TZ).map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["today", ["t"]],
      ["yesterday", ["y"]],
      ["week", ["w"]],
      ["earlier", ["e"]],
    ]);
    expect(groupMailByDay([], NOW, TZ)).toEqual([]);
  });
});

describe("mailTime", () => {
  it("shows a clock today, else a date (never a weekday), in the firm's zone", () => {
    expect(mailTime("2026-09-26T08:12:00Z", NOW, TZ)).toBe("8:12 AM");
    expect(mailTime("2026-09-23T08:00:00Z", NOW, TZ)).toBe("Sep 23");
    expect(mailTime("2026-08-01T08:00:00Z", NOW, TZ)).toBe("Aug 1");
    expect(mailTime("2025-08-01T08:00:00Z", NOW, TZ)).toBe("Aug 1, 2025");
    // 03:30 UTC on the 26th is still the evening of the 25th in New York.
    expect(mailTime("2026-09-26T03:30:00Z", NOW, "America/New_York")).toBe("Sep 25");
  });
});
