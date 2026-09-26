import { describe, it, expect } from "vitest";
import { renderDocumentDocx, buildDocumentFileName } from "@/lib/documents/docx";
import type { DocumentDraftRow } from "@/lib/documents/types";

function draft(overrides: Partial<Pick<DocumentDraftRow, "doc_type" | "payload">> = {}) {
  return {
    doc_type: "opinion_letter" as const,
    payload: { clientName: "Acme Co.", markText: "MARKNAME" },
    ...overrides,
  };
}

describe("renderDocumentDocx", () => {
  it("renders a real .docx (valid zip) from markdown-ish text", async () => {
    const content = "# Acme Co. — Opinion Letter DRAFT — MARKNAME\n\n## Federal Register Search\n\nSome body text.\n\n- MARK (U.S. Reg. No. 123) Registered in connection with widgets Class 009\n\n**Bold term** and plain text.";
    const result = await renderDocumentDocx(draft(), content);

    expect(result.buffer.byteLength).toBeGreaterThan(0);
    // .docx is a zip container — PK is the zip local-file-header signature.
    expect(result.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(result.fileName).toBe("Acme Co. - Opinion Letter DRAFT - MARKNAME.docx");
  });

  it("still produces a document for content with no markdown structure", async () => {
    const result = await renderDocumentDocx(draft(), "Just a single plain sentence.");
    expect(result.buffer.subarray(0, 2).toString()).toBe("PK");
  });
});

describe("buildDocumentFileName", () => {
  it("names an opinion letter DRAFT per the firm's convention", () => {
    expect(
      buildDocumentFileName("opinion_letter", { clientName: "Jane Doe", markText: "SUNBEAM" }),
    ).toBe("Jane Doe - Opinion Letter DRAFT - SUNBEAM.docx");
  });

  it("prefers entityName over clientName when both are present", () => {
    expect(
      buildDocumentFileName("opinion_letter", {
        clientName: "Jane Doe",
        entityName: "Doe Studio LLC",
        markText: "SUNBEAM",
      }),
    ).toBe("Doe Studio LLC - Opinion Letter DRAFT - SUNBEAM.docx");
  });

  it("names a trademark clearance opinion by its doc-type label (no dedicated per-mark filename, unlike opinion_letter)", () => {
    expect(
      buildDocumentFileName("trademark_clearance", { clientName: "Jane Doe", markText: "SUNBEAM" }),
    ).toBe("Jane Doe - Preliminary trademark clearance.docx");
  });

  it("names an LOE by its doc-type label", () => {
    expect(buildDocumentFileName("loe_trademark_current", { clientName: "Jane Doe" })).toBe(
      "Jane Doe - Trademark LOE (current).docx",
    );
    expect(buildDocumentFileName("loe_general", { clientName: "Jane Doe" })).toBe(
      "Jane Doe - General LOE.docx",
    );
  });

  it("falls back to a generic client label when nothing is on the payload", () => {
    expect(buildDocumentFileName("loe_general", {})).toBe("Client - General LOE.docx");
  });
});
