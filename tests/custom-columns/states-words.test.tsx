import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirmColumns } from "@/components/review/ReviewCardExtras";
import { SectionNote } from "@/components/review/SectionNote";
import { detailsNote } from "@/lib/review/notes";
import * as W from "@/lib/ui/words";

const decode = (s: string) => s.replace(/&#x27;/g, "'");
const text = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const BANNED = /module|migration|database update|schema/i;

describe("P5: 'not switched on' and 'couldn't load' are different, and each says its own words", () => {
  it("the words are the glossary's", () => {
    expect(W.CUSTOM_COLUMNS_NOT_ON).toBe("Custom columns aren't switched on for your firm yet.");
    expect(W.CUSTOM_FROM_LEAD).toBe("From the lead");
    expect(W.CUSTOM_FROM_MERGED).toBe("From a merged duplicate");
    expect(W.CUSTOM_NO_LONGER_ON_TEAM).toBe("Someone no longer on the team");
    expect(W.FIRM_COLUMNS_HEADING).toBe("Firm columns");
    expect([W.CUSTOM_KIND_TEXT, W.CUSTOM_KIND_DATE, W.CUSTOM_KIND_MONEY, W.CUSTOM_KIND_CHOICE, W.CUSTOM_KIND_PERSON]).toEqual(["Text", "Date", "Money", "Choice", "Person"]);
  });

  it("on the List: the section note adds the not-switched-on sentence; a failed read is the details note", () => {
    const off = text(renderToStaticMarkup(<SectionNote section="trademarks" customNotOn />));
    const on = text(renderToStaticMarkup(<SectionNote section="trademarks" />));
    expect(off.endsWith(W.CUSTOM_COLUMNS_NOT_ON)).toBe(true);
    expect(on).not.toContain(W.CUSTOM_COLUMNS_NOT_ON);
    const failed = detailsNote(["custom columns"]);
    expect(failed).toBe("Some details couldn't load (custom columns). Refresh to try again.");
    expect(failed).not.toBe(W.CUSTOM_COLUMNS_NOT_ON);
    for (const s of [off, failed!]) expect(s).not.toMatch(BANNED);
  });

  it("on the card: two different lines, each exactly its constant", () => {
    const off = text(renderToStaticMarkup(<FirmColumns block={{ status: "not-set-up" }} />));
    const down = text(renderToStaticMarkup(<FirmColumns block={{ status: "unavailable" }} />));
    expect(off).toBe(`${W.FIRM_COLUMNS_HEADING} ${W.CUSTOM_COLUMNS_NOT_ON}`);
    expect(down).toBe(`${W.FIRM_COLUMNS_HEADING} ${W.DECK_COULDNT_LOAD}`);
    expect(off).not.toBe(down);
    for (const s of [off, down]) expect(s).not.toMatch(BANNED);
  });
});
