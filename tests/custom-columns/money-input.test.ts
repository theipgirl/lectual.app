import { describe, expect, it } from "vitest";
import { centsToInput, parseMoneyInput } from "@/lib/custom-columns/input";
import { CUSTOM_MONEY_BAD, CUSTOM_MONEY_TOO_BIG } from "@/lib/ui/words";

/** D3 rule 6 / R19: money is parsed on the digit string (BigInt), never through a float. */
describe("parseMoneyInput", () => {
  const ok: Array<[string, number | null]> = [
    ["1250", 125000],
    ["1,250", 125000],
    ["$1,250.5", 125050],
    ["1250.00", 125000],
    [" 1,250 ", 125000],
    ["0", 0],
    ["", null],
    ["   ", null],
    ["1,000,000", 100000000],
    ["$12.34", 1234],
    ["1000000000", 100000000000],
  ];
  for (const [x, cents] of ok) it(`accepts ${JSON.stringify(x)} as ${cents}`, () => expect(parseMoneyInput(x)).toEqual({ ok: true, value: cents }));

  for (const x of ["-5", "1,25", "1,2345", "12.345", "1e3", "abc", ".5", "$", "1.", "1 250", "$-1", "1,250,", ",125"]) {
    it(`refuses ${JSON.stringify(x)}`, () => expect(parseMoneyInput(x)).toEqual({ ok: false, error: CUSTOM_MONEY_BAD }));
  }

  it("over 100,000,000,000 cents is too big, decided on the digits (no float rounds it back into range)", () => {
    expect(parseMoneyInput("1000000000.01")).toEqual({ ok: false, error: CUSTOM_MONEY_TOO_BIG });
    expect(parseMoneyInput("99999999999999999999")).toEqual({ ok: false, error: CUSTOM_MONEY_TOO_BIG });
    expect(parseMoneyInput("9007199254740993")).toEqual({ ok: false, error: CUSTOM_MONEY_TOO_BIG });
  });

  it("the editor's form of whole cents", () => {
    expect(centsToInput(125000)).toBe("1250.00");
    expect(centsToInput(5)).toBe("0.05");
    expect(centsToInput(0)).toBe("0.00");
  });
});
