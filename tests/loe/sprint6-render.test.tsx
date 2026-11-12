import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/app/dashboard/proposals/[id]/signed-letter-actions", () => ({ downloadSignedLetterStaffAction: vi.fn() }));
vi.mock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn(), retryUploadAction: vi.fn() }));

import { EngagementLetterCard } from "@/components/proposal-editor/EngagementLetterCard";
import { EngagementLetterSlot } from "@/components/proposal-editor/EngagementLetterSlot";
import { UnsavedGuardProvider } from "@/components/proposal-editor/UnsavedGuard";
import { editorLetterState } from "@/lib/loe/editor-state";
import { buildSignedCard } from "@/lib/loe/signed-card";
import { DRAFT_FORM_ID } from "@/lib/proposal-editor/unsaved";
import type { SignatureRead } from "@/lib/loe/signature-read";
import { fullLetterBody } from "./full-letter-fixture";
import { FINGERPRINT, signedTrademark } from "./signed-fixtures";
import { withLoe } from "./loe-fixtures";
import { sevetri } from "../proposals/fixture";

/**
 * Static renders of the Engagement letter section (four states) and the staff card (done, failed, skipped, unreadable), with the repo
 * CSS inlined. When LOE_RENDER_DIR is set the HTML is written there for the Playwright screenshots in the sprint handoff; the assertions
 * run either way. No data layer, no browser session: what is drawn is what the components draw for these inputs.
 */

const APPROVED = { id: "11111111-1111-4111-8111-111111111111", kind: "trademark" as const, version: 3, title: "Engagement letter", body: fullLetterBody() };
const ATTACHED = withLoe(sevetri()).loe;
const OK: SignatureRead = {
  status: "ok",
  signature: { id: "s1", signerName: "Sevetri Wilson", signedAt: "2026-11-12T19:14:00.000Z", fingerprint: FINGERPRINT, entityName: "Prosperall Inc.", signerTitle: "Founder", templateVersion: 3 },
};

function section(read: Parameters<typeof editorLetterState>[0]["read"], attached: typeof ATTACHED): ReactElement {
  const state = editorLetterState({ read, attached });
  return createElement(
    "form",
    { id: DRAFT_FORM_ID },
    createElement(UnsavedGuardProvider, { initial: { dirty: true } }, createElement(EngagementLetterSlot, { state, editable: true })),
  );
}

function card(signature: SignatureRead, steps: Array<Record<string, unknown>>, canRetry = true): ReactElement {
  const snapshot = signedTrademark();
  const view = buildSignedCard({
    proposalId: "44444444-4444-4444-8444-444444444444",
    status: "accepted",
    snapshot,
    signature,
    events: steps.map((payload, i) => ({ proposal_id: "44444444-4444-4444-8444-444444444444", type: "edited", created_at: `2026-11-12T19:1${i}:00.000Z`, payload })),
    tz: "America/New_York",
    canRetry,
    canDownload: true,
  });
  if (!view) throw new Error("no card");
  return createElement(EngagementLetterCard, { proposalId: "44444444-4444-4444-8444-444444444444", view });
}

const SCREENS: Array<[string, () => ReactElement]> = [
  ["section-none", () => section({ status: "ok", letter: null }, undefined)],
  ["section-on", () => section({ status: "ok", letter: APPROVED }, ATTACHED)],
  ["section-off", () => section({ status: "ok", letter: APPROVED }, undefined)],
  ["section-unreadable", () => section({ status: "unavailable" }, undefined)],
  ["card-done", () => card(OK, [{ step: "signed_loe_upload", outcome: "uploaded" }])],
  ["card-failed", () => card(OK, [{ step: "signed_loe_upload", outcome: "failed", reason: "HTTP 422" }])],
  ["card-skipped", () => card(OK, [{ step: "signed_loe_upload", outcome: "skipped", reason: "Lawmatics isn't connected, so the signed letter wasn't filed there." }])],
  ["card-unreadable", () => card({ status: "unavailable" }, [])],
];

function css(): string {
  return ["src/app/globals.css", "src/app/dashboard/proposals/proposals.css"].map((f) => readFileSync(f, "utf8")).join("\n");
}

describe("the Sprint 6 screens render", () => {
  const dir = process.env.LOE_RENDER_DIR;
  for (const [name, make] of SCREENS) {
    it(name, () => {
      const html = renderToStaticMarkup(make());
      expect(html.length).toBeGreaterThan(200);
      expect(html).not.toMatch(/TODO|Coming soon|Lorem/i);
      if (dir) {
        mkdirSync(dir, { recursive: true });
        const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css()}</style></head><body><div class="lx-page"><div class="pe-page"><div class="pe-cols"><div class="pe-forms">${html}</div></div></div></div></body></html>`;
        writeFileSync(join(dir, `${name}.html`), page);
      }
    });
  }

  it("the card draws nothing for a version with no letter (no empty box)", () => {
    const plain = buildSignedCard({ proposalId: "p", status: "accepted", snapshot: { ...signedTrademark(), content: { ...signedTrademark().content, loe: undefined } }, signature: OK, events: [], tz: "UTC", canRetry: true, canDownload: true });
    expect(plain).toBeNull();
    expect(buildSignedCard({ proposalId: "p", status: "sent", snapshot: signedTrademark(), signature: OK, events: [], tz: "UTC", canRetry: true, canDownload: true })).toBeNull();
  });
});
