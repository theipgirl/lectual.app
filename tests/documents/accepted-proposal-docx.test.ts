import { describe, it, expect } from "vitest";
import { acceptedProposalFileName, acceptedProposalLines, renderAcceptedProposalDocx, DOCX_MIME } from "@/lib/documents/accepted-proposal-docx";
import { acceptedSnapshot } from "../proposals/accepted-fixture";

const FACTS = { clientName: "Sevetri Wilson", entityName: "Prosperall", timeZone: "America/New_York" };
const fmt = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;

describe("acceptedProposalLines: exactly what was accepted", () => {
  const snap = acceptedSnapshot({ classes: 2, marks: ["word", "logo"], adjustments: [{ id: "a", label: "Event discount", kind: "amount", value: 25_000 }] });
  const lines = acceptedProposalLines(snap, FACTS);
  const text = lines.map((l) => l.text).join("\n");

  it("has the client, the accepted date in the firm's zone, the package and its chart rows", () => {
    expect(text).toContain("Client: Sevetri Wilson (Prosperall)");
    // 2026-10-21T15:00Z is October 21 in New York.
    expect(text).toContain("Accepted: October 21, 2026");
    expect(text).toContain("Package: Concierge");
    expect(text).toContain("Classes Included | 3 Classes");
    expect(text).toContain("Substantive Office Action Legal Strategy Review ($675) | ✓");
  });

  it("names the brand, its marks and the classes that were picked", () => {
    expect(text).toContain("Prosperall");
    expect(text).toContain("Marks: Word mark, Logo");
    expect(text).toContain("Cloud-Based Software as a Service (SaaS); Consulting & Professional Services");
    expect(text).not.toContain("Software Development"); // the third class was not picked
  });

  it("shows the legal fee and the USPTO fees as two separately labelled figures, with the adjustment math", () => {
    expect(text).toContain(`Legal fee, due when accepted: ${fmt(snap.quote.legal_total_cents)}`);
    expect(text).toContain(`USPTO fees, due at filing: ${fmt(snap.quote.gov_total_cents)}`);
    expect(text).toMatch(/Legal fee math: \$[\d,]+ − \$250 = \$[\d,]+/);
    expect(text).toContain("not added together");
  });

  it("never prints the sum of the two totals", () => {
    const sum = snap.quote.legal_total_cents + snap.quote.gov_total_cents;
    for (const s of [fmt(sum), String(sum), `$${(sum / 100).toFixed(2)}`]) expect(text).not.toContain(s);
  });

  it("contains no brand or package the client did not choose", () => {
    expect(text).not.toContain("Tech4PublicGood");
    const two = acceptedProposalLines(acceptedSnapshot({ brands: ["p", "t"] }), FACTS).map((l) => l.text).join("\n");
    expect(two).toContain("Tech4PublicGood");
    // A brand with nothing picked is not in what was accepted.
    const none = acceptedSnapshot({ brands: ["p", "t"] });
    none.quote.names.find((n) => n.id === "t")!.included = false;
    expect(acceptedProposalLines(none, FACTS).map((l) => l.text).join("\n")).not.toContain("Tech4PublicGood");
  });

  it("states that it records the acceptance and gives no advice", () => {
    expect(text).toContain("a record of what the client accepted");
    expect(text).not.toMatch(/\b(should|recommend|advise)\b/i);
  });

  it("omits the math line when nothing was taken off, and the entity when there is none", () => {
    const plain = acceptedProposalLines(acceptedSnapshot(), { ...FACTS, entityName: null }).map((l) => l.text).join("\n");
    expect(plain).not.toContain("Legal fee math");
    expect(plain).toContain("Client: Sevetri Wilson\n");
  });
});

describe("renderAcceptedProposalDocx", () => {
  it("returns a non-empty zip (PK) and a file name carrying the client", async () => {
    const { buffer, fileName } = await renderAcceptedProposalDocx(acceptedSnapshot(), FACTS);
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(fileName).toBe("Sevetri Wilson - Accepted Proposal.docx");
    expect(DOCX_MIME).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("strips characters a file name cannot hold", () => {
    expect(acceptedProposalFileName('A/B: "C"?*')).toBe("AB C - Accepted Proposal.docx");
    expect(acceptedProposalFileName("   ")).toBe("Client - Accepted Proposal.docx");
  });
});
