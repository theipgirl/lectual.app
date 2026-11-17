import { describe, expect, it } from "vitest";
import { stripStageCode } from "@/lib/stages/code";

describe("stripStageCode", () => {
  it.each([
    ["19A · OA Issued", "OA Issued"],
    ["19A – OA Issued", "OA Issued"],
    ["19A. OA Issued", "OA Issued"],
    ["19A - OA Issued", "OA Issued"],
    ["18) Awaiting Trademark Registration", "Awaiting Trademark Registration"],
    ["17 Application Filed", "Application Filed"],
    ["Application Filed", "Application Filed"],
    ["  Registered ", "Registered"],
    ["17.", "17."],
  ])("%j -> %j", (a, b) => expect(stripStageCode(a)).toBe(b));
});
