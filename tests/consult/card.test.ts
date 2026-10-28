import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyReview, normalizeExtraction, withConsultDetails, type ConsultDetailsExtract, type StoredConsultDetails } from "@/lib/consult/details";
import { MemDb, type Row } from "./memdb";

/**
 * The lead page's "Consult details" card, rendered for each state it can be in.
 * What matters on screen: a failed read says so (never "no consult"), an
 * unreviewed record is labelled as such, `unknown` is shown as unknown, the
 * extracted wording is shown beside the field so the reviewer can check it, and
 * a role that cannot write gets no form.
 */

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => h.db }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "signed-out", redirectTo: "/" }) }));
vi.mock("@/lib/matters", () => ({ logActivitySafe: async () => {}, ensureMatterForLead: async () => null }));

const { ConsultDetailsSection } = await import("@/components/leads/ConsultDetailsSection");

const LEAD = "lead-1";
const NOW = new Date("2026-10-09T12:00:00.000Z");
const extraction: ConsultDetailsExtract = {
  marks: [
    { mark: "SANKOFA", mark_type: "word", classes: [{ class: 25, goods: "Clothing, namely t-shirts" }], filing_basis: "1b", basis_evidence: "Nothing has been sold yet.", first_use_date: null },
    { mark: "KENTE", mark_type: "unknown", classes: [], filing_basis: "unknown", basis_evidence: null, first_use_date: null },
  ],
  recommended_package: "Enhanced",
  discount_discussed: "Friends and family",
};
const extracted = () => normalizeExtraction(extraction, { now: NOW, source: "post-consult-agent", sourceText: "SANKOFA in class 25, t-shirts. Nothing has been sold yet." })!;
const reviewedBy = (d: StoredConsultDetails) =>
  applyReview(d, { marks: d.marks.map((m) => ({ id: m.id, mark: m.mark, mark_type: m.mark_type, filing_basis: m.filing_basis, first_use_date: null, classes: m.classes })), recommended_package: d.recommended_package, discount_discussed: d.discount_discussed }, { userId: "u1", name: "Dawn", role: "paralegal" }, NOW);

const note = (notes: Row, id = "n-1"): Row => ({ id, org_id: "org-a", lead_id: LEAD, created_at: "2026-10-08T09:00:00Z", transcript_source: "fathom", notes });

async function render(notes: Row[], canWrite = true, fail = false) {
  const db = new MemDb({ crm_consult_note: notes });
  if (fail) db.failTables.add("crm_consult_note");
  h.db = db;
  return renderToStaticMarkup(await ConsultDetailsSection({ leadId: LEAD, canWrite }));
}

describe("Consult details card", () => {
  it("says so when the read fails — it never draws that as a lead with no consult", async () => {
    const html = await render([note(withConsultDetails({}, extracted()))], true, true);
    expect(html).toContain("Consult details couldn&#x27;t be loaded just now");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Record consult details by hand");
  });

  it("shows an unreviewed extraction as needing review, with the call's words beside the basis", async () => {
    const html = await render([note(withConsultDetails({}, extracted()))]);
    expect(html).toContain("Needs review");
    expect(html).toContain("Confirm and mark reviewed");
    expect(html).toContain("From the call: “Nothing has been sold yet.”");
    expect(html).toContain("Read from the consult notes by the post-consult drafter");
    expect(html).toContain('value="SANKOFA"');
    expect(html).toContain("25: Clothing, namely t-shirts");
    // the model's reading is the starting value, nothing else
    expect(html).toMatch(/<option value="1b" selected="">§1\(b\)/);
    expect(html).toMatch(/<option value="unknown" selected="">Unknown — not stated/);
  });

  it("carries the revision, note and lead ids the action checks, and one blank slot to add a mark", async () => {
    const html = await render([note(withConsultDetails({}, extracted()))]);
    expect(html).toContain('name="rev" value="0"');
    expect(html).toContain('name="noteId" value="n-1"');
    expect(html).toContain('name="leadId" value="lead-1"');
    expect(html).toContain('name="markCount" value="3"');
    expect(html).toContain("Add another mark");
    expect(html).toContain('name="m2_text"');
  });

  it("says the package and discount change no quote", async () => {
    const html = await render([note(withConsultDetails({}, extracted()))]);
    expect(html).toContain("They don’t change any quote");
    expect(html).toContain('value="Friends and family"');
  });

  it("is a record of what was said, not advice: the basis is the attorney's call", async () => {
    const html = await render([note(withConsultDetails({}, extracted()))]);
    expect(html).toContain("Which filing basis applies is the attorney&#x27;s call");
    expect(html).toContain("nothing here recommends one");
    expect(html).toContain("Nothing is sent.");
  });

  it("shows who reviewed it, and then offers Save changes", async () => {
    const html = await render([note(withConsultDetails({}, reviewedBy(extracted())))]);
    expect(html).toContain("Reviewed");
    expect(html).not.toContain("Needs review");
    expect(html).toContain("Reviewed by Dawn (Paralegal)");
    expect(html).toContain("Save changes");
  });

  it("names a correction the reviewer made to what was read", async () => {
    const d = extracted();
    const corrected = applyReview(d, { marks: [{ id: "m1", mark: "SANKOFA", mark_type: "word", filing_basis: "1a", first_use_date: null, classes: [] }], recommended_package: null, discount_discussed: null }, { userId: "u1", name: "Dawn", role: "attorney" }, NOW);
    const html = await render([note(withConsultDetails({}, corrected))]);
    expect(html).toContain("The drafting agent read §1(b)");
    expect(html).toMatch(/<option value="1a" selected="">§1\(a\)/);
  });

  it("gives a role that can't write no form, but still shows unknown as unknown", async () => {
    const html = await render([note(withConsultDetails({}, extracted()))], false);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("SANKOFA");
    expect(html).toContain("§1(b)");
    expect(html).toContain("Unknown — not stated");
    expect(html).toContain("Needs review");
  });

  it("reports details it can't read instead of hiding them", async () => {
    const html = await render([note({ consult_details: { version: 1 } })]);
    expect(html).toContain("couldn&#x27;t be read, so they aren&#x27;t shown or carried anywhere");
    expect(html).not.toContain("<form");
  });

  it("offers to record details on a consult that has none extracted yet", async () => {
    const html = await render([note({ summary: "Wants SANKOFA." })]);
    expect(html).toContain('name="noteId" value="n-1"');
    expect(html).toContain('name="rev" value="none"');
    expect(html).toContain("Add a mark");
  });

  it("with no consult at all: a quiet hand-entry option for staff, nothing for the rest", async () => {
    expect(await render([], true)).toContain("Record consult details by hand");
    expect(await render([], false)).toBe("");
  });

  it("says when older consults aren't shown", async () => {
    const many = [1, 2, 3, 4, 5].map((i) => note(withConsultDetails({}, extracted()), `n-${i}`));
    expect(await render(many, false)).toContain("2 older consults not shown.");
  });
});
