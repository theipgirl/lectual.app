import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/dashboard/proposals/[id]/signed-letter-actions", () => ({ downloadSignedLetterStaffAction: vi.fn() }));
vi.mock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn(), retryUploadAction: vi.fn() }));

import { EngagementLetterCard } from "@/components/proposal-editor/EngagementLetterCard";
import { addressView, buildSignedCard } from "@/lib/loe/signed-card";
import type { SignatureRead } from "@/lib/loe/signature-read";
import { FINGERPRINT, signedTrademark } from "./signed-fixtures";

const ID = "44444444-4444-4444-8444-444444444444";
const OK: SignatureRead = { status: "ok", signature: { id: "s1", signerName: "Sevetri Wilson", signedAt: "2026-11-12T19:14:00.000Z", fingerprint: FINGERPRINT, entityName: null, signerTitle: null, templateVersion: 3 } };
const ev = (payload: Record<string, unknown>, i = 0) => ({ proposal_id: ID, type: "edited", created_at: `2026-11-12T19:1${i}:00.000Z`, payload });

function html(steps: Array<Record<string, unknown>>, canRetry = true) {
  const view = buildSignedCard({ proposalId: ID, status: "accepted", snapshot: signedTrademark(), signature: OK, events: steps.map(ev), tz: "America/New_York", canRetry, canDownload: true });
  if (!view) throw new Error("no card");
  return renderToStaticMarkup(createElement(EngagementLetterCard, { proposalId: ID, view }));
}

describe("the staff card's mailing-address line", () => {
  it("has the same states as filing: not yet, done, failed (with Try again), skipped, and unreadable", () => {
    expect(addressView([], ID, true)).toMatchObject({ state: "not_yet", retry: false });
    expect(addressView([ev({ step: "address_to_lawmatics", outcome: "added" })], ID, true)).toMatchObject({ state: "done", retry: false, text: "Mailing address added to Lawmatics." });
    expect(addressView([ev({ step: "address_to_lawmatics", outcome: "failed", reason: "HTTP 422" })], ID, true)).toMatchObject({ state: "failed", retry: true });
    expect(addressView([ev({ step: "address_to_lawmatics", outcome: "failed", reason: "HTTP 422" })], ID, false)).toMatchObject({ state: "failed", retry: false });
    expect(addressView([ev({ step: "address_to_lawmatics", outcome: "skipped", reason: "x" })], ID, true)).toMatchObject({ state: "skipped", tone: "mute" });
    expect(addressView(null, ID, true)).toMatchObject({ state: "unreadable", retry: false });
  });

  it("is drawn on the card, with its own Try again that runs the address step", () => {
    const failed = html([{ step: "address_to_lawmatics", outcome: "failed", reason: "HTTP 422" }]);
    expect(failed).toContain("Mailing address in Lawmatics");
    expect(failed).toContain('data-address="failed"');
    expect(failed).toContain('name="step" value="address_to_lawmatics"');
    expect(html([{ step: "address_to_lawmatics", outcome: "added" }])).toContain("Added");
    expect(html([])).toContain("Not added yet.");
  });
});
