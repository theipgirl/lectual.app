import { describe, it, expect } from "vitest";
import { groupMailByDay, mailTime, safeMailLink, toMailRows, type MailActivity } from "@/lib/mailbox/my-mail";

const NOW = new Date(2026, 8, 26, 15, 0); // Sat 26 Sep 2026, 3pm local
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
        act("t", new Date(2026, 8, 26, 9).toISOString()),
        act("y", new Date(2026, 8, 25, 22).toISOString()),
        act("w", new Date(2026, 8, 22, 9).toISOString()),
        act("e", new Date(2026, 7, 1, 9).toISOString()),
      ],
      names,
    );
    expect(groupMailByDay(rows, NOW).map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["today", ["t"]],
      ["yesterday", ["y"]],
      ["week", ["w"]],
      ["earlier", ["e"]],
    ]);
    expect(groupMailByDay([], NOW)).toEqual([]);
  });
});

describe("mailTime", () => {
  it("shows a clock today, a weekday this week, a date before that", () => {
    expect(mailTime(new Date(2026, 8, 26, 8, 12).toISOString(), NOW)).toMatch(/8:12/);
    expect(mailTime(new Date(2026, 8, 23, 8).toISOString(), NOW)).toBe("Wed");
    expect(mailTime(new Date(2026, 7, 1, 8).toISOString(), NOW)).toBe("Aug 1");
  });
});
