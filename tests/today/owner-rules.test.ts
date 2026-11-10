import { describe, expect, it } from "vitest";
import { cardsHero, deadlineChip, proposalTone, cardsLine, copilotHref, dueText, ownerDeadlines, proposalsOut, weekStrip } from "@/lib/today/owner-rules";

const NOW = new Date("2026-11-10T15:00:00Z");
const TZ = "America/New_York";

describe("owner Today rules", () => {
  it("cardsLine: never a count for a failed read", () => {
    expect(cardsLine({ status: "unavailable" }).headline).toBe("Couldn't load your cards.");
    expect(cardsLine({ status: "unconfigured" }).canStart).toBe(false);
    const ok = cardsLine({ status: "ok", count: 1, minutes: 2, dealLabel: "7:00 AM", nextDealLabel: "2:00 PM", laterArrivals: 3 });
    expect(ok.headline).toBe("1 card needs you · about 2 min");
    expect(ok.sub).toBe("Next deal 2:00 PM. 3 more at 2:00 PM.");
    expect(cardsLine({ status: "ok", count: 0, minutes: 0, dealLabel: null, nextDealLabel: "7:00 AM", laterArrivals: 0 }).headline).toBe("All decided. Next deal 7:00 AM.");
  });

  it("ownerDeadlines keeps overdue, drops anything past 14 days", () => {
    const base = { id: "a", matter_id: "m", title: "X", kind: "office_action", matter_number: "TM-1", matter_title: "T", attorney_confirmed: true } as never;
    const rows = ownerDeadlines(
      [
        { ...(base as object), id: "late", due_date: "2026-11-08" },
        { ...(base as object), id: "soon", due_date: "2026-11-24" },
        { ...(base as object), id: "far", due_date: "2026-11-25" },
      ] as never,
      NOW,
      TZ,
    );
    expect(rows.map((r) => r.key)).toEqual(["late", "soon"]);
    expect(rows[0].overdueDays).toBe(2);
    expect(dueText(rows[0], "2026-11-10")).toBe("2 days overdue");
    expect(dueText(rows[1], "2026-11-10")).toBe("Due in 14 days");
  });

  it("proposalsOut lists only live (sent) ones, expired first", () => {
    const p = (id: string, status: string, expires_on: string | null) => ({ id, family_id: id, client_name: id, title: "t", status, expires_on });
    const out = proposalsOut([p("a", "sent", "2026-11-20"), p("b", "draft", null), p("c", "sent", "2026-11-01"), p("d", "accepted", null)], "2026-11-10");
    expect(out.map((o) => o.id)).toEqual(["c", "a"]);
    expect(out[0]).toMatchObject({ expired: true, expiry: "Expired Nov 1" });
  });

  it("weekStrip: seven days in firm time, unknown sources are null", () => {
    const days = weekStrip({ now: NOW, tz: TZ, consults: [{ startsAt: "2026-11-11T02:00:00Z" } as never], deadlines: null });
    expect(days).toHaveLength(7);
    expect(days[0].isToday).toBe(true);
    // 02:00Z on the 11th is 9 pm on the 10th in New York.
    expect(days[0].consults).toBe(1);
    expect(days[0].deadlines).toBeNull();
  });

  it("copilotHref trims and encodes", () => {
    expect(copilotHref("  what is due? ")).toBe("/dashboard/copilot/?q=what%20is%20due%3F");
    expect(copilotHref("   ")).toBe("/dashboard/copilot/");
  });

  it("cardsHero: a number only for a read queue with cards; the deal line names the opened deal", () => {
    expect(cardsHero({ status: "unavailable" })).toMatchObject({ big: null, message: "Couldn't load your cards.", canStart: false });
    const ok = cardsHero({ status: "ok", count: 6, minutes: 8, dealLabel: "7:00 AM", nextDealLabel: "2:00 PM", laterArrivals: 0 });
    expect(ok).toMatchObject({ big: "6", unit: "cards for you", about: "about 8 min", dealLine: "Deal opened 7:00 AM. Next deal 2:00 PM.", canStart: true });
    expect(cardsHero({ status: "ok", count: 0, minutes: 0, dealLabel: null, nextDealLabel: "2:00 PM", laterArrivals: 0 })).toMatchObject({ big: null, message: "All decided. Next deal 2:00 PM." });
  });

  it("day chips and tones; a proposal's tone follows its last day", () => {
    expect(deadlineChip({ dueDate: "2026-11-14", overdueDays: 0 }, "2026-11-10")).toEqual({ text: "4 days", tone: "risk" });
    expect(deadlineChip({ dueDate: "2026-11-18", overdueDays: 0 }, "2026-11-10")).toEqual({ text: "8 days", tone: "warn" });
    expect(deadlineChip({ dueDate: "2026-11-07", overdueDays: 3 }, "2026-11-10")).toEqual({ text: "3 days overdue", tone: "risk" });
    expect(proposalTone({ expired: false, expiresOn: "2026-11-20" }, "2026-11-10")).toBe("plain");
    expect(proposalTone({ expired: true, expiresOn: "2026-11-05" }, "2026-11-10")).toBe("risk");
  });
});
