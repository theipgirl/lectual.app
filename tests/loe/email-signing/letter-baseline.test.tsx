import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { TEST_DETAILS } from "../full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "../loe-fixtures";

/**
 * T1 (Sprint A, emailed signing link): with the emailed path OFF (`letter.emailSigning` absent or false), the LETTER page renders
 * byte for byte as it did before the sprint. The files in `__baseline__/` were rendered from commit 62868c1, before any component
 * was edited. Set WRITE_BASELINE=1 only to (re)create them from a known-good tree.
 */
const DIR = join(__dirname, "__baseline__");
const LETTER = { dateText: "November 12, 2026", clientEmail: "client@example.com" };

const CASES: Array<[string, Partial<ProposalDocumentProps>]> = [
  ["tm-step1", {}],
  ["tm-step2", { initialLoe: { step: 2, details: TEST_DETAILS } }],
  ["tm-step3", { initialLoe: { step: 3, details: TEST_DETAILS } }],
  ["tm-step3-ready", { initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Alex Sample", agree: true } }],
  ["general-step3", { content: generalWithLoe(), initialLoe: { step: 3, details: TEST_DETAILS } }],
];

function render(over: Partial<ProposalDocumentProps>, emailSigning: boolean | undefined): string {
  const letter = emailSigning === undefined ? LETTER : { ...LETTER, emailSigning };
  return renderToStaticMarkup(
    <ProposalDocument
      content={withLoe(twoBrandPerMark())}
      title="Trademark Proposal"
      clientName="Alex Sample"
      expiresOn="2026-12-01"
      firm={{ name: "Sample Firm", slug: "sample-firm" }}
      mode="live"
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      letter={letter as ProposalDocumentProps["letter"]}
      {...over}
    />,
  );
}

describe("T1: the letter page with the emailed path off is byte-identical to the pre-sprint render", () => {
  for (const [name, over] of CASES) {
    for (const flag of [undefined, false] as const) {
      it(`${name} (emailSigning ${String(flag)})`, () => {
        const html = render(over, flag);
        const file = join(DIR, `${name}.html`);
        if (process.env.WRITE_BASELINE === "1" && flag === undefined) {
          mkdirSync(DIR, { recursive: true });
          writeFileSync(file, html);
        }
        expect(existsSync(file)).toBe(true);
        expect(html).toBe(readFileSync(file, "utf8"));
      });
    }
  }
});
