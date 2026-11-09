import { describe, expect, it } from "vitest";
import { reviewBuckets } from "@/lib/review/buckets";
import { buildDeck, chosenPerson, defaultPerson, deckPeople } from "@/lib/review/deck";
import { parseOpenParam } from "@/lib/review/open";
import { parseReviewParams, reviewHref } from "@/lib/review/params";
import { snoozeDate } from "@/lib/review/snooze";
import { activityLines, clipNote, leadStageChoices } from "@/lib/review/detail";
import { initials } from "@/lib/review/format";
import { limitTags, rowTags } from "@/lib/review/tags";
import { noticeFor } from "@/lib/review/notice";
import { row, TODAY } from "./fixtures";

const ID = "00000000-0000-4000-8000-0000000000aa";
const members = [
  { userId: "u-rayn", name: "Rayn", role: "paralegal" },
  { userId: "u-reb", name: "Rebecca Pasha", role: "owner" },
  { userId: "u-att", name: "Anna", role: "attorney" },
];
const step = (dueDate: string | null, assigneeId: string | null) => ({ id: "t", title: "x", dueDate, assigneeId });

describe("parseOpenParam", () => {
  it("accepts only matter: or lead: plus a uuid", () => {
    expect(parseOpenParam(`matter:${ID}`)).toEqual({ kind: "matter", id: ID });
    expect(parseOpenParam(`lead:${ID.toUpperCase()}`)).toEqual({ kind: "lead", id: ID });
    expect(parseOpenParam([`lead:${ID}`, "x"])).toEqual({ kind: "lead", id: ID });
  });
  it("everything else is null", () => {
    for (const bad of [undefined, "", "matter", "matter:", `task:${ID}`, `matter:${ID}x`, `matter:../${ID}`, "lead:1", ` ${ID}`, `matter/${ID}`, `matter:${ID}&view=board`])
      expect(parseOpenParam(bad)).toBeNull();
  });
  it("round-trips through the review URL, with the other params kept", () => {
    const p = parseReviewParams({ view: "cards", person: ID, i: "3", kind: "leads", open: `lead:${ID}` });
    expect(p).toMatchObject({ view: "cards", person: ID, i: 3, kind: "lead", open: { kind: "lead", id: ID } });
    expect(parseReviewParams(Object.fromEntries(new URL(reviewHref(p), "http://x").searchParams))).toEqual(p);
    expect(parseReviewParams({ person: "not-a-uuid" }).person).toBeNull();
  });
});

describe("snoozeDate (the firm's calendar date)", () => {
  it("tomorrow and two weeks", () => {
    expect(snoozeDate("tomorrow", "2026-11-09")).toBe("2026-11-10");
    expect(snoozeDate("two-weeks", "2026-11-09")).toBe("2026-11-23");
    expect(snoozeDate("tomorrow", "2026-12-31")).toBe("2027-01-01");
  });
  it("next Monday from a Monday is a week on; from any other day it is the coming Monday", () => {
    expect(snoozeDate("monday", "2026-11-09")).toBe("2026-11-16"); // Monday
    expect(snoozeDate("monday", "2026-11-10")).toBe("2026-11-16"); // Tuesday
    expect(snoozeDate("monday", "2026-11-14")).toBe("2026-11-16"); // Saturday
    expect(snoozeDate("monday", "2026-11-15")).toBe("2026-11-16"); // Sunday
    expect(snoozeDate("monday", "2026-12-28")).toBe("2027-01-04"); // across the year
  });
});

describe("buildDeck", () => {
  const rows = [
    row({ key: "q", client: "Quiet", nextStep: step("2026-12-20", "u-reb"), lastContact: { date: "2026-09-01", type: "email_sent" } }),
    row({ key: "n", client: "Needs", nextStep: null, assignedTo: "u-reb" }),
    row({ key: "w", client: "Week", nextStep: step("2026-11-04", "u-reb") }),
    row({ key: "o", client: "Over", nextStep: step("2026-10-20", "u-reb") }),
    row({ key: "x", client: "Rayn's", nextStep: step("2026-10-20", "u-rayn") }),
    row({ key: "a", client: "Approval", nextStep: step("2026-12-30", "u-rayn"), waiting: "approval" }),
    row({ key: "a2", client: "Approval and mine", nextStep: step("2026-10-20", "u-att"), waiting: "approval" }),
  ];
  const buckets = reviewBuckets(rows, TODAY);
  const keys = (id: string) => buildDeck(buckets, members, id).map((c) => c.row.key);

  it("is the person's lane in column order: overdue, this week, needs, quiet", () => {
    expect(keys("u-reb")).toEqual(["o", "w", "n", "q", "a2", "a"]); // own lane first, then the approval rows in section order
  });
  it("adds waiting-on-approval rows for an approver, once each", () => {
    expect(keys("u-att")).toEqual(["a2", "a"]);
    expect(keys("u-reb").filter((k) => k === "a2")).toHaveLength(1);
  });
  it("does not add them for a non-approver", () => {
    expect(keys("u-rayn")).toEqual(["x"]);
  });
  it("unknown or no person gives an empty deck", () => {
    expect(buildDeck(buckets, members, null)).toEqual([]);
    expect(keys("nobody")).toEqual([]);
  });
});

describe("deck people", () => {
  it("lists owners first, then by name, and keeps a lane person who left as Teammate", () => {
    expect(deckPeople(members, ["gone", null]).map((p) => p.name)).toEqual(["Rebecca Pasha", "Anna", "Rayn", "Teammate"]);
  });
  it("defaults to the member named Rebecca, else the signed-in user, else the first", () => {
    const people = deckPeople(members);
    expect(defaultPerson(people, "u-rayn")).toBe("u-reb");
    const noReb = deckPeople(members.filter((m) => m.userId !== "u-reb"));
    expect(defaultPerson(noReb, "u-rayn")).toBe("u-rayn");
    expect(defaultPerson(noReb, "stranger")).toBe(noReb[0].userId);
    expect(defaultPerson([], "u-rayn")).toBeNull();
  });
  it("a requested person must be a chip", () => {
    const people = deckPeople(members);
    expect(chosenPerson(people, "u-rayn", null)).toBe("u-rayn");
    expect(chosenPerson(people, "stranger", null)).toBe("u-reb");
  });
});

describe("small pure helpers", () => {
  it("initials", () => {
    expect(initials("Rebecca Pasha")).toBe("RP");
    expect(initials("Rayn")).toBe("R");
    expect(initials("  ")).toBe("?");
  });
  it("tags: fixed order, at most two shown then +N", () => {
    const r = row({ waiting: "approval", deadline: { dueDate: "2026-11-10", title: null }, proposalExpiry: { text: "Proposal expires Nov 4", expiresOn: "2026-11-04", expired: false } });
    const tags = rowTags(r, TODAY);
    expect(tags[0].text).toMatch(/^Waiting on /);
    expect(tags[1].text).toBe("USPTO deadline Nov 10");
    expect(tags[2].text).toBe("Proposal expires Nov 4");
    expect(tags).toHaveLength(3);
    const lim = limitTags(tags, 2);
    expect(lim.shown).toHaveLength(2);
    expect(lim.more).toBe(1);
  });
  it("lead stage choices never include a won stage", () => {
    const out = leadStageChoices([
      { id: "1", name: "Proposal", category: "open" },
      { id: "2", name: "Signed", category: "won" },
      { id: "3", name: "Nurture", category: "nurture" },
      { id: "4", name: "Lost", category: "lost" },
      { id: "5", name: null, category: "open" },
    ]);
    expect(out.map((o) => o.id)).toEqual(["1", "3", "4"]);
  });
  it("notes are clipped to 200 characters; only notes carry their text", () => {
    expect(clipNote("x".repeat(500))).toHaveLength(200);
    expect(clipNote("  short ")).toBe("short");
    const lines = activityLines(
      [
        { id: "1", type: "note", actor_type: "user", created_at: "2026-10-30T15:00:00Z", payload: { note: "n".repeat(300) } },
        { id: "2", type: "email_sent", actor_type: "user", created_at: "2026-10-29T15:00:00Z", payload: { subject: "Secret subject" } },
      ],
      "America/New_York",
      TODAY,
    );
    expect(lines[0].note).toHaveLength(200);
    expect(lines[0].when).toBe("Oct 30");
    expect(lines[1].note).toBeNull();
  });
  it("notices are fixed sentences chosen by a closed code", () => {
    expect(noticeFor("denied")).toMatch(/permission/);
    expect(noticeFor("<b>x</b>")).toBeNull();
    expect(noticeFor(undefined)).toBeNull();
  });
});
