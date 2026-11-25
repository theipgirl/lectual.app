import { describe, expect, it } from "vitest";
import { attachmentsForEmail, capPdfMarks, missingLine, MAX_ATTACHMENT_BYTES, NO_ATTACHMENTS_LINE, stripClassNumbers, type PrepFile } from "@/lib/consult-prep/attachments";
import { TRADEMARK_FACTS } from "./judge/fixtures";

const xlsx: PrepFile = { kind: "uspto_xlsx", fileName: "tmSearchResults2026-11-24.xlsx", bytes: Buffer.from("x") };
const pdf: PrepFile = { kind: "packages_pdf", fileName: "Kenasha_Paul_Packages_LegacyCon.pdf", bytes: Buffer.from("p") };

describe("the attachments of one email", () => {
  it("attaches what was built and names it", () => {
    const out = attachmentsForEmail({ uspto_xlsx: "built", packages_pdf: "built" }, [xlsx, pdf]);
    expect(out.attach).toEqual([xlsx, pdf]);
    expect(out.lines).toEqual([`Attached: ${xlsx.fileName}`, `Attached: ${pdf.fileName}`]);
  });
  it("names each missing file in a fixed sentence (never a name), for every reason", () => {
    const out = attachmentsForEmail({ uspto_xlsx: "unavailable", packages_pdf: "no_marks" }, []);
    expect(out.attach).toEqual([]);
    expect(out.lines).toEqual(["USPTO search results workbook not attached: the USPTO search was unavailable.", "Packages PDF not attached: no mark is confirmed yet."]);
    expect(attachmentsForEmail({ uspto_xlsx: "built" }, [], { loadFailed: true }).lines).toEqual(["USPTO search results workbook not attached: the saved copy couldn't be read for this email."]);
    expect(attachmentsForEmail({ uspto_xlsx: "built", packages_pdf: "built" }, [xlsx, pdf], { refused: true }).attach).toEqual([]);
    expect(missingLine("uspto_xlsx", "weird")).toBe("USPTO search results workbook not attached: it could not be built.");
  });
  it("a file over the safe size is not attached and is said to be too large", () => {
    const big: PrepFile = { ...pdf, bytes: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1) };
    const out = attachmentsForEmail({ uspto_xlsx: "built", packages_pdf: "built" }, [xlsx, big]);
    expect(out.attach).toEqual([xlsx]);
    expect(out.lines[1]).toMatch(/too large to send by email/);
  });
  it("a general matter has no files", () => {
    expect(attachmentsForEmail({ uspto_xlsx: "none", packages_pdf: "none" }, [])).toEqual({ attach: [], lines: [NO_ATTACHMENTS_LINE] });
  });
});

describe("the client PDF's marks", () => {
  it("drops an ungrounded mark and every class number", () => {
    const marks = capPdfMarks(
      [
        { mark: "LegacyCon", categories: [{ text: "Conferences (Class 41) and IC 035 events", classNumber: 41, priority: true }] },
        { mark: "Invented Mark", categories: [{ text: "Anything", classNumber: 9, priority: false }] },
      ],
      TRADEMARK_FACTS,
      (s) => s,
    );
    expect(marks).toEqual([{ name: "LegacyCon", categories: [{ text: "Conferences and events", priority: true }] }]);
    expect(stripClassNumbers("Classes 9 and 16 software")).toBe("software");
  });
});
