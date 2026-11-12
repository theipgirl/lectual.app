import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { sevetri } from "../proposals/fixture";
import { danielle } from "../proposals/danielle-fixture";
import { faithe } from "../proposals/general-fixture";
import type { ProposalContent } from "@/lib/proposals/types";

/**
 * Content with no `loe` must render byte for byte as it did before the Letter track's client page (Sprint 4).
 * The files in `__baseline__/` were rendered from commit 29f6329, before any component was edited.
 * Set WRITE_BASELINE=1 only to (re)create them from a known-good tree.
 */
const DIR = join(__dirname, "__baseline__");

const FIXTURES: Array<[string, () => ProposalContent, string]> = [
  ["sevetri", sevetri, "Sevetri Wilson"],
  ["danielle", danielle, "Danielle Milton"],
  ["faithe", faithe, "Faithe Williams"],
];

function render(content: ProposalContent, clientName: string, state: "live" | "accepted"): string {
  const selection = defaultSelection(content);
  const common = {
    content,
    title: "Trademark Proposal",
    clientName,
    expiresOn: "2026-12-01",
    firm: { name: "RPB Law", slug: "rpb-law" },
  };
  if (state === "live") {
    return renderToStaticMarkup(
      <ProposalDocument {...common} mode="live" onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })} />,
    );
  }
  return renderToStaticMarkup(
    <ProposalDocument
      {...common}
      mode="accepted"
      initialSelection={selection}
      acceptedQuote={quoteProposal(content, selection)}
      payUrl="https://example.com/pay"
    />,
  );
}

describe("no-loe client page is byte-identical to the pre-sprint render", () => {
  for (const [name, make, client] of FIXTURES) {
    for (const state of ["live", "accepted"] as const) {
      it(`${name} (${state})`, () => {
        const html = render(make(), client, state);
        const file = join(DIR, `${name}-${state}.html`);
        if (process.env.WRITE_BASELINE === "1") {
          mkdirSync(DIR, { recursive: true });
          writeFileSync(file, html);
        }
        expect(existsSync(file)).toBe(true);
        expect(html).toBe(readFileSync(file, "utf8"));
      });
    }
  }
});
