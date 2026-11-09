import { describe, expect, it } from "vitest";
import { proposalsOut, reviewPerson, waitingOnPerson } from "@/lib/review/strips";
import { isTrademarkRow, sheetSections, SHEET_COLUMNS, waitingCell } from "@/lib/review/sheet";
import { row, TODAY } from "./fixtures";

const tag = (expiresOn: string, expired: boolean) => ({ text: "x", expiresOn, expired });

describe("proposalsOut", () => {
  it("lists live proposals soonest last day first, expired ones worded as expired", () => {
    const out = proposalsOut(
      [
        row({ key: "a", client: "Late", proposalExpiry: tag("2026-11-11", false) }),
        row({ key: "b", client: "Gone", proposalExpiry: tag("2026-11-05", false) }),
        row({ key: "c", client: "None" }),
        row({ key: "d", client: "Today", proposalExpiry: tag(TODAY, false) }),
        row({ key: "e", client: "Old", proposalExpiry: tag("2026-10-28", true) }),
      ],
      TODAY,
    );
    expect(out.map((p) => [p.row.client, p.text, p.expired])).toEqual([
      ["Old", "Expired Oct 28", true],
      ["Today", "Last day today", false],
      ["Gone", "Last day Nov 5", false],
      ["Late", "Last day Nov 11", false],
    ]);
  });
});

describe("Waiting on the review person", () => {
  const members = [
    { userId: "u-reb", name: "Rebecca Pinto", role: "owner" },
    { userId: "u-x", name: "Xavier", role: "paralegal" },
  ];
  it("is the member whose name starts with Rebecca; no such member, no strip", () => {
    expect(reviewPerson(members)).toMatchObject({ userId: "u-reb", firstName: "Rebecca" });
    expect(reviewPerson([members[1]])).toBeNull();
  });
  it("her next steps plus every approval, once each", () => {
    const step = (a: string | null) => ({ id: "t", title: "Call", dueDate: null, assigneeId: a });
    const rows = [
      row({ key: "1", client: "Mine", nextStep: step("u-reb") }),
      row({ key: "2", client: "Approve", waiting: "approval", nextStep: step("u-x") }),
      row({ key: "3", client: "Both", waiting: "approval", nextStep: step("u-reb") }),
      row({ key: "4", client: "Other", nextStep: step("u-x") }),
    ];
    expect(waitingOnPerson(rows, "u-reb").map((r) => r.client)).toEqual(["Approve", "Both", "Mine"]);
  });
});

describe("Sheet", () => {
  it("columns, in order", () => {
    expect([...SHEET_COLUMNS]).toEqual(["Client", "Mark", "Status", "Next step", "Whose court", "Waiting on", "Source", "Last contact"]);
  });
  it("Trademarks = leads + TM/CR/PATENT (no type reads TM); Contracts = the rest; stage order then client", () => {
    const s = sheetSections([
      row({ key: "a", client: "Zed", stageOrder: 100_020 }),
      row({ key: "b", client: "Amy", stageOrder: 100_020, matterType: "CR" }),
      row({ key: "c", client: "Lead", kind: "lead", stageOrder: 2 }),
      row({ key: "d", client: "Contract", matterType: "BL", stageOrder: 100_001 }),
      row({ key: "e", client: "Nostage", stageOrder: null }),
      row({ key: "f", client: "Lit", matterType: "LIT", stageOrder: 100_000 }),
    ]);
    expect(s.trademarks.map((r) => r.client)).toEqual(["Lead", "Amy", "Zed", "Nostage"]);
    expect(s.contracts.map((r) => r.client)).toEqual(["Lit", "Contract"]);
    expect(isTrademarkRow({ kind: "matter", matterType: null })).toBe(true);
  });
  it("waiting cell", () => {
    const fmt = (d: string) => d;
    expect(waitingCell({ waiting: "client", contactKnown: true, lastOutbound: "Nov 4" }, fmt)).toBe("Client · followed up Nov 4");
    expect(waitingCell({ waiting: "client", contactKnown: true, lastOutbound: null }, fmt)).toBe("Client · no follow-up recorded");
    expect(waitingCell({ waiting: "us", contactKnown: true }, fmt)).toBe("Us");
    expect(waitingCell({ waiting: "uspto", contactKnown: true }, fmt)).toBe("USPTO");
    expect(waitingCell({ waiting: "approval", contactKnown: true }, fmt)).toBe("Approval");
    expect(waitingCell({ waiting: null, contactKnown: true }, fmt)).toBe("—");
  });
});
