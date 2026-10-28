import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { consultStripState, type ConsultStripState } from "@/lib/proposals/consult-strip";
import { ConsultStrip } from "@/components/proposal-editor/ConsultStrip";
import type { ConsultEntry, ConsultRead } from "@/lib/consult/store";
import type { StoredConsultDetails } from "@/lib/consult/vocab";

const details = (over: Partial<StoredConsultDetails> = {}): StoredConsultDetails => ({
  version: 1,
  rev: 1,
  marks: [
    {
      id: "m1",
      mark: "Zephyr",
      mark_type: "word",
      classes: [{ class: 25, goods: "Clothing, namely t-shirts" }],
      filing_basis: "1b",
      extracted_basis: "1b",
      basis_evidence: "we have not launched yet",
      first_use_date: null,
    },
  ],
  recommended_package: "Concierge",
  discount_discussed: null,
  extracted: { at: "2026-10-18T10:00:00Z", source: "post-consult-agent", meeting_id: null },
  review: null,
  ...over,
});

const REVIEWED = details({
  review: { reviewed_at: "2026-10-19T15:00:00Z", reviewed_by: "u1", reviewed_by_name: "Rebecca Beliard", reviewed_by_role: "senior_admin" },
});

const entry = (noteId: string, read: ConsultEntry["read"], createdAt = "2026-10-18T10:00:00Z"): ConsultEntry => ({ noteId, createdAt, source: "zoom", read });
const ok = (...entries: ConsultEntry[]): ConsultRead => ({ status: "ok", entries });

const html = (state: ConsultStripState) => renderToStaticMarkup(createElement(ConsultStrip, { state, leadId: "lead-1", tz: "America/New_York" }));

describe("consultStripState (the loader's rule)", () => {
  it("derives from the NEWEST entry that has details, passing over notes with none", () => {
    const state = consultStripState(ok(entry("n3", { kind: "none" }), entry("n2", { kind: "ok", details: REVIEWED }), entry("n1", { kind: "ok", details: details() })));
    expect(state).toMatchObject({ status: "details", noteId: "n2", reviewed: true, source: "zoom" });
  });

  it("a newer unreviewed record is shown as unreviewed, never the older reviewed one", () => {
    const state = consultStripState(ok(entry("new", { kind: "ok", details: details() }), entry("old", { kind: "ok", details: REVIEWED })));
    expect(state).toMatchObject({ status: "details", noteId: "new", reviewed: false });
  });

  it("a newest unreadable record is 'unavailable', not skipped", () => {
    expect(consultStripState(ok(entry("bad", { kind: "invalid" }), entry("old", { kind: "ok", details: REVIEWED })))).toEqual({ status: "unavailable", unreadable: true });
  });

  it("no notes, or notes without details, is none; a failed read is unavailable", () => {
    expect(consultStripState(ok())).toEqual({ status: "none" });
    expect(consultStripState(ok(entry("n", { kind: "none" })))).toEqual({ status: "none" });
    expect(consultStripState({ status: "unavailable" })).toEqual({ status: "unavailable", unreadable: false });
  });
});

describe("<ConsultStrip>", () => {
  const outputs = {
    details: html(consultStripState(ok(entry("n", { kind: "ok", details: REVIEWED })))),
    none: html({ status: "none" }),
    unavailable: html({ status: "unavailable", unreadable: false }),
  };

  it("the three states are three distinct outputs", () => {
    expect(new Set(Object.values(outputs)).size).toBe(3);
    expect(outputs.none).toContain("No consult recorded");
    expect(outputs.unavailable).toContain("couldn&#x27;t be loaded");
    expect(outputs.details).not.toContain("No consult recorded");
    expect(outputs.details).not.toContain("couldn&#x27;t be loaded");
  });

  it("a failed read is never 'No consult recorded'", () => {
    expect(outputs.unavailable).not.toContain("No consult recorded");
    expect(html({ status: "unavailable", unreadable: true })).not.toContain("No consult recorded");
    expect(html({ status: "unavailable", unreadable: true })).toContain("couldn&#x27;t be read");
  });

  it("reviewed details show marks, classes with goods, basis, who reviewed and when, and a lead link", () => {
    const h = outputs.details;
    expect(h).toContain("Zephyr");
    expect(h).toContain("Word mark");
    expect(h).toContain("25: Clothing, namely t-shirts");
    expect(h).toContain("Intent to use");
    expect(h).toContain("Reviewed by Rebecca Beliard (Senior admin)");
    expect(h).toContain("Oct 19");
    expect(h).toContain("Oct 18");
    expect(h).toContain("Zoom");
    expect(h).toContain("Package discussed: Concierge");
    expect(h).toMatch(/href="\/dashboard\/leads\/lead-1\/?"/);
    expect(h).not.toContain("not yet reviewed");
  });

  it("unreviewed details say 'not yet reviewed' and are not presented as fact", () => {
    const h = html(consultStripState(ok(entry("n", { kind: "ok", details: details() }))));
    expect(h).toContain("not yet reviewed");
    expect(h).toContain("not as fact");
    expect(h).not.toContain("Reviewed by");
  });

  it("a filing basis of unknown shows as unknown", () => {
    const d = details();
    d.marks[0] = { ...d.marks[0], filing_basis: "unknown", extracted_basis: "unknown", basis_evidence: null };
    const h = html(consultStripState(ok(entry("n", { kind: "ok", details: d }))));
    expect(h).toContain("Filing basis unknown");
    expect(h).not.toContain("Intent to use");
  });

  it("none and unavailable both link to the lead", () => {
    expect(outputs.none).toMatch(/href="\/dashboard\/leads\/lead-1\/?"/);
    expect(outputs.unavailable).toMatch(/href="\/dashboard\/leads\/lead-1\/?"/);
  });
});
